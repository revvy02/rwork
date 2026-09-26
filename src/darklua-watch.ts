import { appendFileSync, writeFileSync } from "fs";
import { log } from "./log";

export interface DarkluaWatchOptions {
	/** Source directory darklua compiles from. */
	src: string;
	/** Output directory (`.rwork/<build>/<src>`). */
	dest: string;
	/** darklua config (`.rwork/<build>/darklua.json`). */
	config: string;
	/** Everything darklua prints (stdout and stderr) is also appended here, so a
	 *  failure that scrolled off the terminal stays diagnosable. Truncated on start. */
	logFile?: string;
	/** Fires after every (re)start once darklua's initial full build finished (or
	 *  timed out). `restarts` is 0 for the first start. */
	onReady?: (restarts: number) => void;
	initialBuildTimeoutMs?: number;
	restartDelayMs?: number;
	/** Grace period between SIGTERM and SIGKILL when darklua won't exit. */
	killGraceMs?: number;
	/** An exit sooner than this after a start counts as an immediate crash; after
	 *  `maxFastCrashes` of those in a row the supervisor gives up. */
	fastCrashWindowMs?: number;
	maxFastCrashes?: number;
	/** Executable to run (default `darklua`); tests point this at a fake. */
	command?: string;
}

export interface DarkluaWatch {
	/** Resolves once the first initial build finished (or timed out, or the
	 *  supervisor gave up), so callers never hang on a broken darklua. */
	readonly ready: Promise<void>;
	/** How many times darklua has been respawned so far. */
	readonly restarts: number;
	/** True once the supervisor stopped respawning after repeated immediate exits. */
	readonly gaveUp: boolean;
	/** Stop supervising and terminate darklua (SIGTERM, then SIGKILL after the grace period). */
	stop(): Promise<void>;
}

/** darklua prints this after every (re)build; the first one is the initial build. */
const BUILT_MARKER = "successfully processed";

/** Rust's panic report. darklua's watcher runs inside notify's debouncer thread;
 *  when that thread panics the process stays alive with its main thread parked
 *  on a channel and never compiles anything again (revvy02/rwork#2). Process
 *  liveness can't detect that, so the panic line on stderr is the signal. */
const PANIC_MARKER = "panicked at";

type Proc = ReturnType<typeof Bun.spawn>;

/** Run `darklua process <src> <dest> --watch` and keep it running: respawn it
 *  when it exits, and kill + respawn it when its watcher thread panics. */
export function startDarkluaWatch(options: DarkluaWatchOptions): DarkluaWatch {
	const {
		command = "darklua",
		initialBuildTimeoutMs = 120_000,
		restartDelayMs = 1_000,
		killGraceMs = 2_000,
		fastCrashWindowMs = 5_000,
		maxFastCrashes = 5,
	} = options;
	const args = [command, "process", options.src, options.dest, "--watch", "--config", options.config];

	let stopping = false;
	let restarts = 0;
	let gaveUp = false;
	let fastCrashes = 0;
	let current: Proc | null = null;

	let resolveReady!: () => void;
	const ready = new Promise<void>((resolve) => {
		resolveReady = resolve;
	});

	if (options.logFile) {
		try {
			writeFileSync(options.logFile, "");
		} catch (e) {
			log.diag(`darklua log file unavailable: ${(e as Error).message}`);
		}
	}
	const toLogFile = (text: string) => {
		if (!options.logFile) return;
		try {
			appendFileSync(options.logFile, text);
		} catch {}
	};

	// SIGTERM, then SIGKILL if it is still around: a darklua whose watcher
	// thread died may not shut down cleanly.
	const terminate = async (proc: Proc) => {
		try {
			proc.kill();
		} catch {}
		const exited = await Promise.race([
			proc.exited.then(() => true),
			Bun.sleep(killGraceMs).then(() => false),
		]);
		if (!exited) {
			log.warn("[sync] darklua did not exit on SIGTERM; killing it");
			try {
				proc.kill("SIGKILL");
			} catch {}
			await proc.exited;
		}
	};

	const spawnOnce = () => {
		const startedAt = Date.now();
		const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
		current = proc;
		toLogFile(`--- darklua --watch started pid=${proc.pid} restart=#${restarts} at ${new Date().toISOString()}\n`);
		log.diag(`darklua --watch spawned (pid=${proc.pid}, restart #${restarts})`);

		let built = false;
		let panicked = false;

		const markBuilt = () => {
			if (built) return;
			built = true;
			clearTimeout(timer);
			resolveReady();
			try {
				options.onReady?.(restarts);
			} catch (e) {
				log.error(`[sync] darklua onReady threw: ${(e as Error).message}`);
			}
		};
		const timer = setTimeout(() => {
			if (built) return;
			log.warn("[sync] darklua initial build timed out; continuing anyway");
			markBuilt();
		}, initialBuildTimeoutMs);

		const pump = async (stream: ReadableStream<Uint8Array>, echo: (s: string) => void) => {
			const reader = stream.getReader();
			const decoder = new TextDecoder();
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				const text = decoder.decode(value, { stream: true });
				echo(text);
				toLogFile(text);
				if (!built && text.includes(BUILT_MARKER)) markBuilt();
				if (!panicked && text.includes(PANIC_MARKER)) {
					panicked = true;
					log.error(
						"[sync] darklua's watcher thread panicked; the process would stay alive without compiling anything. Restarting darklua...",
					);
					void terminate(proc);
				}
			}
		};
		void pump(proc.stdout as ReadableStream<Uint8Array>, (s) => process.stdout.write(s));
		void pump(proc.stderr as ReadableStream<Uint8Array>, (s) => process.stderr.write(s));

		void proc.exited.then(async (code) => {
			clearTimeout(timer);
			toLogFile(`--- darklua exited code=${code}${panicked ? " (after watcher panic)" : ""} at ${new Date().toISOString()}\n`);
			if (stopping) return;
			fastCrashes = Date.now() - startedAt < fastCrashWindowMs ? fastCrashes + 1 : 0;
			if (fastCrashes >= maxFastCrashes) {
				gaveUp = true;
				log.error(
					"[sync] darklua --watch keeps exiting immediately; giving up (.luau edits won't sync until sync is restarted)",
				);
				resolveReady();
				return;
			}
			log.warn(`[sync] darklua --watch exited (code=${code}${panicked ? ", watcher panic" : ""}); restarting...`);
			await Bun.sleep(restartDelayMs);
			if (stopping) return;
			restarts++;
			spawnOnce();
		});
	};

	spawnOnce();

	return {
		ready,
		get restarts() {
			return restarts;
		},
		get gaveUp() {
			return gaveUp;
		},
		async stop() {
			stopping = true;
			if (current) await terminate(current);
		},
	};
}

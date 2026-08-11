import { readFileSync } from "fs";
import type { RworkBuild } from "../config";
import { envConfig } from "../config";
import { prepareOut } from "../prepare";
import { startWatch } from "../sync-engine";
import { log } from "../log";

// Spawn `darklua process src dest --watch`, echo its output, and resolve once the
// initial full build finishes (first "successfully processed" line). darklua then
// stays alive and rebuilds only changed .luau (+ dependents) incrementally (~ms).
// Times out so a misconfigured darklua can't hang startup forever.
function spawnDarkluaWatch(
	src: string,
	dest: string,
	config: string,
	timeoutMs: number,
) {
	const proc = Bun.spawn(
		["darklua", "process", src, dest, "--watch", "--config", config],
		{ stdout: "pipe", stderr: "pipe" },
	);

	const initialBuild = new Promise<void>((resolve) => {
		let done = false;
		let timer: ReturnType<typeof setTimeout>;
		const finish = () => {
			if (done) return;
			done = true;
			clearTimeout(timer);
			resolve();
		};
		timer = setTimeout(() => {
			log.warn("[sync] darklua initial build timed out; continuing anyway");
			finish();
		}, timeoutMs);

		const pump = async (
			stream: ReadableStream<Uint8Array>,
			echo: (s: string) => void,
		) => {
			const reader = stream.getReader();
			const decoder = new TextDecoder();
			for (;;) {
				const { done: eof, value } = await reader.read();
				if (eof) break;
				const text = decoder.decode(value, { stream: true });
				echo(text);
				if (text.includes("successfully processed")) finish();
			}
		};
		void pump(proc.stdout as ReadableStream<Uint8Array>, (s) =>
			process.stdout.write(s),
		);
		void pump(proc.stderr as ReadableStream<Uint8Array>, (s) =>
			process.stderr.write(s),
		);
	});

	return { proc, initialBuild };
}

export async function sync(rworkBuild: RworkBuild) {
	const cwd = `.rwork/${rworkBuild.name}`;
	const src = rworkBuild.src;
	const darkluaConfig = `${cwd}/darklua.json`;

	log.warn(
		"MAKE SURE YOU PESDE RUN RELOAD TO ENSURE ASPHALT AND ZAP FILES ARE LOADED!",
	);
	if (src) {
		log.warn(`Darklua Config: ${darkluaConfig}`);
	}

	// Hard-link assets + generate the project/sourcemap, but let `darklua --watch`
	// own the .luau build so we don't pay the full one-shot cost twice.
	prepareOut(rworkBuild, {
		includeWorkspace: false,
		includeServerStorage: envConfig.includeServerStorageWhenSyncing,
		includeAssets: envConfig.includeAssetsWhenSyncing,
	});

	// The compile pipeline (darklua --watch, the non-lua watcher, the sourcemap
	// watcher feeding convert_require) only exists when there's a src to compile.
	// A src-less build serves every $path raw, so rojo serve alone is live.
	let darkluaProc: ReturnType<typeof Bun.spawn> | null = null;
	let sourcemapProc: ReturnType<typeof Bun.spawn> | null = null;
	if (src) {
		const dest = `${cwd}/${src}`;

		// darklua --watch: full build once, then ~ms incremental rebuilds on .luau
		// content edits. Wait for the initial build before serving so Studio gets a
		// complete tree.
		log.info("[sync] Starting darklua --watch...");
		const darklua = spawnDarkluaWatch(src, dest, darkluaConfig, 120_000);
		darkluaProc = darklua.proc;
		await darklua.initialBuild;
		log.success("[sync] darklua initial build complete");

		// rwork's own watcher hard-links non-lua and cleans deletes; darklua owns the
		// .luau content, so there's no onLuauChange callback.
		startWatch({ src, dest });

		// Keep the sourcemap fresh so darklua's convert_require resolves new/renamed
		// modules (a structural change rewrites it; content-only edits leave it alone,
		// and darklua no-ops on an unchanged sourcemap).
		sourcemapProc = Bun.spawn(
			[
				"rojo",
				"sourcemap",
				`${cwd}/sourcemap.project.json`,
				"-o",
				`${cwd}/sourcemap.json`,
				"--watch",
				"--include-non-scripts",
			],
			{ stdio: ["inherit", "inherit", "inherit"] },
		);
	}

	// Branch switch detector
	let initialHead: string;
	try {
		initialHead = readFileSync(".git/HEAD", "utf-8");
	} catch {
		initialHead = "";
	}

	let branchInterval: ReturnType<typeof setInterval> | null = null;
	if (initialHead) {
		branchInterval = setInterval(() => {
			try {
				const currentHead = readFileSync(".git/HEAD", "utf-8");
				if (currentHead !== initialHead) {
					log.warn("Branch switch detected, aborting sync...");
					if (branchInterval) clearInterval(branchInterval);
					sourcemapProc?.kill();
					darkluaProc?.kill();
					process.exit(0);
				}
			} catch {}
		}, 1000);
	}

	// rojo serve — main loop. Async so the event loop stays free for the fs.watch
	// callbacks, the branch-switch interval, and the darklua output pumps.
	// RWORK_SYNC_PORT overrides rojo's default port. A non-zero exit respawns the
	// server — rojo can panic on transient fs events (e.g. pesde writes temporary
	// .git objects into roblox_packages while applying patches; rojo 7.7 panics
	// canonicalizing the already-deleted path) and the sync should survive that.
	// Repeated immediate crashes (port taken, broken project) give up instead of
	// loop-crashing.
	const serveArgs = ["rojo", "serve"];
	if (envConfig.syncPort) {
		serveArgs.push("--port", envConfig.syncPort);
	}

	let exitCode: number;
	let fastCrashes = 0;
	for (;;) {
		const startedAt = Date.now();
		const serveProc = Bun.spawn(serveArgs, {
			cwd,
			stdio: ["inherit", "inherit", "inherit"],
		});
		log.diag(
			`rojo serve spawned (pid=${serveProc.pid}${envConfig.syncPort ? ` port=${envConfig.syncPort}` : ""})`,
		);
		exitCode = await serveProc.exited;
		log.diag(`rojo serve exited code=${exitCode}`);
		if (exitCode === 0) break;
		fastCrashes = Date.now() - startedAt < 5000 ? fastCrashes + 1 : 0;
		if (fastCrashes >= 5) {
			log.error("[sync] rojo serve keeps crashing immediately; giving up");
			break;
		}
		log.warn(`[sync] rojo serve crashed (code=${exitCode}); restarting...`);
		await Bun.sleep(1000);
	}

	// Cleanup
	sourcemapProc?.kill();
	darkluaProc?.kill();
	if (branchInterval) clearInterval(branchInterval);

	if (exitCode !== 0) {
		process.exit(exitCode ?? 1);
	}
}

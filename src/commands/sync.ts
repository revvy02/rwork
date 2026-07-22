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
	const dest = `${cwd}/${src}`;
	const darkluaConfig = `${cwd}/darklua.json`;

	log.warn(
		"MAKE SURE YOU PESDE RUN RELOAD TO ENSURE ASPHALT AND ZAP FILES ARE LOADED!",
	);
	log.warn(`Darklua Config: ${darkluaConfig}`);

	// Hard-link assets + generate the project/sourcemap, but let `darklua --watch`
	// own the .luau build so we don't pay the full one-shot cost twice.
	prepareOut(rworkBuild, {
		includeWorkspace: false,
		includeServerStorage: envConfig.includeServerStorageWhenSyncing,
		includeAssets: envConfig.includeAssetsWhenSyncing,
	});

	// darklua --watch: full build once, then ~ms incremental rebuilds on .luau
	// content edits. Wait for the initial build before serving so Studio gets a
	// complete tree.
	log.info("[sync] Starting darklua --watch...");
	const { proc: darkluaProc, initialBuild } = spawnDarkluaWatch(
		src,
		dest,
		darkluaConfig,
		120_000,
	);
	await initialBuild;
	log.success("[sync] darklua initial build complete");

	// rwork's own watcher hard-links non-lua and cleans deletes; darklua owns the
	// .luau content, so there's no onLuauChange callback.
	startWatch({ src, dest });

	// Keep the sourcemap fresh so darklua's convert_require resolves new/renamed
	// modules (a structural change rewrites it; content-only edits leave it alone,
	// and darklua no-ops on an unchanged sourcemap).
	const sourcemapProc = Bun.spawn(
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
					sourcemapProc.kill();
					darkluaProc.kill();
					process.exit(0);
				}
			} catch {}
		}, 1000);
	}

	// rojo serve — main loop. Async so the event loop stays free for the fs.watch
	// callbacks, the branch-switch interval, and the darklua output pumps.
	const serveProc = Bun.spawn(["rojo", "serve"], {
		cwd,
		stdio: ["inherit", "inherit", "inherit"],
	});
	log.diag(`rojo serve spawned (pid=${serveProc.pid})`);

	const exitCode = await serveProc.exited;
	log.diag(`rojo serve exited code=${exitCode}`);

	// Cleanup
	sourcemapProc.kill();
	darkluaProc.kill();
	if (branchInterval) clearInterval(branchInterval);

	if (exitCode !== 0) {
		process.exit(exitCode ?? 1);
	}
}

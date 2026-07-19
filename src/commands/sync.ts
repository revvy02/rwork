import { readFileSync } from "fs";
import type { RworkBuild } from "../config";
import { envConfig } from "../config";
import { prepareOut, runDarklua, runSourcemapRegen } from "../prepare";
import { startWatch } from "../sync-engine";
import { log } from "../log";

export async function sync(rworkBuild: RworkBuild) {
	const cwd = `.rwork/${rworkBuild.name}`;
	const darkluaConfig = `${cwd}/darklua.json`;

	log.warn(
		"MAKE SURE YOU PESDE RUN RELOAD TO ENSURE ASPHALT AND ZAP FILES ARE LOADED!",
	);
	log.warn(`Darklua Config: ${darkluaConfig}`);

	prepareOut(rworkBuild, {
		includeWorkspace: false,
		includeServerStorage: envConfig.includeServerStorageWhenSyncing,
		includeAssets: envConfig.includeAssetsWhenSyncing,
	});

	// Debounced darklua runner
	let darkluaTimeout: ReturnType<typeof setTimeout> | null = null;
	let darkluaPending = false;
	let darkluaRuns = 0;
	let darkluaErrors = 0;
	const DEBOUNCE_MS = 100;

	function runDarkluaDebounced() {
		log.diag(`runDarkluaDebounced called (pendingTimeout=${darkluaTimeout !== null})`);
		if (darkluaTimeout) clearTimeout(darkluaTimeout);
		darkluaPending = true;
		darkluaTimeout = setTimeout(() => {
			darkluaTimeout = null;
			darkluaPending = false;
			const t0 = Date.now();
			darkluaRuns++;
			log.diag(`darklua run #${darkluaRuns} starting`);
			try {
				runSourcemapRegen(cwd);
				runDarklua(
					rworkBuild.src,
					`${cwd}/${rworkBuild.src}`,
					darkluaConfig,
				);
				log.diag(`darklua run #${darkluaRuns} ok in ${Date.now() - t0}ms`);
			} catch (e) {
				darkluaErrors++;
				log.error(`[sync] darklua run #${darkluaRuns} threw: ${(e as Error).message}`);
				log.diag((e as Error).stack ?? "(no stack)");
			}
		}, DEBOUNCE_MS);
	}

	// Heartbeat for darklua side so we can spot a stuck pending timer.
	if (log.diagEnabled) {
		setInterval(() => {
			log.diag(
				`darklua state: runs=${darkluaRuns} errors=${darkluaErrors} pending=${darkluaPending}`,
			);
		}, 30_000);
	}

	// 1. File sync watcher: hard-links binaries, triggers darklua on .luau changes
	startWatch({
		src: rworkBuild.src,
		dest: `${cwd}/${rworkBuild.src}`,
		onLuauChange: runDarkluaDebounced,
	});

	// 2. Sourcemap watcher
	const sourcemapProc = Bun.spawn(
		[
			envConfig.syncTool,
			"sourcemap",
			`${cwd}/sourcemap.project.json`,
			"-o",
			`${cwd}/sourcemap.json`,
			"--watch",
			"--include-non-scripts",
		],
		{ stdio: ["inherit", "inherit", "inherit"] },
	);

	// 3. Branch switch detector
	let initialHead: string;
	try {
		initialHead = readFileSync(".git/HEAD", "utf-8");
	} catch {
		initialHead = "";
	}

	if (initialHead) {
		const branchInterval = setInterval(() => {
			try {
				const currentHead = readFileSync(".git/HEAD", "utf-8");
				if (currentHead !== initialHead) {
					log.warn("Branch switch detected, aborting sync...");
					clearInterval(branchInterval);
					sourcemapProc.kill();
					process.exit(0);
				}
			} catch {}
		}, 1000);
	}

	// 4. Rojo serve — async so the JS event loop stays free for the fs.watch
	// callback, the branch-switch interval, and the diag heartbeats.
	// Using spawnSync here parks the main thread; FSEvents callbacks queue
	// onto the event loop but never get dispatched until rojo serve exits.
	const serveProc = Bun.spawn([envConfig.syncTool, "serve"], {
		cwd,
		stdio: ["inherit", "inherit", "inherit"],
	});
	log.diag(`rojo serve spawned (pid=${serveProc.pid})`);

	const exitCode = await serveProc.exited;
	log.diag(`rojo serve exited code=${exitCode}`);

	// Cleanup
	sourcemapProc.kill();

	if (exitCode !== 0) {
		process.exit(exitCode ?? 1);
	}
}

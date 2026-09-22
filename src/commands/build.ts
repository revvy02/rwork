import type { RworkBuild } from "../config";
import { prepareOut, runDarkluaOnce } from "../prepare";
import { openStudio } from "../studio";
import { log } from "../log";
import { getRevision } from "../revision";

export function build(rworkBuild: RworkBuild, options?: { open?: boolean }) {
	const startTime = performance.now();
	const cwd = `.rwork/${rworkBuild.name}`;

	const revision = getRevision();
	log.info(`Revision: ${revision}`);

	log.info("Preparing out files...");
	prepareOut(rworkBuild, {
		includeWorkspace: true,
		includeServerStorage: true,
		includeAssets: true,
		stamp: { build: rworkBuild.name, revision },
	});
	runDarkluaOnce(rworkBuild);

	log.info("Building the place file...");
	const proc = Bun.spawnSync(["rojo", "build", "-o", "build.rbxl"], {
		cwd,
		stdio: ["inherit", "inherit", "inherit"],
	});
	if (proc.exitCode !== 0) {
		log.error(`Failed to build the place file (code ${proc.exitCode})`);
		process.exit(1);
	}

	const elapsed = ((performance.now() - startTime) / 1000).toFixed(3);
	log.success(`Successfully built ${cwd}/build.rbxl in ${elapsed}s`);

	if (options?.open) {
		openStudio(`${cwd}/build.rbxl`);
	}
}

import type { RworkBuild } from "../config";
import { prepareOut } from "../prepare";
import { openStudio } from "../studio";
import { log } from "../log";

// Build the prepared project and upload it to a live place. Uses rojo's cookie
// auth (the player's Studio login) so only the place id is needed — no Open
// Cloud API key or universe id. Pass --api_key/--universe_id here if you ever
// want the Open Cloud path instead.
export function publish(rworkBuild: RworkBuild, place: string, options?: { open?: boolean }) {
	const startTime = performance.now();
	const cwd = `.rwork/${rworkBuild.name}`;

	log.info("Preparing out files...");
	prepareOut(rworkBuild, {
		includeWorkspace: true,
		includeServerStorage: true,
		includeAssets: true,
	});

	log.info(`Publishing to place ${place}...`);
	const proc = Bun.spawnSync(["rojo", "upload", "--asset_id", place], {
		cwd,
		stdio: ["inherit", "inherit", "inherit"],
	});
	if (proc.exitCode !== 0) {
		log.error(`Failed to publish to place ${place} (code ${proc.exitCode})`);
		process.exit(1);
	}

	const elapsed = ((performance.now() - startTime) / 1000).toFixed(3);
	log.success(`Published ${cwd} to place ${place} in ${elapsed}s`);

	if (options?.open) {
		openStudio(place);
	}
}

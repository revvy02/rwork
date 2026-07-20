import type { RworkBuild } from "../config";
import { prepareOut } from "../prepare";
import { openStudio } from "../studio";
import { log } from "../log";

// Resolve the universe that owns a place. RWORK_UNIVERSE overrides; otherwise
// ask Roblox's public endpoint so callers only ever need the place id.
async function resolveUniverse(place: string): Promise<string> {
	if (process.env.RWORK_UNIVERSE) {
		return process.env.RWORK_UNIVERSE;
	}
	const res = await fetch(`https://apis.roblox.com/universes/v1/places/${place}/universe`);
	if (!res.ok) {
		log.error(
			`Could not resolve the universe for place ${place} (${res.status}). Set RWORK_UNIVERSE.`,
		);
		process.exit(1);
	}
	const universeId = ((await res.json()) as { universeId?: number }).universeId;
	if (!universeId) {
		log.error(`No universe found for place ${place}. Set RWORK_UNIVERSE.`);
		process.exit(1);
	}
	return String(universeId);
}

// Build the prepared project and upload it to a live place. With RWORK_API_KEY
// set it uses the Open Cloud API (universe auto-resolved from the place id, or
// RWORK_UNIVERSE); otherwise it falls back to rojo's cookie auth.
export async function publish(
	rworkBuild: RworkBuild,
	place: string,
	options?: { open?: boolean },
) {
	const startTime = performance.now();
	const cwd = `.rwork/${rworkBuild.name}`;

	log.info("Preparing out files...");
	prepareOut(rworkBuild, {
		includeWorkspace: true,
		includeServerStorage: true,
		includeAssets: true,
	});

	const args = ["rojo", "upload", "--asset_id", place];
	const apiKey = process.env.RWORK_API_KEY;
	if (apiKey) {
		const universe = await resolveUniverse(place);
		args.push("--universe_id", universe, "--api_key", apiKey);
		log.info(`Publishing to place ${place} (universe ${universe}) via Open Cloud...`);
	} else {
		log.info(`Publishing to place ${place} via cookie auth...`);
	}

	const proc = Bun.spawnSync(args, {
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

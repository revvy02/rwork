import { log } from "./log";

// Open a place file in Studio via rodeo (a sibling tool on PATH). rodeo
// launches Studio with the place, runs a no-op, and --detach leaves Studio
// running after rodeo exits — so the opened place is also a rodeo-addressable
// Studio for `rodeo run`/`rodeo state`.
export function openStudio(file?: string) {
	const target = file ?? "build.rbxl";
	log.info(`Opening ${target} in Studio (rodeo)...`);
	const proc = Bun.spawnSync(
		["rodeo", "run", "--source", "return nil", "--place", target, "--detach", "--focus"],
		{ stdio: ["ignore", "inherit", "inherit"] },
	);
	if (proc.exitCode !== 0) {
		log.error(`Failed to open Studio (code ${proc.exitCode})`);
		process.exit(1);
	}
}

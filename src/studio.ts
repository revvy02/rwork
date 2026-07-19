import { log } from "./log";

const STUDIO_PATH =
	"/Applications/RobloxStudio.app/Contents/MacOS/RobloxStudio";

export function openStudio(file?: string) {
	const target = file ?? "build.rbxl";
	log.info(`Launching Roblox Studio (${target})...`);
	Bun.spawn([STUDIO_PATH, target], {
		stdio: ["ignore", "ignore", "ignore"],
	});
}

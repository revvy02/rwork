import type { RworkBuild } from "../config";
import { build } from "./build";
import { publish } from "./publish";
import { sync } from "./sync";
import { openStudio } from "../studio";
import { log } from "../log";

export async function dev(rworkBuild: RworkBuild, place?: string) {
	if (place) {
		// Live mode: build+publish to the place, then open THAT place in Studio.
		await publish(rworkBuild, place, { open: true });
	} else {
		// Local mode: build the place file and open it.
		build(rworkBuild);
		openStudio(`.rwork/${rworkBuild.name}/build.rbxl`);
	}
	log.success(
		"Build ready! You must enable HttpService and DataStoreService in Experience Settings after publishing to ensure the build works as expected.",
	);
	await sync(rworkBuild);
}

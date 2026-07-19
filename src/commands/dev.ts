import type { RworkBuild } from "../config";
import { build } from "./build";
import { sync } from "./sync";
import { openStudio } from "../studio";
import { log } from "../log";

export async function dev(rworkBuild: RworkBuild) {
	build(rworkBuild);
	openStudio(`.rwork/${rworkBuild.name}/build.rbxl`);
	log.success(
		"Build ready! You must enable HttpService and DataStoreService in Experience Settings after publishing to ensure the build works as expected.",
	);
	await sync(rworkBuild);
}

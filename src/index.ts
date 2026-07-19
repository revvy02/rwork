import { parseArgs } from "./args";
import { parseRworkConfig } from "./config";
import { build } from "./commands/build";
import { sync } from "./commands/sync";
import { dev } from "./commands/dev";

const args = parseArgs(Bun.argv.slice(2));

const rworkBuild = parseRworkConfig(args.preset, {
	project: args.project,
	src: args.src,
	darklua: args.darklua,
	globals: args.globalOverrides,
});

switch (args.command) {
	case "build":
		build(rworkBuild, { open: args.open });
		break;
	case "sync":
		await sync(rworkBuild);
		break;
	case "dev":
		await dev(rworkBuild);
		break;
}

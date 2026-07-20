import { parseArgs } from "./args";
import { parseRworkConfig } from "./config";
import { build } from "./commands/build";
import { sync } from "./commands/sync";
import { dev } from "./commands/dev";
import { publish } from "./commands/publish";
import { log } from "./log";

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
		await dev(rworkBuild, args.place);
		break;
	case "publish":
		if (!args.place) {
			log.error("publish requires a place: pass --place <id> or set RWORK_PLACE");
			process.exit(1);
		}
		await publish(rworkBuild, args.place, { open: args.open });
		break;
}

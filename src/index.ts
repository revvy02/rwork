import { Command } from "commander";
import { parseRworkConfig } from "./config";
import { build } from "./commands/build";
import { sync } from "./commands/sync";
import { dev } from "./commands/dev";
import { publish } from "./commands/publish";
import { log } from "./log";

const pkg = require("../package.json") as { version: string };

interface BuildOpts {
	preset: string;
	dev?: boolean;
	prod?: boolean;
	project?: string;
	src?: string;
	darklua?: string;
	global: Record<string, string>;
}

// Collect repeatable `-G KEY=VALUE` into a record.
function collectGlobal(pair: string, acc: Record<string, string> = {}) {
	const eq = pair.indexOf("=");
	if (eq > 0) {
		acc[pair.slice(0, eq)] = pair.slice(eq + 1);
	}
	return acc;
}

// Resolve the shared build-selection options into an RworkBuild.
function resolveBuild(opts: BuildOpts) {
	const preset = opts.prod ? "prod" : opts.dev ? "dev" : opts.preset;
	return parseRworkConfig(preset, {
		project: opts.project,
		src: opts.src,
		darklua: opts.darklua,
		globals: opts.global && Object.keys(opts.global).length > 0 ? opts.global : undefined,
	});
}

function resolvePlace(place?: string): string | undefined {
	return place ?? process.env.RWORK_PLACE_ID;
}

const program = new Command();
program
	.name("rwork")
	.description("A CLI for fully managed Rojo workflows")
	.version(pkg.version, "-v, --version")
	.showHelpAfterError();

// Options shared by every command — they select/override the build preset.
function withBuildOptions(cmd: Command) {
	return cmd
		.option("--preset <name>", "build preset from rwork.toml", "dev")
		.option("--dev", "shorthand for --preset dev")
		.option("--prod", "shorthand for --preset prod")
		.option("--project <path>", "override the preset's Rojo project")
		.option("--src <path>", "override the preset's source dir")
		.option("--darklua <path>", "override the preset's darklua config")
		.option("-G, --global <key=value>", "override a build global (repeatable)", collectGlobal);
}

withBuildOptions(program.command("build"))
	.description("Compile + build a place file into .rwork/<preset>/build.rbxl")
	.option("-o, --open", "open the built place in Studio")
	.action((opts) => {
		build(resolveBuild(opts), { open: opts.open });
	});

withBuildOptions(program.command("sync"))
	.description("Live-sync source into an open Studio (rojo serve + watchers)")
	.action(async (opts) => {
		await sync(resolveBuild(opts));
	});

withBuildOptions(program.command("dev"))
	.description("Build + open + sync (local loop); --place for live mode")
	.option("--place <id>", "live place id (or RWORK_PLACE_ID) — enables live mode")
	.action(async (opts) => {
		await dev(resolveBuild(opts), resolvePlace(opts.place));
	});

withBuildOptions(program.command("publish"))
	.description("Build + upload the place to a live place")
	.option("--place <id>", "live place id (or RWORK_PLACE_ID)")
	.option("-o, --open", "open the place in Studio after publishing")
	.action(async (opts) => {
		const place = resolvePlace(opts.place);
		if (!place) {
			log.error("publish requires a place: pass --place <id> or set RWORK_PLACE_ID");
			process.exit(1);
		}
		await publish(resolveBuild(opts), place, { open: opts.open });
	});

await program.parseAsync(Bun.argv);

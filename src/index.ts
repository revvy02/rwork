import { Command } from "commander";
import { parseRworkConfig, lookupPlace } from "./config";
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

interface PlaceTarget {
	id: string;
	// Set when the target is a named [places.*] entry with a bound preset.
	preset?: string;
}

// Uniform --place resolution, identical for every command that takes it:
// a [places.*] key from rwork.toml resolves to that entry; anything else is a
// raw place id. The flag falls back to RWORK_PLACE_ID (a dev's personal
// scratch place) through the same rule.
function resolveTarget(place?: string): PlaceTarget | undefined {
	const arg = place ?? process.env.RWORK_PLACE_ID;
	if (!arg) return undefined;
	return lookupPlace(arg) ?? { id: arg };
}

// The preset a command runs with: an explicit --preset/--dev/--prod wins but
// must agree with the target place's bound preset; otherwise the binding is
// the default, then "dev".
function resolvePreset(opts: BuildOpts, cmd: Command, target?: PlaceTarget): string {
	const explicit = opts.prod
		? "prod"
		: opts.dev
			? "dev"
			: cmd.getOptionValueSource("preset") === "cli"
				? opts.preset
				: undefined;

	if (target?.preset && explicit && explicit !== target.preset) {
		log.error(
			`--preset ${explicit} conflicts with the target place's bound preset "${target.preset}" (rwork.toml [places])`,
		);
		process.exit(1);
	}
	return explicit ?? target?.preset ?? opts.preset;
}

// Resolve the shared build-selection options into an RworkBuild.
function resolveBuild(opts: BuildOpts, cmd: Command, target?: PlaceTarget) {
	return parseRworkConfig(resolvePreset(opts, cmd, target), {
		project: opts.project,
		src: opts.src,
		darklua: opts.darklua,
		globals: opts.global && Object.keys(opts.global).length > 0 ? opts.global : undefined,
	});
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
	.action((opts, cmd) => {
		build(resolveBuild(opts, cmd), { open: opts.open });
	});

withBuildOptions(program.command("sync"))
	.description("Live-sync source into an open Studio (rojo serve + watchers)")
	.action(async (opts, cmd) => {
		await sync(resolveBuild(opts, cmd));
	});

withBuildOptions(program.command("dev"))
	.description("Build + open + sync (local loop); --place for live mode")
	.option(
		"--place <id|name>",
		"live place: a [places.*] name or raw id (or RWORK_PLACE_ID) — enables live mode",
	)
	.option(
		"--upload",
		"live mode: push a fresh build to the place before opening (default: open the published place and live-sync, no upload)",
	)
	.action(async (opts, cmd) => {
		const target = resolveTarget(opts.place);
		await dev(resolveBuild(opts, cmd, target), target?.id, { upload: opts.upload });
	});

withBuildOptions(program.command("publish"))
	.description("Build + upload the place to a live place")
	.option("--place <id|name>", "live place: a [places.*] name or raw id (or RWORK_PLACE_ID)")
	.option("-o, --open", "open the place in Studio after publishing")
	.action(async (opts, cmd) => {
		const target = resolveTarget(opts.place);
		if (!target) {
			log.error("publish requires a place: pass --place <id|name> or set RWORK_PLACE_ID");
			process.exit(1);
		}
		await publish(resolveBuild(opts, cmd, target), target.id, { open: opts.open });
	});

await program.parseAsync(Bun.argv);

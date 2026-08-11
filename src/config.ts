import { parse as parseToml } from "smol-toml";
import { readFileSync } from "fs";
import { log } from "./log";

// Coerce a -G override value to bool/number/string so overrides match toml types.
function parseGlobalValue(raw: string): string | boolean | number {
	if (raw === "true") return true;
	if (raw === "false") return false;
	const num = Number(raw);
	if (!Number.isNaN(num)) return num;
	return raw;
}

export interface RworkBuild {
	name: string;
	project: string;
	// Absent = nothing to compile: no darklua, no watchers, no sourcemap; the
	// project's $paths are all served raw from the repo.
	src?: string;
	darklua?: string;
	globals?: Record<string, string | boolean | number>;
}

interface TomlBuild {
	project?: string;
	src?: string;
	darklua?: string;
	globals?: Record<string, string | boolean | number>;
}

interface TomlPlace {
	id?: number | string;
	build?: string;
}

interface RworkToml {
	build?: Record<string, TomlBuild>;
	places?: Record<string, TomlPlace>;
}

interface CliOverrides {
	project?: string;
	src?: string;
	darklua?: string;
	globals?: Record<string, string>;
}

// rwork expects rojo and rodeo as sibling tools on PATH.
export const envConfig = {
	includeAssetsWhenSyncing: process.env.RWORK_INCLUDE_ASSETS_WHEN_SYNCING !== "false",
	includeServerStorageWhenSyncing:
		process.env.RWORK_INCLUDE_SERVER_STORAGE_WHEN_SYNCING !== "false",
	// Port for `rojo serve` during sync; rojo's own default when unset.
	syncPort: process.env.RWORK_SYNC_PORT,
};

function readRworkToml(): RworkToml {
	const raw = readFileSync("rwork.toml", "utf-8");
	return parseToml(raw) as unknown as RworkToml;
}

export interface NamedPlace {
	name: string;
	id: string;
	// Build this place is bound to; becomes the default build when the place
	// is targeted, and an explicit contradicting --build is an error.
	build?: string;
}

// Look up a [places.<name>] entry from rwork.toml. Returns undefined when the
// name doesn't match, so callers can fall back to treating it as a raw id.
export function lookupPlace(name: string): NamedPlace | undefined {
	const entry = readRworkToml().places?.[name];
	if (!entry) return undefined;

	if (entry.id === undefined) {
		log.error(`rwork.toml: places.${name}.id is required`);
		process.exit(1);
	}

	log.info(
		`[RworkPlace] ${name} → ${entry.id}${entry.build ? ` (build ${entry.build})` : ""}`,
	);
	return { name, id: String(entry.id), build: entry.build };
}

export function parseRworkConfig(
	buildName: string,
	overrides?: CliOverrides,
): RworkBuild {
	const toml = readRworkToml();

	if (!toml.build) {
		log.error("rwork.toml: missing [build] section");
		process.exit(1);
	}

	const entry = toml.build[buildName];
	if (!entry) {
		const available = Object.keys(toml.build).join(", ");
		log.error(
			`rwork.toml: no build "${buildName}" (available: ${available})`,
		);
		process.exit(1);
	}

	if (!entry.project) {
		log.error(`rwork.toml: build.${buildName}.project is required`);
		process.exit(1);
	}
	// Merge globals: toml base + CLI overrides
	let globals = entry.globals
		? { ...entry.globals }
		: undefined;

	if (overrides?.globals) {
		globals = globals ?? {};
		for (const [key, rawValue] of Object.entries(overrides.globals)) {
			globals[key] = parseGlobalValue(rawValue);
		}
	}

	const build: RworkBuild = {
		name: buildName,
		project: overrides?.project ?? entry.project,
		src: overrides?.src ?? entry.src,
		darklua: overrides?.darklua ?? entry.darklua,
		globals,
	};

	log.info(`[RworkBuild] ${build.name}`);
	log.info(`  project: ${build.project}`);
	log.info(`  src:     ${build.src ?? "(none — project paths served raw)"}`);
	log.info(`  darklua: ${build.src ? (build.darklua ?? "(generated)") : "(skipped — no src)"}`);
	if (build.globals) {
		log.info(`  globals:`);
		for (const [key, value] of Object.entries(build.globals)) {
			log.info(`    ${key} = ${String(value)}`);
		}
	}

	return build;
}

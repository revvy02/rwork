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
	src: string;
	darklua?: string;
	globals?: Record<string, string | boolean | number>;
}

interface TomlBuild {
	project?: string;
	src?: string;
	darklua?: string;
	globals?: Record<string, string | boolean | number>;
}

interface RworkToml {
	build?: Record<string, TomlBuild>;
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
};

export function parseRworkConfig(
	buildName: string,
	overrides?: CliOverrides,
): RworkBuild {
	const raw = readFileSync("rwork.toml", "utf-8");
	const toml = parseToml(raw) as unknown as RworkToml;

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
	if (!entry.src) {
		log.error(`rwork.toml: build.${buildName}.src is required`);
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
	log.info(`  src:     ${build.src}`);
	log.info(`  darklua: ${build.darklua ?? "(generated)"}`);
	if (build.globals) {
		log.info(`  globals:`);
		for (const [key, value] of Object.entries(build.globals)) {
			log.info(`    ${key} = ${String(value)}`);
		}
	}

	return build;
}

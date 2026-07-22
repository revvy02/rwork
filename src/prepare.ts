import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import type { RworkBuild } from "./config";
import { prepareDarklua } from "./darklua";
import { mutatePaths } from "./paths";
import { initialSync } from "./sync-engine";
import { log } from "./log";

export interface PrepareOutFlags {
	includeWorkspace: boolean;
	includeServerStorage: boolean;
	includeAssets: boolean;
}

function mergeGlobIgnores(
	current: string[] | undefined,
	additions: string[],
): string[] {
	if (!current) return additions;
	return [...current, ...additions];
}

function generateProjectFile(
	project: Record<string, unknown>,
	flags: PrepareOutFlags,
): Record<string, unknown> {
	const tree = project.tree as Record<string, unknown> | undefined;

	if (tree && !flags.includeWorkspace) {
		delete tree.Workspace;
	}

	if (tree && !flags.includeServerStorage) {
		delete tree.ServerStorage;
	}

	if (!flags.includeAssets) {
		project.globIgnorePaths = mergeGlobIgnores(
			project.globIgnorePaths as string[] | undefined,
			["**/*.rbxm", "**/*.rbxmx"],
		);
	}

	return project;
}

function writeProjectFile(path: string, content: string) {
	writeFileSync(path, content);
}

function runDarklua(
	srcFolder: string,
	destFolder: string,
	darkluaConfig: string,
) {
	log.info("[sync] Running darklua...");
	const t0 = Date.now();
	try {
		execSync(
			`darklua process "${srcFolder}" "${destFolder}" --config "${darkluaConfig}"`,
			{ stdio: "inherit" },
		);
		log.info(`[sync] Darklua complete in ${Date.now() - t0}ms`);
	} catch (e) {
		const err = e as Error & { status?: number };
		log.error(`[sync] Darklua failed (exit=${err.status ?? "?"}): ${err.message}`);
		log.diag(err.stack ?? "(no stack)");
	}
}

function runSourcemapRegen(outputDir: string) {
	log.info("[sync] Regenerating sourcemap...");
	const t0 = Date.now();
	try {
		execSync(
			`rojo sourcemap ${outputDir}/sourcemap.project.json -o ${outputDir}/sourcemap.json`,
			{ stdio: "inherit" },
		);
		log.diag(`runSourcemapRegen ok in ${Date.now() - t0}ms`);
	} catch (e) {
		const err = e as Error & { status?: number };
		log.error(`[sync] Sourcemap generation failed (exit=${err.status ?? "?"}): ${err.message}`);
		log.diag(err.stack ?? "(no stack)");
	}
}

export { runDarklua, runSourcemapRegen };

export function prepareOut(build: RworkBuild, flags: PrepareOutFlags) {
	const outputDir = `.rwork/${build.name}`;
	const srcFolder = build.src;
	const baseFile = JSON.parse(readFileSync(build.project, "utf-8"));

	if (!existsSync(outputDir)) {
		mkdirSync(outputDir, { recursive: true });
	}

	// Generate darklua config in .rwork/<build>/darklua.json
	prepareDarklua(build);

	// Output project file: structural transforms + path remapping for cwd=outputDir
	const outputProject = generateProjectFile(structuredClone(baseFile), {
		includeWorkspace: flags.includeWorkspace,
		includeServerStorage: flags.includeServerStorage,
		includeAssets: flags.includeAssets,
	});
	mutatePaths(outputProject, outputDir, srcFolder);
	writeProjectFile(
		join(outputDir, "default.project.json"),
		JSON.stringify(outputProject, null, "\t"),
	);

	// Sourcemap project file: mutate ALL paths (including src/) so rojo resolves from .rwork/<build>/
	// darklua normalizes ../../ filePaths by joining with sourcemap parent dir, so they match source paths
	const sourcemapProject = generateProjectFile(structuredClone(baseFile), {
		includeWorkspace: false,
		includeServerStorage: false,
		includeAssets: flags.includeAssets,
	});
	mutatePaths(sourcemapProject, outputDir);
	writeProjectFile(
		join(outputDir, "sourcemap.project.json"),
		JSON.stringify(sourcemapProject, null, "\t"),
	);

	// Generate sourcemap
	execSync(
		`rojo sourcemap sourcemap.project.json -o sourcemap.json`,
		{ cwd: outputDir, stdio: "inherit" },
	);

	// Hard-link/copy non-lua assets + regenerate the sourcemap. Compiling .luau is
	// a separate step the caller runs: runDarkluaOnce for a one-shot build, or
	// `darklua --watch` in sync.
	initialSync(srcFolder, join(outputDir, srcFolder));
	runSourcemapRegen(outputDir);
}

/** Compile .luau once over the prepared tree (one-shot). build/publish use this;
 *  sync runs `darklua --watch` instead. */
export function runDarkluaOnce(build: RworkBuild) {
	const outputDir = `.rwork/${build.name}`;
	runDarklua(build.src, join(outputDir, build.src), `${outputDir}/darklua.json`);
}

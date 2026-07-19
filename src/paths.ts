import { relative, join } from "path";

/**
 * Walk a project JSON tree and remap $path values for a new cwd.
 *
 * - Computes relative prefix from outputDir back to "." (e.g., "../../" for ".rwork/dev")
 * - If srcFolder is provided and a $path starts with it, skip (output dir has src/ locally)
 * - Otherwise, prepend the relative prefix so rojo resolves from outputDir
 */
export function mutatePaths(
	node: Record<string, unknown>,
	outputDir: string,
	srcFolder?: string,
): void {
	const prefix = relative(outputDir, ".");

	function walk(obj: Record<string, unknown>) {
		for (const [key, value] of Object.entries(obj)) {
			if (key === "$path" && typeof value === "string") {
				const firstComponent = value.split("/")[0];
				if (srcFolder && firstComponent === srcFolder) continue;
				obj[key] = join(prefix, value);
			} else if (
				typeof value === "object" &&
				value !== null &&
				!Array.isArray(value)
			) {
				walk(value as Record<string, unknown>);
			}
		}
	}

	walk(node);
}

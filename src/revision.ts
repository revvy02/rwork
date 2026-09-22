import { spawnSync } from "child_process";
import { log } from "./log";

function git(args: string[]): string | undefined {
	const proc = spawnSync("git", args, { encoding: "utf-8" });
	if (proc.error || proc.status !== 0) return undefined;
	return proc.stdout.trim();
}

/** Identify the source revision a build was produced from, as
 *  `branch@commit`, or just `commit` when the branch is unknown (detached HEAD).
 *
 *  RWORK_REVISION replaces the whole string verbatim: the escape hatch for a
 *  CI other than GitHub Actions, a tarball/Docker build with no .git, or
 *  stamping a release tag instead of a branch. Next, GitHub Actions'
 *  GITHUB_SHA / GITHUB_REF_NAME win when set: on a runner the checkout is
 *  detached, so `git branch --show-current` would come back empty. Otherwise
 *  we ask git. Local builds with uncommitted changes get a `-dirty` suffix so
 *  the stamp can't be mistaken for the committed tree. Outside a git repo (or
 *  without git) the revision is `unknown` rather than failing the build. */
export function getRevision(): string {
	const override = process.env.RWORK_REVISION?.trim();
	if (override) return override;

	const envSha = process.env.GITHUB_SHA;
	const commit = envSha || git(["rev-parse", "HEAD"]);
	if (!commit) {
		log.warn("Could not determine the source revision (not a git repo?); stamping \"unknown\"");
		return "unknown";
	}

	const branch = process.env.GITHUB_REF_NAME || git(["branch", "--show-current"]) || "";

	// Dirty detection only makes sense for a local checkout; a CI-provided sha
	// describes exactly what was checked out. Only tracked files count (same
	// semantics as `git describe --dirty`): untracked output like .rwork/ or a
	// stray build.rbxl would otherwise mark every local build dirty.
	const dirty =
		!envSha &&
		(git(["status", "--porcelain", "--untracked-files=no"]) ?? "") !== "";

	return `${branch ? `${branch}@` : ""}${commit}${dirty ? "-dirty" : ""}`;
}

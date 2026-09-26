import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { pruneStaleLuau } from "./sync-engine";

test("pruneStaleLuau removes .luau outputs with no source and leaves everything else", () => {
	const dir = mkdtempSync(join(tmpdir(), "rwork-prune-"));
	const src = join(dir, "src");
	const dest = join(dir, "out");
	for (const d of ["src/Pkg/Sub", "out/Pkg/Sub", "out/Gone"]) mkdirSync(join(dir, d), { recursive: true });
	writeFileSync(join(src, "Pkg/init.luau"), "return 1");
	writeFileSync(join(src, "Pkg/Sub/keep.luau"), "return 2");
	writeFileSync(join(dest, "Pkg/init.luau"), "compiled");
	writeFileSync(join(dest, "Pkg/Sub/keep.luau"), "compiled");
	writeFileSync(join(dest, "Pkg/Sub/removed.luau"), "stale");
	writeFileSync(join(dest, "Gone/init.luau"), "stale");
	writeFileSync(join(dest, "Pkg/model.rbxm"), "asset without .luau source: not darklua's");

	expect(pruneStaleLuau(src, dest)).toBe(2);

	expect(existsSync(join(dest, "Pkg/init.luau"))).toBe(true);
	expect(existsSync(join(dest, "Pkg/Sub/keep.luau"))).toBe(true);
	expect(existsSync(join(dest, "Pkg/Sub/removed.luau"))).toBe(false);
	expect(existsSync(join(dest, "Gone/init.luau"))).toBe(false);
	expect(existsSync(join(dest, "Pkg/model.rbxm"))).toBe(true);
	expect(pruneStaleLuau(src, dest)).toBe(0);
	expect(pruneStaleLuau(src, join(dir, "missing"))).toBe(0);
	rmSync(dir, { recursive: true, force: true });
});

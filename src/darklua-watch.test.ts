import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { startDarkluaWatch } from "./darklua-watch";

// A stand-in for `darklua process ... --watch`: records each spawn in $SPAWNS,
// prints the initial-build line, then runs the per-test body and idles.
function fakeDarklua(dir: string, body: string) {
	const path = join(dir, "darklua");
	writeFileSync(
		path,
		`#!/bin/bash
echo $$ >> "${join(dir, "spawns")}"
run=$(wc -l < "${join(dir, "spawns")}" | tr -d ' ')
echo "successfully processed 3 files (in 1ms)"
${body}
`,
	);
	chmodSync(path, 0o755);
	return path;
}

const spawnCount = (dir: string) => readFileSync(join(dir, "spawns"), "utf8").trim().split("\n").length;

async function waitFor(pred: () => boolean, ms = 8000) {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (pred()) return true;
		await Bun.sleep(50);
	}
	return pred();
}

function watchWith(dir: string, command: string, extra: Record<string, unknown> = {}) {
	const readyCalls: number[] = [];
	const watch = startDarkluaWatch({
		command,
		src: "src",
		dest: "out",
		config: "darklua.json",
		logFile: join(dir, "darklua.log"),
		restartDelayMs: 100,
		killGraceMs: 300,
		onReady: (n) => readyCalls.push(n),
		...extra,
	});
	return { watch, readyCalls };
}

test("a watcher-thread panic on stderr gets darklua killed and respawned", async () => {
	const dir = mkdtempSync(join(tmpdir(), "rwork-dw-"));
	const cmd = fakeDarklua(
		dir,
		`if [ "$run" = 1 ]; then
  sleep 0.2
  echo "thread 'notify-rs debouncer loop' panicked at src/frontend/worker_tree.rs:437:18:" >&2
  echo "node index should exist" >&2
fi
trap 'exit 0' TERM
while :; do sleep 0.1; done`,
	);
	const { watch, readyCalls } = watchWith(dir, cmd);
	await watch.ready;
	expect(readyCalls).toEqual([0]);

	expect(await waitFor(() => watch.restarts === 1 && readyCalls.length === 2)).toBe(true);
	expect(readyCalls).toEqual([0, 1]);
	expect(spawnCount(dir)).toBe(2);
	const logText = readFileSync(join(dir, "darklua.log"), "utf8");
	expect(logText).toContain("panicked at");
	expect(logText).toContain("after watcher panic");
	expect(logText).toContain("restart=#1");

	await watch.stop();
	rmSync(dir, { recursive: true, force: true });
});

test("a darklua that ignores SIGTERM is SIGKILLed and respawned", async () => {
	const dir = mkdtempSync(join(tmpdir(), "rwork-dw-"));
	const cmd = fakeDarklua(
		dir,
		`trap '' TERM
if [ "$run" = 1 ]; then sleep 0.2; echo "thread 'notify-rs debouncer loop' panicked at x.rs:1:1:" >&2; fi
while :; do sleep 0.1; done`,
	);
	const { watch } = watchWith(dir, cmd);
	await watch.ready;

	expect(await waitFor(() => watch.restarts === 1)).toBe(true);
	expect(spawnCount(dir)).toBe(2);
	const first = Number(readFileSync(join(dir, "spawns"), "utf8").split("\n")[0]);
	// The TERM-ignoring first instance must be gone (SIGKILL escalation).
	expect(await waitFor(() => { try { process.kill(first, 0); return false; } catch { return true; } }, 3000)).toBe(true);

	await watch.stop();
	rmSync(dir, { recursive: true, force: true });
});

test("a spontaneous exit is respawned", async () => {
	const dir = mkdtempSync(join(tmpdir(), "rwork-dw-"));
	const cmd = fakeDarklua(
		dir,
		`if [ "$run" = 1 ]; then sleep 0.2; exit 1; fi
trap 'exit 0' TERM
while :; do sleep 0.1; done`,
	);
	const { watch, readyCalls } = watchWith(dir, cmd);
	await watch.ready;

	expect(await waitFor(() => readyCalls.length === 2)).toBe(true);
	expect(watch.restarts).toBe(1);
	expect(watch.gaveUp).toBe(false);

	await watch.stop();
	rmSync(dir, { recursive: true, force: true });
});

test("repeated immediate exits give up instead of crash-looping, and ready still resolves", async () => {
	const dir = mkdtempSync(join(tmpdir(), "rwork-dw-"));
	const cmd = fakeDarklua(dir, `exit 2`);
	const { watch, readyCalls } = watchWith(dir, cmd, { maxFastCrashes: 3 });
	await watch.ready;

	expect(await waitFor(() => watch.gaveUp)).toBe(true);
	expect(spawnCount(dir)).toBe(3);
	expect(watch.restarts).toBe(2);
	// Every attempt printed the build line first, so onReady fired for each.
	expect(readyCalls).toEqual([0, 1, 2]);

	await watch.stop();
	rmSync(dir, { recursive: true, force: true });
});

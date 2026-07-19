import {
	linkSync,
	copyFileSync,
	unlinkSync,
	mkdirSync,
	rmSync,
	readdirSync,
} from "fs";
import { dirname, join, relative, resolve, extname } from "path";
import { watch as chokidarWatch, type FSWatcher } from "chokidar";
import { log } from "./log";

const LINK_EXTENSIONS = new Set([
	".rbxm",
	".rbxmx",
	".png",
	".jpg",
	".jpeg",
	".gif",
	".webp",
	".xml",
	".wav",
	".mp3",
	".ogg",
	".flac",
]);

function shouldHardLink(relPath: string): boolean {
	return LINK_EXTENSIONS.has(extname(relPath));
}

function shouldSkipCopy(relPath: string): boolean {
	return relPath.endsWith(".luau");
}

/** Recursively walk a directory and yield all file paths */
function* walkDir(dir: string): Generator<string> {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const fullPath = join(dir, entry.name);
		if (entry.isDirectory()) {
			yield* walkDir(fullPath);
		} else {
			yield fullPath;
		}
	}
}

/** Write one src file to dest (hard-link, copy, or skip per extension rules). Idempotent. */
function writeOneFile(srcPath: string, destPath: string, relPath: string): void {
	mkdirSync(dirname(destPath), { recursive: true });

	try {
		unlinkSync(destPath);
	} catch (e) {
		const code = (e as NodeJS.ErrnoException).code;
		if (code !== "ENOENT") {
			log.diag(`writeOneFile pre-unlink failed: ${relPath}: ${(e as Error).message}`);
		}
	}

	if (shouldSkipCopy(relPath)) return; // darklua handles .luau

	if (shouldHardLink(relPath)) {
		try {
			linkSync(srcPath, destPath);
			return;
		} catch (e) {
			log.diag(`writeOneFile linkSync fell back to copy: ${relPath}: ${(e as Error).message}`);
		}
	}
	copyFileSync(srcPath, destPath);
}

/** Initial sync: clean dest, walk src, hard-link or copy all files */
export function initialSync(srcDir: string, destDir: string): void {
	const absSrc = resolve(srcDir);
	const absDest = resolve(destDir);

	rmSync(absDest, { recursive: true, force: true });
	mkdirSync(absDest, { recursive: true });

	let linked = 0;
	let copied = 0;
	for (const srcPath of walkDir(absSrc)) {
		const rel = relative(absSrc, srcPath);
		writeOneFile(srcPath, join(absDest, rel), rel);
		if (shouldSkipCopy(rel)) continue;
		if (shouldHardLink(rel)) linked++;
		else copied++;
	}
	log.info(`[sync] Initial sync complete: ${linked} linked, ${copied} copied`);
}

export interface WatchSyncOptions {
	src: string;
	dest: string;
	onLuauChange?: () => void;
}

/** Start watching src for changes, sync to dest */
export function startWatch(options: WatchSyncOptions): FSWatcher {
	const absSrc = resolve(options.src);
	const absDest = resolve(options.dest);

	log.info(`[sync] Watching for changes... (diag=${log.diagEnabled ? "on" : "off"})`);
	log.diag(`startWatch absSrc=${absSrc} absDest=${absDest}`);

	const destOf = (srcPath: string) => join(absDest, relative(absSrc, srcPath));
	const relOf = (srcPath: string) => relative(absSrc, srcPath);

	let totalEvents = 0;
	let totalLuauTriggers = 0;
	let lastEventAt = Date.now();
	const startedAt = Date.now();

	const fireLuauChange = (relPath: string) => {
		if (!relPath.endsWith(".luau")) return;
		totalLuauTriggers++;
		log.diag(`  → onLuauChange #${totalLuauTriggers}`);
		try {
			options.onLuauChange?.();
		} catch (e) {
			log.error(`[sync] onLuauChange threw: ${(e as Error).message}`);
			log.diag((e as Error).stack ?? "(no stack)");
		}
	};

	const handle =
		(eventName: string, fn: (srcPath: string) => void) =>
		(srcPath: string) => {
			totalEvents++;
			lastEventAt = Date.now();
			const rel = relOf(srcPath);
			log.diag(`watch event #${totalEvents}: type=${eventName} filename=${rel}`);
			try {
				fn(srcPath);
			} catch (e) {
				log.error(`[sync] ${eventName} threw for ${rel}: ${(e as Error).message}`);
				log.diag((e as Error).stack ?? "(no stack)");
			}
		};

	const onFileWrite = (srcPath: string) => {
		const rel = relOf(srcPath);
		writeOneFile(srcPath, destOf(srcPath), rel);
		const kind = shouldSkipCopy(rel) ? "skipped" : shouldHardLink(rel) ? "link" : "copy";
		log.info(`[sync] change: ${rel} (${kind})`);
		fireLuauChange(rel);
	};

	const onFileUnlink = (srcPath: string) => {
		try {
			unlinkSync(destOf(srcPath));
		} catch (e) {
			const code = (e as NodeJS.ErrnoException).code;
			if (code !== "ENOENT") {
				log.diag(`unlink failed: ${relOf(srcPath)}: ${(e as Error).message}`);
			}
		}
		log.info(`[sync] delete: ${relOf(srcPath)}`);
	};

	const onDirAdd = (srcPath: string) => {
		mkdirSync(destOf(srcPath), { recursive: true });
		log.info(`[sync] mkdir: ${relOf(srcPath) || "."}`);
	};

	const onDirUnlink = (srcPath: string) => {
		rmSync(destOf(srcPath), { recursive: true, force: true });
		log.info(`[sync] rmdir: ${relOf(srcPath)}`);
	};

	const watcher = chokidarWatch(absSrc, { ignoreInitial: true });

	watcher
		.on("add", handle("add", onFileWrite))
		.on("change", handle("change", onFileWrite))
		.on("unlink", handle("unlink", onFileUnlink))
		.on("addDir", handle("addDir", onDirAdd))
		.on("unlinkDir", handle("unlinkDir", onDirUnlink))
		.on("error", (err) => {
			log.error(`[sync] watcher error: ${(err as Error).message}`);
			log.diag((err as Error).stack ?? "(no stack)");
		})
		.on("ready", () => {
			log.diag(`watcher ready`);
		});

	if (log.diagEnabled) {
		setInterval(() => {
			const idle = Math.round((Date.now() - lastEventAt) / 1000);
			const uptime = Math.round((Date.now() - startedAt) / 1000);
			log.diag(
				`heartbeat: events=${totalEvents} luauTriggers=${totalLuauTriggers} idle=${idle}s uptime=${uptime}s`,
			);
		}, 30_000);
	}

	return watcher;
}

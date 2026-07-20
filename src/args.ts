export interface CliArgs {
	command: "build" | "sync" | "dev" | "publish";
	preset: string;
	project?: string;
	src?: string;
	darklua?: string;
	globalOverrides?: Record<string, string>;
	open?: boolean;
	// Live place id (--place, or RWORK_PLACE). Its presence puts dev in live mode:
	// build+publish to the place, open it via rodeo, then sync into it.
	place?: string;
}

function parseGlobalValue(raw: string): string | boolean | number {
	if (raw === "true") return true;
	if (raw === "false") return false;
	const num = Number(raw);
	if (!Number.isNaN(num)) return num;
	return raw;
}

export { parseGlobalValue };

export function parseArgs(argv: string[]): CliArgs {
	if (argv[0] === "--version" || argv[0] === "-v") {
		console.log(require("../package.json").version);
		process.exit(0);
	}

	const command = argv[0] as CliArgs["command"];
	if (!command || !["build", "sync", "dev", "publish"].includes(command)) {
		console.error(`Usage: rwork <build|sync|dev|publish> [options]`);
		process.exit(1);
	}

	let preset = "dev";
	let project: string | undefined;
	let src: string | undefined;
	let darklua: string | undefined;
	let open = false;
	let place: string | undefined;
	const globalOverrides: Record<string, string> = {};

	const args = argv.slice(1);
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		switch (arg) {
			case "--preset":
				preset = args[++i];
				break;
			case "--project":
				project = args[++i];
				break;
			case "--src":
				src = args[++i];
				break;
			case "--darklua":
				darklua = args[++i];
				break;
			case "--dev":
				preset = "dev";
				break;
			case "--prod":
				preset = "prod";
				break;
			case "--open":
			case "-o":
				open = true;
				break;
			case "--place":
				place = args[++i];
				break;
			case "-G": {
				const pair = args[++i];
				const eq = pair?.indexOf("=");
				if (pair && eq !== undefined && eq > 0) {
					globalOverrides[pair.slice(0, eq)] = pair.slice(eq + 1);
				}
				break;
			}
			default:
				console.error(`Unknown argument: ${arg}`);
				process.exit(1);
		}
	}

	return {
		command,
		preset,
		project,
		src,
		darklua,
		globalOverrides: Object.keys(globalOverrides).length > 0 ? globalOverrides : undefined,
		open,
		place: place ?? process.env.RWORK_PLACE,
	};
}

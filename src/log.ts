const RESET = "\x1b[0m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";
const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";

const DIAG_ENABLED = process.env.RWORK_DIAG === "1" || process.env.RWORK_DIAG === "true";

function ts() {
	const d = new Date();
	const pad = (n: number, w = 2) => n.toString().padStart(w, "0");
	return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

export const log = {
	error(msg: string) {
		process.stderr.write(`${RED}${msg}${RESET}\n`);
	},
	warn(msg: string) {
		process.stdout.write(`${YELLOW}${msg}${RESET}\n`);
	},
	info(msg: string) {
		process.stdout.write(`${BLUE}${msg}${RESET}\n`);
	},
	success(msg: string) {
		process.stdout.write(`${GREEN}${msg}${RESET}\n`);
	},
	/** Diagnostic log; gated behind RWORK_DIAG=1 env var. Always timestamped. */
	diag(msg: string) {
		if (!DIAG_ENABLED) return;
		process.stdout.write(`${DIM}[${ts()}] [diag] ${msg}${RESET}\n`);
	},
	/** Whether diagnostic logging is enabled (read elsewhere to skip work). */
	diagEnabled: DIAG_ENABLED,
};

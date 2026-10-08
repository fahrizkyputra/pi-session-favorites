#!/usr/bin/env node
/**
 * End-to-end check for /favorite against a real Pi process.
 *
 * Runs Pi in RPC mode with an isolated agent directory, submits /favorite and
 * /unfavorite, and asserts on the artifacts: the session file gains a
 * `session_info` entry with the ★ name, the sidecar records the session ID, and
 * the non-TUI picker fallback answers without an extension error.
 *
 * Usage:  npm run test:e2e     (requires the `pi` binary on PATH)
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TIMEOUT_MS = 90_000;
// Point this at the published package to verify the shipped artifact:
//   PI_FAVORITES_EXTENSION=npm:pi-session-favorites npm run test:e2e
const extensionPath =
	process.env.PI_FAVORITES_EXTENSION ??
	resolve(dirname(fileURLToPath(import.meta.url)), "..", "extensions", "session-favorites.ts");
const PID = "e2e0001";
const TITLE = "e2e fixture message";

const root = mkdtempSync(join(tmpdir(), "pi-session-favorites-e2e-"));
const agentDir = join(root, "agent");
const workDir = join(root, "work");
const sessionDir = join(root, "sessions");
for (const dir of [agentDir, workDir, sessionDir]) mkdirSync(dir, { recursive: true });

const sessionFile = join(sessionDir, `2026-01-01T00-00-00_${PID}.jsonl`);
writeFileSync(
	sessionFile,
	[
		JSON.stringify({ type: "session", version: 3, id: PID, timestamp: "2026-01-01T00:00:00.000Z", cwd: workDir }),
		JSON.stringify({
			type: "message",
			id: "m1",
			parentId: null,
			timestamp: "2026-01-01T00:00:01.000Z",
			message: { role: "user", content: [{ type: "text", text: TITLE }] },
		}),
	].join("\n") + "\n",
);

const sidecarPath = join(agentDir, "session-favorites.json");
const notifications = [];
const extensionErrors = [];
const stderr = [];
let selectRequests = 0;
let handled = 0;

const child = spawn("pi", ["--mode", "rpc", "--session", sessionFile, "-e", extensionPath], {
	cwd: workDir,
	env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_CODING_AGENT_SESSION_DIR: sessionDir },
	stdio: ["pipe", "pipe", "pipe"],
});

child.stderr.on("data", (chunk) => stderr.push(chunk.toString()));

let buffer = "";
child.stdout.on("data", (chunk) => {
	buffer += chunk.toString();
	let index = buffer.indexOf("\n");
	while (index >= 0) {
		const line = buffer.slice(0, index).trim();
		buffer = buffer.slice(index + 1);
		index = buffer.indexOf("\n");
		if (line.length > 0) handleLine(line);
	}
});

function reply(payload) {
	child.stdin.write(`${JSON.stringify(payload)}\n`);
}

function handleLine(line) {
	let event;
	try {
		event = JSON.parse(line);
	} catch {
		return;
	}

	if (event.type === "extension_error") {
		extensionErrors.push(String(event.error ?? event.message ?? JSON.stringify(event)));
		return;
	}

	if (event.type === "extension_ui_request") {
		if (event.method === "notify") notifications.push(String(event.message ?? ""));
		if (event.method === "select") {
			selectRequests++;
			reply({ type: "extension_ui_response", id: event.id, value: "Done — apply the changes" });
		}
		if (event.method === "confirm") reply({ type: "extension_ui_response", id: event.id, confirmed: true });
		return;
	}

	if (event.type === "response" && event.command === "prompt" && event.data?.disposition === "handled") handled++;
}

function fail(message) {
	console.error(`FAIL: ${message}`);
	finish(1);
}

let finished = false;

function finish(code = 0) {
	if (finished) return;
	finished = true;
	clearTimeout(timer);
	child.kill("SIGKILL");
	rmSync(root, { recursive: true, force: true });
	if (code === 0) console.log("e2e ok: /favorite writes the ★ name into the session and records the sidecar");
	process.exit(code);
}

const timer = setTimeout(() => fail("timed out"), TIMEOUT_MS);

function lastSessionName() {
	const raw = readFileSync(sessionFile, "utf8");
	let name;
	for (const line of raw.split("\n")) {
		if (!line.trim()) continue;
		try {
			const entry = JSON.parse(line);
			if (entry.type === "session_info") name = entry.name;
		} catch {
			// ignore malformed lines
		}
	}
	return name;
}

function sidecarFavorites() {
	if (!existsSync(sidecarPath)) return {};
	try {
		return JSON.parse(readFileSync(sidecarPath, "utf8")).favorites ?? {};
	} catch {
		return {};
	}
}

const steps = [
	{
		delay: 3000,
		run: () => reply({ id: "p1", type: "prompt", message: "/favorite" }),
	},
	{
		delay: 6000,
		run: () => {
			if (extensionErrors.length > 0) return fail(`extension error: ${extensionErrors[0]?.slice(0, 200)}`);
			if (handled < 1) return fail("the /favorite prompt was not handled as an extension command");
			if (lastSessionName() !== `★ ${TITLE}`) {
				return fail(`session name is ${JSON.stringify(lastSessionName())}, expected "★ ${TITLE}"`);
			}
			if (!(PID in sidecarFavorites())) return fail("the sidecar has no record for the session");
			reply({ id: "p2", type: "prompt", message: "/favorite list" });
		},
	},
	{
		delay: 9000,
		run: () => {
			if (selectRequests < 1) return fail("the non-TUI picker fallback never asked for a selection");
			reply({ id: "p3", type: "prompt", message: "/unfavorite" });
		},
	},
	{
		delay: 12_000,
		run: () => {
			if (extensionErrors.length > 0) return fail(`extension error: ${extensionErrors[0]?.slice(0, 200)}`);
			const name = lastSessionName();
			if (name !== undefined && name.includes("★")) return fail(`marker still present: ${name}`);
			if (PID in sidecarFavorites()) return fail("the sidecar still records the session as favorite");
			if (stderr.join("").includes("stale after session replacement")) {
				return fail("a stale-context error surfaced");
			}
			if (!notifications.some((message) => /unfavorite|Marker removed/i.test(message))) {
				return fail(`no unfavorite notification, got: ${notifications.join(" | ")}`);
			}
			finish(0);
		},
	},
];

for (const step of steps) setTimeout(step.run, step.delay);

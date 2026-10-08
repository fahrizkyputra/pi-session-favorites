/**
 * Wiring test: the extension entry point, a fake Pi, and the real sidecar file
 * in a temporary agent directory.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { favoritesFilePath } from "../src/favorites-store.ts";
import sessionFavoritesExtension from "../extensions/session-favorites.ts";

const dirs: string[] = [];

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-session-favorites-wiring-"));
	dirs.push(dir);
	return dir;
}

interface FakeOptions {
	name?: string;
	entries?: unknown[];
	parentSession?: string;
	sessionId?: string;
	sessionFile?: string;
}

interface Fake {
	pi: ExtensionAPI;
	ctx: any;
	commands: Record<string, { handler: (args: string, ctx: any) => Promise<void> }>;
	hooks: Record<string, ((event: unknown, ctx: any) => Promise<void>)[]>;
	renames: string[];
	notifications: string[];
}

function fakePi(options: FakeOptions = {}): Fake {
	const commands: Fake["commands"] = {};
	const hooks: Fake["hooks"] = {};
	const renames: string[] = [];
	const notifications: string[] = [];
	let currentName = options.name;

	const pi = {
		registerCommand: (name: string, definition: { handler: (args: string, ctx: any) => Promise<void> }) => {
			commands[name] = definition;
		},
		on: (event: string, handler: (event: unknown, ctx: any) => Promise<void>) => {
			hooks[event] = [...(hooks[event] ?? []), handler];
		},
		getSessionName: () => currentName,
		setSessionName: (name: string) => {
			renames.push(name);
			currentName = name;
		},
	} as unknown as ExtensionAPI;

	const ctx = {
		mode: "tui",
		hasUI: true,
		cwd: process.cwd(),
		ui: {
			confirm: async () => true,
			notify: (message: string) => notifications.push(message),
			select: async () => undefined,
			setStatus: () => {},
			custom: async () => undefined,
		},
		sessionManager: {
			getSessionFile: () => options.sessionFile,
			getSessionId: () => options.sessionId ?? "wiring-session-id",
			getSessionName: () => currentName,
			getEntries: () => options.entries ?? [],
			getHeader: () => ({ parentSession: options.parentSession }),
			getSessionDir: () => tempDir(),
		},
	};

	return { pi, ctx, commands, hooks, renames, notifications };
}

async function withAgentDir<T>(dir: string, run: () => Promise<T>): Promise<T> {
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = dir;
	try {
		return await run();
	} finally {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
	}
}

function readSidecar(dir: string): { favorites: Record<string, { name?: string }> } {
	return JSON.parse(readFileSync(favoritesFilePath(dir), "utf8")) as {
		favorites: Record<string, { name?: string }>;
	};
}

after(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

test("registers /favorite and /unfavorite plus a session_start hook", () => {
	const { pi, commands, hooks } = fakePi();
	sessionFavoritesExtension(pi);
	assert.deepEqual(Object.keys(commands).sort(), ["favorite", "unfavorite"]);
	assert.equal(hooks.session_start?.length, 1);
});

test("/favorite names the session and records it in the sidecar", async () => {
	const dir = tempDir();
	const { pi, ctx, commands, renames } = fakePi({
		entries: [
			{
				type: "message",
				id: "m1",
				parentId: null,
				timestamp: new Date(0).toISOString(),
				message: { role: "user", content: [{ type: "text", text: "fix the login bug" }] },
			},
		],
	});
	sessionFavoritesExtension(pi);

	await withAgentDir(dir, async () => {
		await commands.favorite!.handler("", ctx);
	});

	assert.deepEqual(renames, ["★ fix the login bug"]);
	assert.equal(readSidecar(dir).favorites["wiring-session-id"]?.name, "★ fix the login bug");
});

test("/unfavorite clears the marker and the sidecar record", async () => {
	const dir = tempDir();
	const { pi, ctx, commands, renames } = fakePi({ name: "★ Fix auth" });
	sessionFavoritesExtension(pi);

	await withAgentDir(dir, async () => {
		await commands.favorite!.handler("", ctx); // records the sidecar entry
		await commands.unfavorite!.handler("", ctx);
	});

	assert.deepEqual(renames.at(-1), "Fix auth");
	assert.deepEqual(readSidecar(dir).favorites, {});
});

test("session_start strips a marker inherited through a fork", async () => {
	const dir = tempDir();
	const { pi, ctx, hooks, renames } = fakePi({ name: "★ Fix auth", parentSession: "/sessions/parent.jsonl" });
	sessionFavoritesExtension(pi);

	await withAgentDir(dir, async () => {
		await hooks.session_start![0]!({ type: "session_start", reason: "fork" }, ctx);
	});

	assert.deepEqual(renames, ["Fix auth"]);
});

test("session_start repairs a marker that a manual rename removed", async () => {
	const dir = tempDir();
	writeFileSync(
		favoritesFilePath(dir),
		JSON.stringify({ version: 1, favorites: { "wiring-session-id": { markedAt: new Date().toISOString() } } }),
	);
	const { pi, ctx, hooks, renames } = fakePi({ name: "renamed by hand" });
	sessionFavoritesExtension(pi);

	await withAgentDir(dir, async () => {
		await hooks.session_start![0]!({ type: "session_start", reason: "resume" }, ctx);
	});

	assert.deepEqual(renames, ["★ renamed by hand"]);
});

test("session_start backfills a marker that arrived with the session file", async () => {
	const dir = tempDir();
	const { pi, ctx, hooks, renames } = fakePi({ name: "★ Imported from another machine" });
	sessionFavoritesExtension(pi);

	await withAgentDir(dir, async () => {
		await hooks.session_start![0]!({ type: "session_start", reason: "resume" }, ctx);
	});

	assert.deepEqual(renames, [], "an unrecorded marker is trusted as-is");
	assert.equal(readSidecar(dir).favorites["wiring-session-id"]?.name, "★ Imported from another machine");
});

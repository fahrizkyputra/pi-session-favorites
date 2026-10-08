/**
 * Session file access against real fixture files, through Pi's own
 * SessionManager. This is the same data source `/resume` renders, so these
 * tests close the loop: a marker written to a file shows up in the session list.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { listSessionRefs, readSessionName, readSessionTitle, writeSessionName } from "../src/session-access.ts";

const dirs: string[] = [];

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-session-favorites-access-"));
	dirs.push(dir);
	return dir;
}

function writeFixture(sessionDir: string, file: string, id: string, cwd: string, text: string, name?: string): string {
	const path = join(sessionDir, file);
	const lines = [
		{ type: "session", version: 3, id, timestamp: "2026-01-01T00:00:00.000Z", cwd },
		{
			type: "message",
			id: "m1",
			parentId: null,
			timestamp: "2026-01-01T00:00:01.000Z",
			message: { role: "user", content: [{ type: "text", text }] },
		},
	];
	if (name !== undefined) {
		lines.push({
			type: "session_info",
			id: "s1",
			parentId: "m1",
			timestamp: "2026-01-01T00:00:02.000Z",
			name,
		} as never);
	}
	writeFileSync(path, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
	return path;
}

after(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

test("listSessionRefs surfaces the ★ name the way /resume does", async () => {
	const sessions = tempDir();
	const cwd = tempDir();
	writeFixture(sessions, "2026-01-01T00-00-00_fav.jsonl", "fav-1", cwd, "deploy the api", "★ Deploy script");
	writeFixture(sessions, "2026-01-01T00-00-01_plain.jsonl", "plain-1", cwd, "plain session");

	const refs = await listSessionRefs({ cwd, sessionDir: sessions });
	const favorite = refs.find((ref) => ref.id === "fav-1");
	const plain = refs.find((ref) => ref.id === "plain-1");

	assert.equal(favorite?.name, "★ Deploy script");
	assert.equal(favorite?.title, "deploy the api");
	assert.equal(plain?.name, undefined);
	assert.equal(plain?.title, "plain session");
});

test("readSessionName and readSessionTitle read a specific file", () => {
	const sessions = tempDir();
	const cwd = tempDir();
	const path = writeFixture(sessions, "2026-01-01T00-00-02_x.jsonl", "x", cwd, "fix payment webhook");

	assert.equal(readSessionName(path), undefined);
	assert.equal(readSessionTitle(path), "fix payment webhook");
});

test("writeSessionName appends a session_info entry that /resume would show", () => {
	const sessions = tempDir();
	const cwd = tempDir();
	const path = writeFixture(sessions, "2026-01-01T00-00-03_y.jsonl", "y", cwd, "some work");

	writeSessionName(path, "★ some work");
	assert.equal(readSessionName(path), "★ some work");

	const entries = readFileSync(path, "utf8")
		.split("\n")
		.filter((line) => line.trim().length > 0)
		.map((line) => JSON.parse(line) as { type: string; name?: string });
	const info = entries.filter((entry) => entry.type === "session_info");
	assert.equal(info.length, 1);
	assert.equal(info[0]?.name, "★ some work");

	writeSessionName(path, "");
	assert.equal(readSessionName(path), undefined, "an empty name clears the display name");
});

test("listSessionRefs keeps the search text for the picker", async () => {
	const sessions = tempDir();
	const cwd = tempDir();
	writeFixture(sessions, "2026-01-01T00-00-04_z.jsonl", "z", cwd, "kubernetes cluster notes");

	const refs = await listSessionRefs({ cwd, sessionDir: sessions });
	assert.match(refs[0]?.searchText ?? "", /kubernetes/);
});

test("listSessionRefs tolerates a missing directory", async () => {
	const refs = await listSessionRefs({ cwd: tempDir(), sessionDir: join(tempDir(), "does-not-exist") });
	assert.deepEqual(refs, []);
});

test("a session with no messages is still listed", async () => {
	const sessions = tempDir();
	const cwd = tempDir();
	mkdirSync(sessions, { recursive: true });
	writeFileSync(
		join(sessions, "2026-01-01T00-00-05_empty.jsonl"),
		`${JSON.stringify({ type: "session", version: 3, id: "empty", timestamp: "2026-01-01T00:00:00.000Z", cwd })}\n`,
	);

	const refs = await listSessionRefs({ cwd, sessionDir: sessions });
	assert.equal(refs.length, 1, "an empty session is still listed so it can be favorited");
	assert.match(refs[0]?.title ?? "", /no messages|untitled/);
});

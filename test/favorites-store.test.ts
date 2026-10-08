import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import {
	addFavorite,
	emptyFavorites,
	favoritesFilePath,
	isFavoriteId,
	parseFavorites,
	pruneFavorites,
	readFavorites,
	removeFavorite,
	writeFavorites,
} from "../src/favorites-store.ts";

const dirs: string[] = [];

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-session-favorites-"));
	dirs.push(dir);
	return dir;
}

after(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

test("parseFavorites survives garbage and empty input", () => {
	assert.deepEqual(parseFavorites(undefined), emptyFavorites());
	assert.deepEqual(parseFavorites(""), emptyFavorites());
	assert.deepEqual(parseFavorites("not json"), emptyFavorites());
	assert.deepEqual(parseFavorites("{}"), emptyFavorites());
	assert.deepEqual(parseFavorites('{"favorites":null}'), emptyFavorites());
	assert.deepEqual(parseFavorites('{"version":9,"favorites":"nope"}'), emptyFavorites());
});

test("parseFavorites keeps valid records and repairs broken ones", () => {
	const parsed = parseFavorites(
		JSON.stringify({
			version: 1,
			favorites: {
				abc: { markedAt: "2026-01-01T00:00:00.000Z", name: "★ Fix auth" },
				def: { name: "no timestamp" },
				ghi: null,
			},
		}),
	);
	assert.equal(Object.keys(parsed.favorites).length, 3);
	assert.equal(parsed.favorites.abc?.name, "★ Fix auth");
	assert.equal(parsed.favorites.def?.markedAt, new Date(0).toISOString(), "missing timestamps fall back to epoch");
	assert.equal(isFavoriteId(parsed, "abc"), true);
	assert.equal(isFavoriteId(parsed, "missing"), false);
	assert.equal(isFavoriteId(parsed, undefined), false);
});

test("add/remove are pure and idempotent", () => {
	const base = emptyFavorites();
	const added = addFavorite(base, "id-1", "★ One");
	assert.deepEqual(base.favorites, {}, "the input must not be mutated");
	assert.equal(isFavoriteId(added, "id-1"), true);
	assert.equal(added.favorites["id-1"]?.name, "★ One");

	const again = addFavorite(added, "id-1");
	assert.equal(Object.keys(again.favorites).length, 1, "re-adding replaces the record");

	const removed = removeFavorite(added, "id-1");
	assert.equal(isFavoriteId(removed, "id-1"), false);
	assert.equal(removeFavorite(removed, "id-1"), removed, "removing a missing id is a no-op");
	assert.equal(addFavorite(base, ""), base, "empty ids are ignored");
});

test("pruneFavorites drops records whose sessions are gone", () => {
	const data = addFavorite(addFavorite(addFavorite(emptyFavorites(), "keep"), "drop"), "current");
	const pruned = pruneFavorites(data, ["keep", "current"]);
	assert.deepEqual(Object.keys(pruned.favorites).sort(), ["current", "keep"]);
	assert.deepEqual(Object.keys(data.favorites).sort(), ["current", "drop", "keep"], "input is untouched");
});

test("write/read round trip through the agent directory", () => {
	const dir = tempDir();
	const path = favoritesFilePath(dir);
	assert.equal(path, join(dir, "session-favorites.json"));

	const data = addFavorite(emptyFavorites(), "session-1", "★ Deploy");
	writeFavorites(path, data);

	const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
	assert.deepEqual(raw, data);
	assert.deepEqual(readFavorites(path), data);
});

test("readFavorites on a missing file is empty, not an error", () => {
	assert.deepEqual(readFavorites(join(tempDir(), "nope.json")), emptyFavorites());
});

test("favoritesFilePath honours PI_CODING_AGENT_DIR", () => {
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = "/tmp/custom-agent-dir";
	try {
		assert.equal(favoritesFilePath(), "/tmp/custom-agent-dir/session-favorites.json");
	} finally {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
	}
});

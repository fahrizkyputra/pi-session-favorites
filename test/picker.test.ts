import assert from "node:assert/strict";
import { test } from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { FavoriteChecklist } from "../src/picker.ts";
import type { SessionRef } from "../src/types.ts";

const theme = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => text,
	bold: (text: string) => text,
	style: (text: string) => text,
} as unknown as Theme;

function refs(): SessionRef[] {
	const base = {
		messageCount: 4,
		modified: new Date(),
		cwd: "/tmp/project",
	};
	return [
		{ ...base, path: "/s/deploy.jsonl", id: "id-deploy", title: "deploy the api", searchText: "deploy the api" },
		{
			...base,
			path: "/s/auth.jsonl",
			id: "id-auth",
			name: "★ Fix auth",
			title: "fix login bug",
			searchText: "★ Fix auth\nfix login bug",
		},
		{ ...base, path: "/s/k8s.jsonl", id: "id-k8s", title: "cluster work", searchText: "cluster work" },
	];
}

function createHarness(options: { currentSessionPath?: string } = {}) {
	const results: (ReturnType<FavoriteChecklist["getChanges"]> | undefined)[] = [];
	const checklist = new FavoriteChecklist({
		title: "Favorite sessions",
		sessions: refs(),
		theme,
		currentSessionPath: options.currentSessionPath,
		requestRender: () => {},
		finish: (result) => results.push(result),
	});
	return { checklist, results, text: () => checklist.render(120).join("\n") };
}

test("opens with the current favorite state and no pending changes", () => {
	const { checklist, text } = createHarness();
	assert.equal(checklist.getFavoriteCount(), 1, "only the ★ session starts favorited");
	assert.deepEqual(checklist.getChanges(), []);
	assert.match(text(), /1 favorites · no changes yet/);
	assert.match(text(), /\[★\] Fix auth/);
	assert.match(text(), /\[ \] deploy the api/);
});

test("enter returns only the sessions whose state changed", () => {
	const { checklist, results } = createHarness();
	checklist.handleInput("\t");
	checklist.handleInput(" "); // favorite the first row (deploy)
	checklist.handleInput("\x1b[B");
	checklist.handleInput(" "); // unfavorite the ★ row (auth)
	checklist.handleInput("\r");

	assert.deepEqual(results.at(-1), [
		{ path: "/s/deploy.jsonl", favorite: true },
		{ path: "/s/auth.jsonl", favorite: false },
	]);
});

test("toggling twice leaves no change", () => {
	const { checklist, results } = createHarness();
	checklist.handleInput("\t");
	checklist.handleInput(" ");
	checklist.handleInput(" ");
	checklist.handleInput("\r");
	assert.deepEqual(results.at(-1), []);
});

test("typing searches, and space stays part of the query", () => {
	const { checklist, text } = createHarness();
	for (const char of "cluster") checklist.handleInput(char);
	assert.deepEqual(
		checklist.getVisibleSessions().map((session) => session.path),
		["/s/k8s.jsonl"],
	);
	assert.equal(checklist.getQuery(), "cluster");
	for (const char of " work") checklist.handleInput(char);
	assert.equal(checklist.getQuery(), "cluster work");
	assert.match(text(), /no changes yet/);
});

test("`a` in select mode toggles everything the search shows", () => {
	const { checklist, text } = createHarness();
	checklist.handleInput("\t");
	checklist.handleInput("a");
	assert.equal(checklist.getFavoriteCount(), 3);
	assert.match(text(), /2 changes pending/);
	checklist.handleInput("a");
	assert.equal(checklist.getFavoriteCount(), 0);
	assert.match(text(), /1 change pending/, "only the ★ session differs from the opening state");
});

test("changes survive narrowing the search", () => {
	const { checklist, results } = createHarness();
	checklist.handleInput("\t");
	checklist.handleInput(" "); // deploy → favorite
	checklist.handleInput("\t");
	for (const char of "cluster") checklist.handleInput(char);
	checklist.handleInput("\t");
	checklist.handleInput(" "); // k8s → favorite
	checklist.handleInput("\r");

	assert.deepEqual(results.at(-1), [
		{ path: "/s/deploy.jsonl", favorite: true },
		{ path: "/s/k8s.jsonl", favorite: true },
	]);
});

test("escape clears the search first, then cancels", () => {
	const { checklist, results } = createHarness();
	for (const char of "deploy") checklist.handleInput(char);
	checklist.handleInput("\x1b");
	assert.equal(checklist.getQuery(), "");
	assert.equal(checklist.getVisibleSessions().length, 3);
	assert.equal(results.length, 0);

	checklist.handleInput("\x1b");
	assert.deepEqual(results.at(-1), undefined);
});

test("the current session is tagged", () => {
	const { text } = createHarness({ currentSessionPath: "/s/auth.jsonl" });
	assert.match(text(), /\(current\)/);
});

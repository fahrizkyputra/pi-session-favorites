import assert from "node:assert/strict";
import { test } from "node:test";
import {
	HELP_TEXT,
	favoriteCurrent,
	reconcileOnOpen,
	runFavoriteCommand,
	toggleFavorites,
	unfavoriteCurrent,
} from "../src/handlers.ts";
import type { FavoriteChange, FavoritesHost, SessionRef } from "../src/types.ts";

function sessionRef(overrides: Partial<SessionRef> & { path: string }): SessionRef {
	return {
		id: `id-${overrides.path}`,
		title: "fix login bug",
		messageCount: 4,
		modified: new Date(),
		cwd: "/tmp/project",
		searchText: "fix login bug",
		...overrides,
	};
}

interface HarnessOptions {
	mode?: FavoritesHost["mode"];
	hasUI?: boolean;
	currentName?: string;
	currentTitle?: string;
	currentIsFork?: boolean;
	recorded?: string[];
	sessions?: SessionRef[];
	picked?: FavoriteChange[];
	selectReplies?: (string | undefined)[];
	names?: Record<string, string | undefined>;
	titles?: Record<string, string | undefined>;
	failWriteFor?: string;
}

function createHarness(options: HarnessOptions = {}) {
	const notifications: { message: string; type?: string }[] = [];
	const renames: (string | undefined)[] = [];
	const recorded: string[] = [...(options.recorded ?? [])];
	const writes: { path: string; name: string }[] = [];
	const selections: string[] = [];
	let selectIndex = 0;

	const host: FavoritesHost = {
		mode: options.mode ?? "tui",
		hasUI: options.hasUI ?? true,
		ui: {
			confirm: async () => true,
			notify: (message, type) => {
				notifications.push({ message, type });
			},
			select: async (title) => {
				selections.push(title);
				const replies = options.selectReplies ?? [];
				return replies[selectIndex++];
			},
		},
		currentSessionPath: "/sessions/current.jsonl",
		currentSessionId: "current-id",
		currentSessionName: options.currentName,
		currentSessionTitle: options.currentTitle,
		currentSessionIsFork: options.currentIsFork ?? false,
		isRecordedFavorite: (id) => (id === undefined ? false : recorded.includes(id)),
		recordFavorite: (id) => {
			if (!recorded.includes(id)) recorded.push(id);
		},
		forgetFavorite: (id) => {
			const index = recorded.indexOf(id);
			if (index >= 0) recorded.splice(index, 1);
		},
		setCurrentName: (name) => {
			renames.push(name);
		},
		listSessions: async () => options.sessions ?? [],
		readName: (path) => options.names?.[path],
		readTitle: (path) => options.titles?.[path],
		writeName: (path, name) => {
			if (options.failWriteFor === path) throw new Error("permission denied");
			writes.push({ path, name });
		},
		pickSessions: async () => options.picked,
	};

	return { host, notifications, renames, recorded, writes, selections };
}

test("favoriteCurrent turns the auto title into a favorite name", async () => {
	const { host, notifications, renames, recorded } = createHarness({ currentTitle: "fix login bug" });

	await favoriteCurrent(host);

	assert.deepEqual(renames, ["★ fix login bug"]);
	assert.ok(recorded.includes("current-id"));
	assert.match(notifications.at(-1)?.message ?? "", /Favorited as ★ fix login bug/);
});

test("favoriteCurrent wraps an existing name instead of the title", async () => {
	const { host, renames } = createHarness({ currentName: "Payment webhook", currentTitle: "some other text" });

	await favoriteCurrent(host);

	assert.deepEqual(renames, ["★ Payment webhook"]);
});

test("favoriteCurrent is idempotent", async () => {
	const { host, notifications, renames } = createHarness({ currentName: "★ Fix auth" });

	await favoriteCurrent(host);

	assert.deepEqual(renames, []);
	assert.match(notifications.at(-1)?.message ?? "", /Already a favorite/);
});

test("favoriteCurrent marks a brand-new session with a bare marker", async () => {
	const { host, renames } = createHarness({ currentTitle: undefined, currentName: undefined });

	await favoriteCurrent(host);

	assert.deepEqual(renames, ["★"]);
});

test("unfavoriteCurrent restores the name and forgets the session", async () => {
	const { host, notifications, renames, recorded } = createHarness({
		currentName: "★ Fix auth",
		recorded: ["current-id"],
	});

	await unfavoriteCurrent(host);

	assert.deepEqual(renames, ["Fix auth"]);
	assert.deepEqual(recorded, []);
	assert.match(notifications.at(-1)?.message ?? "", /Marker removed/);
});

test("unfavoriteCurrent clears a bare marker", async () => {
	const { host, renames } = createHarness({ currentName: "★", recorded: ["current-id"] });

	await unfavoriteCurrent(host);

	assert.deepEqual(renames, [""]);
});

test("unfavoriteCurrent on a plain session does nothing", async () => {
	const { host, notifications, renames } = createHarness({ currentName: "Fix auth" });

	await unfavoriteCurrent(host);

	assert.deepEqual(renames, []);
	assert.match(notifications.at(-1)?.message ?? "", /not a favorite/);
});

test("reconcileOnOpen keeps a recorded favorite alone", async () => {
	const { host, renames, recorded } = createHarness({ currentName: "★ Fix auth", recorded: ["current-id"] });

	await reconcileOnOpen(host);

	assert.deepEqual(renames, []);
	assert.deepEqual(recorded, ["current-id"]);
});

test("reconcileOnOpen strips a marker inherited through /fork", async () => {
	const { host, notifications, renames, recorded } = createHarness({
		currentName: "★ Fix auth",
		currentIsFork: true,
	});

	await reconcileOnOpen(host);

	assert.deepEqual(renames, ["Fix auth"]);
	assert.deepEqual(recorded, []);
	assert.match(notifications.at(-1)?.message ?? "", /inherit/);
});

test("reconcileOnOpen backfills a marker that arrived with the file", async () => {
	const { host, renames, recorded } = createHarness({ currentName: "★ From another machine" });

	await reconcileOnOpen(host);

	assert.deepEqual(renames, [], "an unrecorded marker is the truth, so the name stays");
	assert.deepEqual(recorded, ["current-id"]);
});

test("reconcileOnOpen repairs a marker removed by a manual rename", async () => {
	const { host, renames, recorded } = createHarness({
		currentName: "Fix auth renamed",
		currentTitle: "fix login bug",
		recorded: ["current-id"],
	});

	await reconcileOnOpen(host);

	assert.deepEqual(renames, ["★ Fix auth renamed"]);
	assert.deepEqual(recorded, ["current-id"]);
});

test("reconcileOnOpen fills in a bare marker once the session has a title", async () => {
	const { host, renames } = createHarness({
		currentName: "★",
		currentTitle: "first real question",
		recorded: ["current-id"],
	});

	await reconcileOnOpen(host);

	assert.deepEqual(renames, ["★ first real question"]);
});

test("toggleFavorites applies picker changes", async () => {
	const sessions = [
		sessionRef({ path: "/s/a.jsonl", name: undefined, title: "alpha task" }),
		sessionRef({ path: "/s/b.jsonl", name: "★ beta task" }),
	];
	const { host, notifications, recorded, writes } = createHarness({
		sessions,
		recorded: ["id-/s/b.jsonl"],
		picked: [
			{ path: "/s/a.jsonl", favorite: true },
			{ path: "/s/b.jsonl", favorite: false },
		],
	});

	await toggleFavorites(host);

	assert.deepEqual(writes, [
		{ path: "/s/a.jsonl", name: "★ alpha task" },
		{ path: "/s/b.jsonl", name: "beta task" },
	]);
	assert.ok(recorded.includes("id-/s/a.jsonl"));
	assert.ok(!recorded.includes("id-/s/b.jsonl"));
	assert.match(notifications.at(-1)?.message ?? "", /1 session favorited\. 1 unfavorited/);
});

test("toggleFavorites keeps the current name when favoriting a renamed session", async () => {
	const sessions = [sessionRef({ path: "/s/a.jsonl", name: "older name" })];
	const { host, writes } = createHarness({
		sessions,
		names: { "/s/a.jsonl": "renamed after the picker opened" },
		picked: [{ path: "/s/a.jsonl", favorite: true }],
	});

	await toggleFavorites(host);

	assert.deepEqual(writes, [{ path: "/s/a.jsonl", name: "★ renamed after the picker opened" }]);
});

test("toggleFavorites reports nothing when the picker returns no changes", async () => {
	const { host, notifications, writes } = createHarness({
		sessions: [sessionRef({ path: "/s/a.jsonl" })],
		picked: [],
	});

	await toggleFavorites(host);

	assert.deepEqual(writes, []);
	assert.match(notifications.at(-1)?.message ?? "", /No favorite changes/);
});

test("toggleFavorites reports write failures without skipping the rest", async () => {
	const sessions = [
		sessionRef({ path: "/s/denied.jsonl", title: "denied" }),
		sessionRef({ path: "/s/ok.jsonl", title: "fine" }),
	];
	const { host, notifications, writes } = createHarness({
		sessions,
		failWriteFor: "/s/denied.jsonl",
		picked: [
			{ path: "/s/denied.jsonl", favorite: true },
			{ path: "/s/ok.jsonl", favorite: true },
		],
	});

	await toggleFavorites(host);

	assert.deepEqual(writes, [{ path: "/s/ok.jsonl", name: "★ fine" }]);
	assert.equal(notifications.at(-1)?.type, "warning");
	assert.match(notifications.at(-1)?.message ?? "", /Failed: denied/);
});

test("toggleFavorites falls back to one-by-one dialogs outside the TUI", async () => {
	const sessions = [sessionRef({ path: "/s/a.jsonl", title: "alpha" })];
	const { host, notifications, writes } = createHarness({
		mode: "rpc",
		sessions,
		selectReplies: ["[ ] alpha", "Done — apply the changes"],
	});

	await toggleFavorites(host);

	assert.deepEqual(writes, [{ path: "/s/a.jsonl", name: "★ alpha" }]);
	assert.match(notifications.at(-1)?.message ?? "", /1 session favorited/);
});

test("runFavoriteCommand routes arguments", async () => {
	const help = createHarness();
	await runFavoriteCommand(help.host, "help");
	assert.equal(help.notifications.at(-1)?.message, HELP_TEXT);

	const unknown = createHarness();
	await runFavoriteCommand(unknown.host, "wat");
	assert.equal(unknown.notifications.at(-1)?.type, "warning");

	const plain = createHarness({ currentTitle: "do the thing" });
	await runFavoriteCommand(plain.host, "");
	assert.deepEqual(plain.renames, ["★ do the thing"]);

	const list = createHarness({ sessions: [], picked: [] });
	await runFavoriteCommand(list.host, "list");
	assert.match(list.notifications.at(-1)?.message ?? "", /No saved sessions/);

	const query = createHarness({ sessions: [sessionRef({ path: "/s/a.jsonl" })], picked: [] });
	await runFavoriteCommand(query.host, "list alpha");
	assert.match(query.notifications.at(-1)?.message ?? "", /No favorite changes/);
});

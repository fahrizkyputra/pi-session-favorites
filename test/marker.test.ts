import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { applyMarker, autoTitle, firstUserMessageText, isFavoriteName, stripMarker } from "../src/marker.ts";

test("isFavoriteName recognizes the marker and ignores leading whitespace", () => {
	assert.equal(isFavoriteName("★ Deploy script"), true);
	assert.equal(isFavoriteName("  ★ Deploy"), true);
	assert.equal(isFavoriteName("Deploy ★ script"), false);
	assert.equal(isFavoriteName(""), false);
	assert.equal(isFavoriteName(undefined), false);
});

test("applyMarker wraps a name and never doubles the marker", () => {
	assert.equal(applyMarker("Fix auth"), "★ Fix auth");
	assert.equal(applyMarker("★ Fix auth"), "★ Fix auth");
	assert.equal(applyMarker("  Fix auth  "), "★ Fix auth");
	assert.equal(applyMarker(undefined), "★");
	assert.equal(applyMarker(""), "★");
	assert.equal(applyMarker("★"), "★");
});

test("stripMarker restores the original name", () => {
	assert.equal(stripMarker("★ Fix auth"), "Fix auth");
	assert.equal(stripMarker("Fix auth"), "Fix auth");
	assert.equal(stripMarker("★"), undefined);
	assert.equal(stripMarker("★   "), undefined);
	assert.equal(stripMarker(undefined), undefined);
	assert.equal(stripMarker(""), undefined);
});

test("marker round trip keeps the user's name", () => {
	const original = "Refactor payment webhook";
	assert.equal(stripMarker(applyMarker(original)), original);
	assert.equal(stripMarker(applyMarker(applyMarker(original))), original);
});

test("autoTitle collapses whitespace and truncates", () => {
	assert.equal(autoTitle("  fix   the\n\nauth bug "), "fix the auth bug");
	assert.equal(autoTitle("   "), undefined);
	assert.equal(autoTitle(undefined), undefined);
	assert.equal(autoTitle("abcdefghij", 5), "abcd…");
	assert.equal(autoTitle("12345", 5), "12345");
});

function userEntry(text: string): SessionEntry {
	return {
		type: "message",
		id: "m1",
		parentId: null,
		timestamp: new Date(0).toISOString(),
		message: { role: "user", content: [{ type: "text", text }] },
	} as unknown as SessionEntry;
}

test("firstUserMessageText skips assistant turns and reads text parts", () => {
	const assistant = {
		type: "message",
		id: "a1",
		parentId: null,
		timestamp: new Date(0).toISOString(),
		message: { role: "assistant", content: [{ type: "text", text: "sure" }] },
	} as unknown as SessionEntry;

	assert.equal(firstUserMessageText([assistant, userEntry("real question")]), "real question");
	assert.equal(firstUserMessageText([assistant]), undefined);
	assert.equal(firstUserMessageText([]), undefined);
});

test("firstUserMessageText handles plain string content", () => {
	const entry = {
		type: "message",
		id: "m2",
		parentId: null,
		timestamp: new Date(0).toISOString(),
		message: { role: "user", content: "plain text" },
	} as unknown as SessionEntry;
	assert.equal(firstUserMessageText([entry]), "plain text");
});

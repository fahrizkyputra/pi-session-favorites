/**
 * The marker contract.
 *
 * A favorite session is a session whose display name starts with "★ ". That is
 * the only session-level field `/resume` renders (`session.name ??
 * session.firstMessage`), so the marker lives in the name and travels with the
 * session file. `pi-delete-session` reads the same constant to warn before
 * deleting a favorite.
 */

import type { SessionEntry } from "@earendil-works/pi-coding-agent";

export const FAVORITE_MARKER = "★";
export const FAVORITE_PREFIX = `${FAVORITE_MARKER} `;
export const AUTO_TITLE_MAX_LENGTH = 60;

export function isFavoriteName(name: string | undefined | null): boolean {
	if (typeof name !== "string") return false;
	return name.trimStart().startsWith(FAVORITE_MARKER);
}

/** `Fix auth` → `★ Fix auth`; an empty name becomes a bare marker. */
export function applyMarker(name: string | undefined | null): string {
	const base = stripMarker(name);
	return base ? `${FAVORITE_PREFIX}${base}` : FAVORITE_MARKER;
}

/** `★ Fix auth` → `Fix auth`; a bare marker or empty name returns undefined. */
export function stripMarker(name: string | undefined | null): string | undefined {
	if (typeof name !== "string") return undefined;
	const trimmed = name.trim();
	if (trimmed.length === 0) return undefined;
	if (!isFavoriteName(trimmed)) return trimmed;
	const rest = trimmed.slice(FAVORITE_MARKER.length).trim();
	return rest.length > 0 ? rest : undefined;
}

/** Collapse whitespace and cut to a readable title for the session list. */
export function autoTitle(text: string | undefined | null, maxLength = AUTO_TITLE_MAX_LENGTH): string | undefined {
	if (typeof text !== "string") return undefined;
	const collapsed = text.replace(/\s+/g, " ").trim();
	if (collapsed.length === 0) return undefined;
	return collapsed.length <= maxLength ? collapsed : `${collapsed.slice(0, Math.max(1, maxLength - 1))}…`;
}

/** Text of the first user message, used to auto-name an unnamed session. */
export function firstUserMessageText(entries: readonly SessionEntry[]): string | undefined {
	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const message = entry.message as { role?: string; content?: unknown };
		if (message.role !== "user") continue;
		const text = messageText(message.content);
		if (text) return text;
	}
	return undefined;
}

function messageText(content: unknown): string | undefined {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return undefined;
	const parts: string[] = [];
	for (const part of content) {
		if (typeof part === "string") parts.push(part);
		else if (part && typeof part === "object" && (part as { type?: string }).type === "text") {
			const text = (part as { text?: unknown }).text;
			if (typeof text === "string") parts.push(text);
		}
	}
	const joined = parts.join(" ").trim();
	return joined.length > 0 ? joined : undefined;
}

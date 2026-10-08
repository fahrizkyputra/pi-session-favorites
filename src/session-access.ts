/**
 * Session file access, delegated to Pi's own SessionManager so names are read
 * and written in exactly the format `/name` and the `/resume` picker use.
 */

import { SessionManager } from "@earendil-works/pi-coding-agent";
import { autoTitle, firstUserMessageText } from "./marker.ts";
import type { SessionRef } from "./types.ts";

export function readSessionName(path: string): string | undefined {
	try {
		return SessionManager.open(path).getSessionName();
	} catch {
		return undefined;
	}
}

export function readSessionTitle(path: string): string | undefined {
	try {
		return autoTitle(firstUserMessageText(SessionManager.open(path).getEntries()));
	} catch {
		return undefined;
	}
}

/** Appends a `session_info` entry. An empty name clears the display name. */
export function writeSessionName(path: string, name: string): void {
	SessionManager.open(path).appendSessionInfo(name);
}

export async function listSessionRefs(options: {
	cwd: string;
	sessionDir: string;
	onProgress?: (loaded: number, total: number) => void;
}): Promise<SessionRef[]> {
	const progress = options.onProgress
		? (loaded: number, total: number) => options.onProgress?.(loaded, total)
		: undefined;
	const sessions = await SessionManager.list(options.cwd, options.sessionDir, progress);

	return sessions.map((session) => ({
		path: session.path,
		id: session.id,
		...(session.name === undefined ? {} : { name: session.name }),
		title: autoTitle(session.firstMessage) ?? autoTitle(session.name) ?? "(untitled)",
		messageCount: session.messageCount,
		modified: session.modified,
		cwd: session.cwd,
		searchText: [session.name, session.firstMessage, session.allMessagesText, session.cwd]
			.filter((value): value is string => typeof value === "string")
			.join("\n"),
	}));
}

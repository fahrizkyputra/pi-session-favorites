/**
 * pi-session-favorites — /favorite, /unfavorite, /favorite list.
 *
 * A favorite session carries "★ " at the front of its display name, which is
 * the only session-level field `/resume` renders. The sidecar file in the agent
 * directory records which session IDs are meant to be favorites so the marker
 * can be repaired after a manual `/name` rename.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
	addFavorite,
	type FavoritesData,
	favoritesFilePath,
	isFavoriteId,
	pruneFavorites,
	readFavorites,
	removeFavorite,
	writeFavorites,
} from "../src/favorites-store.ts";
import { favoriteCurrent, reconcileOnOpen, runFavoriteCommand, unfavoriteCurrent } from "../src/handlers.ts";
import { autoTitle, firstUserMessageText } from "../src/marker.ts";
import { pickFavorites } from "../src/picker.ts";
import { listSessionRefs, readSessionName, readSessionTitle, writeSessionName } from "../src/session-access.ts";
import type { FavoritesHost } from "../src/types.ts";

const STATUS_KEY = "session-favorites";

function mutateStore(mutate: (data: FavoritesData) => FavoritesData): FavoritesData {
	const path = favoritesFilePath();
	const next = mutate(readFavorites(path));
	writeFavorites(path, next);
	return next;
}

async function allSessionIds(): Promise<string[]> {
	try {
		const sessions = await SessionManager.listAll();
		return sessions.map((session) => session.id);
	} catch {
		return [];
	}
}

/** Drop sidecar entries whose session files no longer exist. */
function pruneDeadFavorites(currentSessionId: string | undefined): void {
	void allSessionIds().then((ids) => {
		if (ids.length === 0) return;
		const known = currentSessionId ? [...ids, currentSessionId] : ids;
		mutateStore((data) => pruneFavorites(data, known));
	});
}

function hostFromContext(pi: ExtensionAPI, ctx: ExtensionContext): FavoritesHost {
	const header = ctx.sessionManager.getHeader();
	return {
		mode: ctx.mode,
		hasUI: ctx.hasUI,
		ui: {
			confirm: (title, message) => ctx.ui.confirm(title, message),
			notify: (message, type) => ctx.ui.notify(message, type),
			select: (title, options) => ctx.ui.select(title, options),
		},
		currentSessionPath: ctx.sessionManager.getSessionFile(),
		currentSessionId: ctx.sessionManager.getSessionId(),
		currentSessionName: pi.getSessionName() ?? ctx.sessionManager.getSessionName(),
		currentSessionTitle: autoTitle(firstUserMessageText(ctx.sessionManager.getEntries())),
		currentSessionIsFork: header?.parentSession !== undefined,
		isRecordedFavorite: (sessionId) => isFavoriteId(readFavorites(favoritesFilePath()), sessionId),
		recordFavorite: (sessionId, name) => {
			mutateStore((data) => addFavorite(data, sessionId, name));
		},
		forgetFavorite: (sessionId) => {
			mutateStore((data) => removeFavorite(data, sessionId));
		},
		setCurrentName: (name) => {
			pi.setSessionName(name ?? "");
		},
		listSessions: async () => {
			try {
				const sessions = await listSessionRefs({
					cwd: ctx.cwd,
					sessionDir: ctx.sessionManager.getSessionDir(),
					onProgress: (loaded, total) => ctx.ui.setStatus(STATUS_KEY, `Loading sessions ${loaded}/${total}`),
				});
				// Housekeeping belongs to this explicit user action, not to startup.
				pruneDeadFavorites(ctx.sessionManager.getSessionId());
				return sessions;
			} finally {
				ctx.ui.setStatus(STATUS_KEY, undefined);
			}
		},
		readName: (path) => readSessionName(path),
		readTitle: (path) => readSessionTitle(path),
		writeName: (path, name) => {
			writeSessionName(path, name);
		},
		pickSessions: async (sessions, options) => await pickFavorites(ctx, sessions, options),
	};
}

export default function sessionFavoritesExtension(pi: ExtensionAPI) {
	pi.registerCommand("favorite", {
		description: "Mark the current session as a favorite (★ in the name), or pick sessions to favorite",
		getArgumentCompletions: (prefix) => {
			const options = [
				{ value: "list", label: "list — pick sessions to favorite/unfavorite" },
				{ value: "help", label: "help — usage" },
			];
			const filtered = options.filter((option) => option.value.startsWith(prefix));
			return filtered.length > 0 ? filtered : null;
		},
		handler: async (args, ctx) => {
			await runFavoriteCommand(hostFromContext(pi, ctx), args);
		},
	});

	pi.registerCommand("unfavorite", {
		description: "Remove the favorite marker (★) from the current session",
		handler: async (_args, ctx) => {
			await unfavoriteCurrent(hostFromContext(pi, ctx));
		},
	});

	// Repair or strip the marker whenever a session opens.
	pi.on("session_start", async (_event, ctx) => {
		try {
			await reconcileOnOpen(hostFromContext(pi, ctx));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			ctx.ui.notify(`pi-session-favorites: could not reconcile the ★ marker (${message})`, "warning");
		}
	});
}

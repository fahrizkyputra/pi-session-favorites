/**
 * Command logic for the favorite-session commands, behind an injected host so
 * it runs and is tested without Pi.
 */

import { applyMarker, isFavoriteName, stripMarker } from "./marker.ts";
import type { FavoriteChange, FavoritesHost, SessionRef } from "./types.ts";

export const HELP_TEXT = [
	"/favorite — mark the current session as a favorite (★ in the session name)",
	"/unfavorite — remove the favorite marker from the current session",
	"/favorite list — pick sessions to favorite or unfavorite (type to search)",
	"",
	"Favorites show up in /resume as `★ Name`, so Ctrl+N (Name: Named) or a",
	"search for ★ narrows the list to sessions you marked.",
].join("\n");

export async function runFavoriteCommand(host: FavoritesHost, rawArgs: string): Promise<void> {
	const args = rawArgs.trim();
	const head = args.split(/\s+/)[0]?.toLowerCase() ?? "";

	if (head === "help" || head === "--help" || head === "-h") {
		host.ui.notify(HELP_TEXT, "info");
		return;
	}

	if (head === "list" || head === "--list" || head === "-l" || head === "pick") {
		await toggleFavorites(host, args.slice(head.length).trim());
		return;
	}

	if (head.length > 0) {
		host.ui.notify(`Unknown argument "${head}". Try /favorite list or /favorite help.`, "warning");
		return;
	}

	await favoriteCurrent(host);
}

export async function favoriteCurrent(host: FavoritesHost): Promise<void> {
	const name = host.currentSessionName;
	if (isFavoriteName(name)) {
		host.ui.notify(`Already a favorite: ${name}`, "info");
		return;
	}

	const base = name?.trim() ?? host.currentSessionTitle;
	const next = applyMarker(base);
	host.setCurrentName(next);
	if (host.currentSessionId) host.recordFavorite(host.currentSessionId, next);
	host.ui.notify(`Favorited as ${next} — it now shows in /resume.`, "info");
}

export async function unfavoriteCurrent(host: FavoritesHost): Promise<void> {
	const name = host.currentSessionName;
	if (!isFavoriteName(name)) {
		host.ui.notify("This session is not a favorite.", "info");
		return;
	}

	const remaining = stripMarker(name);
	host.setCurrentName(remaining ?? "");
	if (host.currentSessionId) host.forgetFavorite(host.currentSessionId);
	host.ui.notify(
		remaining ? `Marker removed. Session is now "${remaining}".` : "Marker removed. Session has no name again.",
		"info",
	);
}

/** Repair or strip a marker when a session opens. Called from session_start. */
export async function reconcileOnOpen(host: FavoritesHost): Promise<void> {
	const name = host.currentSessionName;
	const id = host.currentSessionId;
	const marked = isFavoriteName(name);
	const recorded = host.isRecordedFavorite(id);

	if (marked && !recorded) {
		if (host.currentSessionIsFork) {
			// /fork and /clone copy the parent's name, including the marker.
			// A fork is new work, so it starts without the favorite marker.
			const stripped = stripMarker(name);
			host.setCurrentName(stripped ?? "");
			host.ui.notify("Removed the inherited ★: forked sessions do not inherit favorites.", "info");
			return;
		}
		// A marker that came from another machine (or an older pi) is the truth.
		if (id) host.recordFavorite(id, name ?? undefined);
		return;
	}

	if (!marked && recorded) {
		const target = applyMarker(name?.trim() ?? host.currentSessionTitle);
		host.setCurrentName(target);
		return;
	}

	if (marked && name?.trim() === "★" && host.currentSessionTitle) {
		// A favorite marked before it had any message gets its title now.
		const target = applyMarker(host.currentSessionTitle);
		if (id) host.recordFavorite(id, target);
		host.setCurrentName(target);
	}
}

export async function toggleFavorites(host: FavoritesHost, query?: string): Promise<void> {
	if (!host.hasUI) {
		host.ui.notify("/favorite list needs an interactive UI. Run it in the TUI.", "warning");
		return;
	}

	const sessions = await host.listSessions();
	if (sessions.length === 0) {
		host.ui.notify("No saved sessions found.", "info");
		return;
	}

	const changes =
		host.mode === "tui"
			? await host.pickSessions(query ? filterSessions(sessions, query) : sessions, {
					title: "Favorite sessions",
					currentSessionPath: host.currentSessionPath,
				})
			: await toggleOneByOne(host, query ? filterSessions(sessions, query) : sessions);

	if (!changes || changes.length === 0) {
		host.ui.notify("No favorite changes.", "info");
		return;
	}

	let added = 0;
	let removed = 0;
	const failures: string[] = [];

	for (const change of changes) {
		const session = sessions.find((candidate) => candidate.path === change.path);
		if (!session) continue;
		try {
			applyChange(host, change, session);
			if (change.favorite) added++;
			else removed++;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			failures.push(`${session.title}: ${message}`);
		}
	}

	const parts: string[] = [];
	if (added > 0) parts.push(`${added} session${added === 1 ? "" : "s"} favorited`);
	if (removed > 0) parts.push(`${removed} unfavorited`);
	if (parts.length === 0) parts.push("No favorite changes");
	if (failures.length > 0) parts.push(`Failed: ${failures.join("; ")}`);

	host.ui.notify(parts.join(". "), failures.length > 0 ? (added + removed === 0 ? "error" : "warning") : "info");
}

function applyChange(host: FavoritesHost, change: FavoriteChange, session: SessionRef): void {
	// Read the name again: the session may have been renamed after the picker
	// listed it, and the marker has to wrap the current name.
	const currentName = host.readName(session.path) ?? session.name;
	if (change.favorite) {
		if (isFavoriteName(currentName)) {
			host.recordFavorite(session.id, currentName ?? undefined);
			return;
		}
		const title = currentName?.trim() ?? host.readTitle(session.path) ?? session.title;
		const next = applyMarker(title);
		host.writeName(session.path, next);
		host.recordFavorite(session.id, next);
		return;
	}

	host.forgetFavorite(session.id);
	if (!isFavoriteName(currentName)) return;
	const stripped = stripMarker(currentName);
	host.writeName(session.path, stripped ?? "");
}

async function toggleOneByOne(host: FavoritesHost, sessions: SessionRef[]): Promise<FavoriteChange[]> {
	const doneLabel = "Done — apply the changes";
	const changes: FavoriteChange[] = [];
	const pending = new Map<string, boolean>();

	for (;;) {
		const labels = sessions.map((session) => {
			const pendingState = pending.get(session.path) ?? isFavoriteName(session.name);
			const box = pendingState ? "[★]" : "[ ]";
			return `${box} ${session.title}`;
		});
		const choice = await host.ui.select("Toggle favorites (pick a session)", [...labels, doneLabel]);
		if (!choice || choice === doneLabel) break;
		const index = labels.indexOf(choice);
		const session = sessions[index];
		if (!session) continue;
		const next = !(pending.get(session.path) ?? isFavoriteName(session.name));
		pending.set(session.path, next);
	}

	for (const [path, favorite] of pending) {
		if (favorite !== isFavoriteName(sessions.find((session) => session.path === path)?.name)) {
			changes.push({ path, favorite });
		}
	}
	return changes;
}

export function filterSessions(sessions: SessionRef[], query: string): SessionRef[] {
	const needle = query.trim().toLowerCase();
	if (needle.length === 0) return sessions;
	return sessions.filter((session) => session.searchText.toLowerCase().includes(needle));
}

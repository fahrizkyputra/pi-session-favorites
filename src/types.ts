/**
 * Shared types for the favorite-session command logic. Everything here is
 * plain data so the handlers stay testable without Pi.
 */

export type ExtensionMode = "tui" | "rpc" | "json" | "print";

export interface SessionRef {
	path: string;
	id: string;
	/** Display name from the session file, marker included when present. */
	name?: string;
	/** Auto title from the first user message. */
	title: string;
	messageCount: number;
	modified: Date;
	cwd: string;
	/** Name plus message text, used by the picker's search field. */
	searchText: string;
}

export interface FavoriteSessionUI {
	confirm(title: string, message: string): Promise<boolean>;
	notify(message: string, type?: "info" | "warning" | "error"): void;
	select(title: string, options: string[]): Promise<string | undefined>;
}

/** One session whose favorite state the user changed in the picker. */
export interface FavoriteChange {
	path: string;
	favorite: boolean;
}

export interface FavoritesHost {
	mode: ExtensionMode;
	hasUI: boolean;
	ui: FavoriteSessionUI;
	/** Active session file, undefined when the session is not on disk yet. */
	currentSessionPath: string | undefined;
	currentSessionId: string | undefined;
	/** Current session display name, marker included. */
	currentSessionName: string | undefined;
	/** Auto title for the active session. */
	currentSessionTitle: string | undefined;
	/** True when the active session's header points at a parent session. */
	currentSessionIsFork: boolean;
	isRecordedFavorite(sessionId: string | undefined): boolean;
	recordFavorite(sessionId: string, name?: string): void;
	forgetFavorite(sessionId: string): void;
	setCurrentName(name: string | undefined): void;
	listSessions(): Promise<SessionRef[]>;
	readName(path: string): string | undefined;
	readTitle(path: string): string | undefined;
	writeName(path: string, name: string): void;
	pickSessions(
		sessions: SessionRef[],
		options: { title: string; currentSessionPath?: string },
	): Promise<FavoriteChange[] | undefined>;
}

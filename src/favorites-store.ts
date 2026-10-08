/**
 * Sidecar store: which session IDs are meant to be favorites.
 *
 * The ★ in the session name is the truth the UI shows. This file exists so the
 * marker can be repaired after a manual `/name` rename, and so a favorite can
 * be recognized again when the user reopens it. Reads and writes are plain
 * functions over a data object; the extension owns the file IO.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const FAVORITES_FILE_NAME = "session-favorites.json";

export interface FavoriteRecord {
	/** ISO timestamp of the last time the session was marked favorite. */
	markedAt: string;
	/** Name captured at marking time, for debugging and repair context. */
	name?: string;
}

export interface FavoritesData {
	version: 1;
	favorites: Record<string, FavoriteRecord>;
}

export function emptyFavorites(): FavoritesData {
	return { version: 1, favorites: {} };
}

export function agentDir(): string {
	const override = process.env.PI_CODING_AGENT_DIR?.trim();
	return override && override.length > 0 ? override : join(homedir(), ".pi", "agent");
}

export function favoritesFilePath(agentDirectory: string = agentDir()): string {
	return join(agentDirectory, FAVORITES_FILE_NAME);
}

export function parseFavorites(raw: string | undefined): FavoritesData {
	if (!raw || raw.trim().length === 0) return emptyFavorites();
	try {
		const parsed = JSON.parse(raw) as Partial<FavoritesData> | undefined;
		const favorites = parsed?.favorites;
		if (!favorites || typeof favorites !== "object") return emptyFavorites();
		const clean: Record<string, FavoriteRecord> = {};
		for (const [id, record] of Object.entries(favorites)) {
			if (typeof id !== "string" || id.length === 0) continue;
			const markedAt =
				record && typeof (record as FavoriteRecord).markedAt === "string"
					? (record as FavoriteRecord).markedAt
					: new Date(0).toISOString();
			const name = record && typeof (record as FavoriteRecord).name === "string" ? (record as FavoriteRecord).name : undefined;
			clean[id] = name === undefined ? { markedAt } : { markedAt, name };
		}
		return { version: 1, favorites: clean };
	} catch {
		return emptyFavorites();
	}
}

export function readFavorites(path: string): FavoritesData {
	try {
		return parseFavorites(readFileSync(path, "utf8"));
	} catch {
		return emptyFavorites();
	}
}

export function writeFavorites(path: string, data: FavoritesData): void {
	mkdirSync(dirname(path), { recursive: true });
	const temporary = `${path}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`);
	renameSync(temporary, path);
}

export function isFavoriteId(data: FavoritesData, sessionId: string | undefined): boolean {
	return typeof sessionId === "string" && sessionId.length > 0 && sessionId in data.favorites;
}

export function addFavorite(data: FavoritesData, sessionId: string, name?: string): FavoritesData {
	if (sessionId.length === 0) return data;
	const record: FavoriteRecord = { markedAt: new Date().toISOString() };
	if (name !== undefined) record.name = name;
	return { version: 1, favorites: { ...data.favorites, [sessionId]: record } };
}

export function removeFavorite(data: FavoritesData, sessionId: string): FavoritesData {
	if (!(sessionId in data.favorites)) return data;
	const next = { ...data.favorites };
	delete next[sessionId];
	return { version: 1, favorites: next };
}

/** Drop records whose session no longer exists anywhere on disk. */
export function pruneFavorites(data: FavoritesData, existingSessionIds: Iterable<string>): FavoritesData {
	const keep = new Set(existingSessionIds);
	const favorites: Record<string, FavoriteRecord> = {};
	for (const [id, record] of Object.entries(data.favorites)) {
		if (keep.has(id)) favorites[id] = record;
	}
	return { version: 1, favorites };
}

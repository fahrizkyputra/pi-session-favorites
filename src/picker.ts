/**
 * Interactive multi-select checklist for favorite/unfavorite, with a live
 * search field. TUI only; other modes fall back to one-by-one dialogs in
 * handlers.ts.
 *
 * Same key model as Pi's own pickers: printable keys go to the search input,
 * arrows move, Enter confirms. Tab switches to a select mode where Space
 * toggles the highlighted session and `a` toggles everything the search shows.
 */

import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { type Component, type Focusable, Input, Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { isFavoriteName, stripMarker } from "./marker.ts";
import type { FavoriteChange, SessionRef } from "./types.ts";

export interface PickFavoritesOptions {
	title: string;
	currentSessionPath?: string;
}

export async function pickFavorites(
	ctx: ExtensionContext,
	sessions: SessionRef[],
	options: PickFavoritesOptions,
): Promise<FavoriteChange[] | undefined> {
	if (sessions.length === 0) return undefined;

	return await ctx.ui.custom<FavoriteChange[] | undefined>((tui, theme, _keybindings, done) => {
		return new FavoriteChecklist({
			title: options.title,
			sessions,
			theme,
			currentSessionPath: options.currentSessionPath,
			requestRender: () => tui.requestRender(),
			finish: done,
		});
	});
}

export interface ChecklistInit {
	title: string;
	sessions: SessionRef[];
	theme: Theme;
	currentSessionPath?: string;
	requestRender: () => void;
	finish: (result: FavoriteChange[] | undefined) => void;
}

type ChecklistFocus = "search" | "list";

export class FavoriteChecklist implements Component, Focusable {
	private title: string;
	private sessions: SessionRef[];
	private theme: Theme;
	private currentSessionPath?: string;
	private requestRender: () => void;
	private finish: (result: FavoriteChange[] | undefined) => void;
	private searchInput: Input;
	private filtered: SessionRef[];
	private desired = new Map<string, boolean>();
	private initial = new Map<string, boolean>();
	private searchText = "";
	private index = 0;
	private maxVisible = 12;
	private focus: ChecklistFocus = "search";
	private _focused = false;

	constructor(init: ChecklistInit) {
		this.title = init.title;
		this.sessions = init.sessions;
		this.theme = init.theme;
		this.currentSessionPath = init.currentSessionPath;
		this.requestRender = init.requestRender;
		this.finish = init.finish;
		this.searchInput = new Input({ prompt: "⌕ ", placeholder: "type to search sessions" });
		this.filtered = init.sessions;
		for (const session of init.sessions) {
			const favorite = isFavoriteName(session.name);
			this.desired.set(session.path, favorite);
			this.initial.set(session.path, favorite);
		}
	}

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
		this.searchInput.focused = value && this.focus === "search";
	}

	getQuery(): string {
		return this.searchInput.getValue();
	}

	getVisibleSessions(): SessionRef[] {
		return this.filtered;
	}

	getFocus(): ChecklistFocus {
		return this.focus;
	}

	/** Sessions whose favorite state differs from the state at open time. */
	getChanges(): FavoriteChange[] {
		const changes: FavoriteChange[] = [];
		for (const [path, desired] of this.desired) {
			if (desired !== (this.initial.get(path) ?? false)) changes.push({ path, favorite: desired });
		}
		return changes;
	}

	getFavoriteCount(): number {
		let count = 0;
		for (const favorite of this.desired.values()) if (favorite) count++;
		return count;
	}

	invalidate(): void {
		this.searchInput.invalidate();
	}

	render(width: number): string[] {
		const theme = this.theme;
		const lines: string[] = [];
		const push = (line: string) => lines.push(truncateToWidth(line, width));

		push(theme.fg("accent", theme.bold(this.title)));
		for (const line of this.searchInput.render(width)) push(line);
		push(theme.fg("muted", "─".repeat(Math.max(1, Math.min(width, 40)))));

		const total = this.filtered.length;
		if (total === 0) {
			push(theme.fg("warning", `  no sessions match "${this.searchInput.getValue()}"`));
		} else {
			const visible = Math.max(1, Math.min(this.maxVisible, total));
			const start = Math.max(0, Math.min(this.index - Math.floor(visible / 2), total - visible));
			const end = Math.min(total, start + visible);

			if (start > 0) push(theme.fg("muted", `  ↑ ${start} more`));

			for (let i = start; i < end; i++) {
				const session = this.filtered[i];
				if (!session) continue;
				const isCursor = i === this.index;
				const favorite = this.desired.get(session.path) ?? false;
				const changed = favorite !== (this.initial.get(session.path) ?? false);
				const isCurrent = this.currentSessionPath !== undefined && session.path === this.currentSessionPath;

				const cursor = isCursor ? theme.fg("accent", "❯ ") : "  ";
				const box = favorite ? theme.fg("success", "[★]") : theme.fg("muted", "[ ]");
				const label = this.labelFor(session);
				const rendered = isCursor ? theme.bold(label) : label;
				const currentTag = isCurrent ? theme.fg("warning", " (current)") : "";
				const changedTag = changed ? theme.fg("accent", " •") : "";
				const meta = theme.fg("muted", ` — ${age(session.modified)} · ${session.messageCount} msg`);
				push(`${cursor}${box} ${rendered}${currentTag}${meta}${changedTag}`);
			}

			if (end < total) push(theme.fg("muted", `  ↓ ${total - end} more`));
			if (this.searchInput.getValue().trim().length > 0) {
				push(theme.fg("muted", `  ${total} of ${this.sessions.length} shown`));
			}
		}

		push("");
		const hints =
			this.focus === "search"
				? `searching · ↑↓ move · tab: select mode · enter: apply · esc: clear`
				: `[list] ↑↓ move · space toggle · a all shown · tab: search · enter: apply · esc: back`;
		const changed = this.getChanges().length;
		const summary = changed > 0 ? `${changed} change${changed === 1 ? "" : "s"} pending` : "no changes yet";
		push(theme.fg("muted", `${this.getFavoriteCount()} favorites · ${summary} · ${hints}`));

		return lines;
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.tab)) {
			this.setFocus(this.focus === "search" ? "list" : "search");
			return;
		}

		if (matchesKey(data, Key.escape)) {
			if (this.focus === "list") {
				this.setFocus("search");
				return;
			}
			if (this.searchInput.getValue().length > 0) {
				this.searchInput.setValue("");
				this.refilter();
				return;
			}
			this.finish(undefined);
			return;
		}

		if (matchesKey(data, Key.enter)) {
			this.finish(this.getChanges());
			return;
		}

		if (matchesKey(data, Key.up)) return this.move(-1);
		if (matchesKey(data, Key.down)) return this.move(1);
		if (matchesKey(data, Key.pageUp)) return this.move(-10);
		if (matchesKey(data, Key.pageDown)) return this.move(10);

		if (this.focus === "list") {
			if (matchesKey(data, Key.space)) return this.toggleCurrent();
			if (data === "a") return this.toggleAllShown();
			if (data === "j") return this.move(1);
			if (data === "k") return this.move(-1);
			return;
		}

		this.searchInput.handleInput(data);
		this.refilter();
	}

	private labelFor(session: SessionRef): string {
		const stripped = stripMarker(session.name);
		return stripped ?? session.title;
	}

	private setFocus(focus: ChecklistFocus): void {
		this.focus = focus;
		this.searchInput.focused = this._focused && focus === "search";
		this.requestRender();
	}

	private refilter(): void {
		const query = this.searchInput.getValue().trim().toLowerCase();
		this.searchText = query;
		this.filtered =
			query.length === 0 ? this.sessions : this.sessions.filter((s) => s.searchText.toLowerCase().includes(query));
		this.index = Math.max(0, Math.min(this.index, Math.max(0, this.filtered.length - 1)));
		this.requestRender();
	}

	private move(delta: number): void {
		if (this.filtered.length === 0) return;
		this.index = Math.max(0, Math.min(this.filtered.length - 1, this.index + delta));
		this.requestRender();
	}

	private toggleCurrent(): void {
		const session = this.filtered[this.index];
		if (!session) return;
		this.desired.set(session.path, !(this.desired.get(session.path) ?? false));
		this.requestRender();
	}

	private toggleAllShown(): void {
		const allOn = this.filtered.length > 0 && this.filtered.every((s) => this.desired.get(s.path) ?? false);
		for (const session of this.filtered) this.desired.set(session.path, !allOn);
		this.requestRender();
	}
}

function age(date: Date, now: Date = new Date()): string {
	const seconds = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));
	if (seconds < 60) return "just now";
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	return `${Math.round(hours / 24)}d ago`;
}

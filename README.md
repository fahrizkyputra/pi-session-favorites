# pi-session-favorites

Mark Pi sessions as favorites, so `/resume` tells you which ones you meant to come back to.

A favorite is a session whose display name starts with `★ `. That is the only session-level field `/resume` renders (`session.name ?? session.firstMessage`), so the marker appears exactly where you pick a session — and it travels with the session file, shows up in pi-web, and is searchable.

```
/resume

  ★ Fix login bug in auth service     ← favorite, titled automatically
  ★ Refactor payment webhook          ← favorite, your original name kept
    deploy script experiment
    (untitled)
```

## Install

```bash
pi install npm:@fahrizkyputra/pi-session-favorites
```

## Usage

| Command | What it does |
|---|---|
| `/favorite` | Marks the current session: `★ ` in front of its name (auto-titles an unnamed session from its first message) |
| `/unfavorite` | Removes the marker; the original name comes back |
| `/favorite list` | Opens a searchable checklist of sessions in this project to favorite or unfavorite in bulk |
| `/favorite help` | Usage summary |

Checklist keys: type to search, `↑`/`↓` move, `tab` switches between search and select mode, `space` toggles a session, `a` toggles everything the search shows, `enter` applies, `esc` clears the search first.

## Finding your favorites in /resume

- **Search for `★`** (or `re:^★`) — the picker searches names, so this lists favorites only.
- **`Ctrl+N`** switches `Name: All` → `Name: Named`, which filters to sessions that have any name (not only favorites).
- Favorites do **not** sort to the top: `/resume` sorts by recency or thread and gives extensions no way to change that.

## How it works

- Names are written through Pi's own API: `pi.setSessionName()` for the current session, `SessionManager.appendSessionInfo()` for the others, so the file format matches `/name` exactly.
- `~/.pi/agent/session-favorites.json` records which session IDs are meant to be favorites. It exists to **repair**, not to decide: the `★` in the name is the truth. A session carrying `★` without a local record (copied from another machine) is adopted and recorded.
- If you rename a favorite with `/name`, the marker is re-applied the next time that session opens.
- `/fork` and `/clone` copy the parent's name, so a new branch would inherit `★`. It does not: the marker is stripped when the forked session opens, because a branch is new work.
- Sessions with no messages yet get a bare `★` and receive their title once the first message exists.
- Unfavoriting a bare `★` clears the name, putting the session back to its first-message label.

## Notes

- Deleting a favorite is still possible. If you also use [`pi-delete-session`](https://pi.dev/packages/@fahrizkyputra/pi-delete-session), version 0.2.0+ asks for a second confirmation before removing favorites.
- The marker is a plain name prefix, so `Ctrl+N` shows every named session, not favorites exclusively. The `★` search is the exclusive filter.

## Development

```bash
npm install
npm test          # node:test, no Pi required
npm run typecheck # tsc --noEmit
npm run test:e2e  # real Pi over RPC: runs /favorite, checks the session file and the sidecar
```

## License

MIT

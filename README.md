# dsh-archive-purge

Keeps archived sessions out of the DSH conversation list, and gives them one place to be restored — or **deleted for good**, which DSH itself deliberately has no path for.

> Looking for the npm name `dsh-archive-manager`? That one belongs to a different, unrelated
> plugin. This is `dsh-archive-purge`.

![The archived-session panel](https://raw.githubusercontent.com/joyboy-yy/dsh-archive-purge/main/docs/panel.png)

*Every screenshot here is rendered from invented sessions — no real titles, paths or sizes.*

## The two gaps it closes

DSH can archive a session, but:

- **Archiving is only a view concern.** The sidebar keeps rendering archived rows whenever *View options → Archived* is set to show them, and it keeps them in archived search results too. There is no switch that means "never show these".
- **Nothing ever deletes a session.** `dsh-client-ui-workspace` documents no session deletion and `dsh-session-persistence` documents no delete seam, so archived sessions accumulate on disk forever.

This plugin closes both: it pins archived sessions out of the list, and it owns the erase path.

## Install

```sh
dsh plugin --profile desktop add dsh-archive-purge
```

Use your own profile name in place of `desktop` (for example `web`). Then switch it on under **Settings → Plugins**, where it appears as `dsh-archive-purge`. Turning it off disables the host routes and the browser panel together and leaves session data untouched.

## What it does

| | Behaviour |
|---|---|
| **Always hidden** | In the sidebar conversation list, an archived session row is never shown — whatever *View options → Archived* is set to. A component registered on `shell.overlay` writes `[data-row-key="session:<id>"]{display:none}` for every id in the registry's `archivedSessionIds`, plus a fallback rule keyed on the accessible description so archived search-result rows are covered as well. |
| **Filter reset** | The browser-persisted `dsh.workspace.view.v5` has its `archivedFilter` reset to the shipped default (`default`, i.e. "hide archived"), so the menu stops claiming "All conversations (show archived)" while showing nothing. |
| **Management panel** | A sidebar icon plus a centre-column panel lists every archived session with its workspace, path, disk footprint, creation time and child-session count; it supports search, multi-select and batch unarchive. |
| **Permanent delete** | Delete sessions one at a time or in bulk, behind a confirmation dialog that names the sessions, their size, and exactly what will be removed. |

## Permanent delete: the exact boundary

![The confirmation dialog](https://raw.githubusercontent.com/joyboy-yy/dsh-archive-purge/main/docs/confirm.png)

One delete removes four things:

1. **The session log directory** `<DSH_HOME>/sessions/<project>/<encoded-session-id>/` — the session's own directory, every format generation in it, and any session-local artifact;
2. **The projection-cache record** `<DSH_HOME>/storages/session_projcache/sessions/<id>.json`;
3. **The archive and pin records** (`archivedSessionIds` / `pinnedSessionIds` in the workspace registry);
4. **The row in your browser** — announced through the session controller's own `api-session/removed` remote event (`@mode emit`) so the client drops the row instead of leaving a clickable ghost.

**Deliberately kept:** attachment files. Attachments are content-addressed and may be shared with other sessions, so they are out of scope. The panel says so at the bottom. An archived entry whose log is already gone from disk only has its record cleaned up, and the button reads "Clear record" instead.

## Refusals run before any write

- The session is **not in the archive set** → skipped. Deletion is only ever available for archived sessions.
- An **agent for that session still exists in this process** (`ctx.agents.get(id)`) → refused (`live`). An agent may already hold the log's write handle, and deleting the file underneath it would let the writer resurrect the log.
- The `workspace/session-activity` waterfall still reports **work in progress** → refused (`active`).
- The target directory is not **inside the configured sessions root**, or its name is not exactly the encoded session id → refused (`outside-root`).

Being merely *loaded* is deliberately **not** a refusal reason: the browser keeps an in-memory mirror for every rendered session row and never releases it, so refusing on that would make every archived session undeletable after enough browsing. The gate matches DSH's own archive gate (the activity waterfall) plus one cheaper agent check. Skipped and failed sessions are listed individually in the panel, with the reason.

## Ghost rows, and the two layers that remove them

DSH's browser session list is **event-driven**: it only adds and removes entries in response to `api-session/added` / `api-session/removed`. A deleted session also leaves the archive set, so in the sidebar it goes from "hidden" to "should be shown" — and the cached row becomes a visible, clickable row that fails with `session/not-found` when opened.

Two layers remove it:

- **Host side (authoritative).** After a successful delete and *before* the archive set is rewritten, the host emits `ctx.emit('api-session/removed', id)` — the remote event the session controller defines and forwards for exactly this fact. The client receives a `{ kind: 'remove', sessionId }` change and drops the row. Emitting before the registry write avoids a flash where the row is un-hidden and then disappears.
- **Client side (self-healing fallback).** The inventory carries `persistedIds` — the session ids the host's persistence layer actually knows. The panel diffs the browser's cached ids against it, folds the remainder into the same hide rule, and shows the count under the title. The diff is recomputed on every read rather than accumulated, so one failed read cannot permanently hide a live session. Ids deleted within this page session are tracked separately as a union, since that needs no read to take effect.

**If you deleted sessions before both layers existed**, those leftover rows need one page reload to disappear — the client re-fetches the list from the host on load. Deletions made afterwards do not leave them.

## Known leftovers

- **Dangling ids in workspace membership.** `tables.workspaces.<id>.sessionIds` is a persisted member array and the host exposes no "remove a member" operation (`insertSessionBefore` only inserts and orders). A deleted session's id therefore stays in that array. DSH tolerates missing members — it looks up a summary while deriving rows and skips what it cannot find — so this never renders as a row. It is bookkeeping residue, not a UI problem.
- **Agent lifetime.** Archiving only stops, hides and gates a session; it does not destroy the agent. Agents are reclaimed when the agent-loop provider unloads or the process exits. A session archived in the current DSH process is therefore refused by this plugin until you restart DSH. See *Refusals* above.

## Maintenance notes

- To land a delete precisely, the host half **copies verbatim** the `encodeSegment` function from `dsh-session-persistence-jsonl`. If a DSH upgrade changes the session directory layout, that function has to follow it. Until then a delete refuses (because the directory name is not the encoded session id, or holds no session log) rather than removing the wrong thing.
- The client hide rule depends on the sidebar's `data-row-key="session:<id>"` attribute, which `dsh-client-ui-workspace` adds itself. If that ever changes, the `aria-description` fallback rule still applies.
- There is **no build step and no runtime dependency**: both halves are plain ESM shipped as-is, and the host half imports nothing but Node builtins.
- Host-half edits do **not** hot-reload (Node's ESM cache keys on path) — restart DSH or re-enable the bundle in the Plugins page. `client.js` is replaced by client-side HMR automatically.

## Trade-offs

- The built-in *View options → Archived* still offers its three choices, but because archived rows are force-hidden, picking "All conversations (show archived)" will not bring them back to the sidebar. That is the direct consequence of "archived must be hidden, and managed in one panel".
- Deleting a session does not cascade to sessions forked from it. The panel shows the child-session count as a hint.
- Under a non-Chinese, non-English locale, relative times and the fallback CSS use one of the two shipped wordings (English or Chinese).

## Development

There is nothing to build — both halves ship as they are written. To check a change:

```sh
npm test
```

`npm test` runs 22 tests on `node --test` with no dependencies. The test directory is not part of the published package.

- `test/smoke.test.mjs` drives both halves with a stub context and covers the invariants a rename breaks *silently*: the module id the client registers under, the route prefix the host mounts and the client calls, the slot keys the panel occupies, and the per-id hide rule.
- `test/host-delete.test.mjs` runs the real routes against a throwaway `DSH_HOME` on disk, so the log directory and the projection-cache record are genuinely created and genuinely removed. It pins every refusal to the branch that decides it, checks that a refusal touches nothing at all, and fixes the order the host documents — announce the removal, *then* rewrite the archive set.

## License

[MIT](./LICENSE)

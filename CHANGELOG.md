# Changelog

All notable changes to Pulse are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.7.1] — 2026-04-23

### Changed

- **Notification snippet strips box-drawing decoration from agent TUIs.** Agent CLIs like Claude Code (draws `─`/U+2500 bars) and Cursor (draws `▄`/`▀` half blocks) sandwich their input area in thick horizontal separators — when Telegram renders the `<pre>` snippet, those lines show up as large solid black rectangles that push the actually-useful content (agent replies, status lines, `❯` prompt) out of the visible body. Two cases are handled: (1) **pure-border lines** — a line whose content is only ≥2 border chars (`─`/`━`/`═`/`▀`/`▄`/`█`) plus optional whitespace — are dropped entirely; (2) **border-decorated label lines** — a line that starts with ≥10 border chars but also contains text (e.g. Claude Code's `──────── fix-sessions-json-empty-install ──`, which visually wraps into multiple dash-rows on mobile) have every run of border chars collapsed to a single space, leaving just the label text. Lines without border chars, or with only a few scattered, are untouched; non-agent sessions (shell, htop, vim) are unaffected. Effective result: Telegram notifications now show the conversation + the branch/mode label inline, instead of two walls of black bars sandwiching them.

## [1.7.0] — 2026-04-23

### Added

- **Notification title now carries the full `project › group › terminal` context.** Until now, both the browser (native Notification API) and the Telegram bot rendered idle alerts as `<terminal-name> is idle` — fine when you have three terminals, useless when you have thirty across five projects on three machines. The client (Python) now persists the *human-readable* labels of the project and the group alongside their IDs via new tmux user options `@project_name` and `@group_name` (mirroring the existing `@project_id` / `@group_id` pattern), so both notification channels build a composite title like `Pulse › Backend › tail logs is idle` without the frontend having to resolve IDs at delivery time. When a terminal is not in a group, the group segment is omitted (`Pulse › shell is idle`). The labels follow the terminal through `recover_sessions()` / `sync_sessions_request` / `restore_sessions_request` because they live in tmux, not in a separate registry. The frontend passes `project_name` and `group_name` at `createSession`, at `assignSessionGroup`, and — critically — when a project or group is **renamed**, the rename functions in `services/api.js` fire a best-effort batch of `PATCH /api/sessions/{id}/scope-names` calls (new endpoint) to every configured server so active terminals in the renamed scope pick up the fresh label for their next idle event. If a server is offline during the batch, the stale label survives in that terminal's tmux options until the next user-driven action on it re-syncs; no error surfaces to the user.

### Fixed

- **Idle-terminal detection overhauled** — the previous heuristic had three distinct failure modes that a code-review pass against the requirement spec surfaced:
  1. **Dormant-session false positive.** When a user enabled notifications on a terminal that had received no input and had no output in flight, the watcher initialized its internal `last_activity_ts` to `now` and — because the "user is mid-composing" filter evaluates `last_input_ts > last_enter_ts` as `0 > 0 = False` — fired a false idle alert after `timeout` seconds, even though no terminal output ever occurred.
  2. **Fast-command false positive.** A 2-second `INPUT_IGNORE_WINDOW_SECONDS` was designed to ignore shell echo of keystrokes, but it ate *all* output from commands that responded under 2 s (`ls`, `date`, `pwd`, `git status` in a clean repo). `last_activity_ts` would stay pinned to the previous prompt's timestamp, so `idle_seconds` computed against a stale baseline and the alert fired early.
  3. **"Every keystroke resets the timer" was only incidentally satisfied.** Keystrokes updated `last_input_ts` but never `last_activity_ts`, so if the user spent 40 s composing a long command without pressing Enter and then pressed it, the `last_input > last_enter` filter instantly collapsed (both now equal `now`) and the stale baseline from minutes earlier fired the alert immediately *on* the Enter.
  
  The rewrite in `client/src/resources/notifications.py` tracks three timestamps with disjoint semantics — `last_output_ts` (last real hash change, zero until one is observed), `last_input_ts`, `last_enter_ts` — and gates alerts on four conjoined rules: (1) `last_output_ts > 0`, (2) `last_input_ts <= last_enter_ts` (user not mid-composing), (3) `last_input_ts < last_output_ts` (last output is more recent than last input — user has already "responded" to the terminal or never typed), (4) `(now - last_output_ts) >= idle_timeout`. The `INPUT_IGNORE_WINDOW_SECONDS` heuristic is **removed** entirely — rule (3) subsumes it without the false-swallow. Known remaining limitation: because the watcher polls every 5 s, it cannot distinguish "shell echo of a long command" from "the command has produced its output" within a single tick, so commands with no intermediate output (`sleep 60`) can still false-alert once the poll window advances past their echo tick. A future iteration can close that gap with `tmux display -p '#{pane_current_command}'` gating, at the cost of breaking the "tail -f that stops producing output" case.
- **`capture_pane` now has a 3-second subprocess timeout.** The watcher coroutine calls `tmux capture-pane` on every monitored session every 5 s; a hung tmux server would block the event loop indefinitely because `subprocess.run` had no timeout. Matches the pattern already used in `client/src/resources/terminal.py:431-434` for history capture. Timeouts are silently treated as a transient miss (`return None`), identical to the existing `FileNotFoundError` path — the watcher skips this session this tick and tries again on the next.
- **`capture_pane` no longer blocks the event loop.** With N monitored sessions, the watcher previously serialized N synchronous `subprocess.run` calls on the asyncio event loop thread. Wrapping in `await asyncio.to_thread(capture_pane, sid, CAPTURE_LINES)` offloads each call to the default thread pool, so one slow tmux invocation can't stall notifications for every other session.
- **Watcher now reconciles `notify_on_idle` with the tmux option on every tick.** Each client instance keeps an in-memory `sessions[sid]["notify_on_idle"]` cache hydrated at startup. If another client instance sharing the same tmux server flips the toggle — a real scenario when a user has both the installed client and a dev client running at once — the cache diverges from the tmux `@notify_on_idle` option (source of truth), and the "stale" instance keeps firing idle alerts even though the bell shows off in the UI. The watcher now calls `get_notify_on_idle(sid)` once per candidate session per tick (~1 subprocess call per monitored session per 5s — negligible) and drops any whose tmux option has been unset, patching the cache on the way so the sidebar on the next `GET /api/sessions` reflects the truth.

### Removed

- **Click-to-focus behavior on browser notifications.** The native Notification used to attach an `onclick` handler that dispatched a `rt:focus-session` custom event, and `Dashboard` listened for it to un-hide the group, change the selected group, splice the session into the mosaic layout, and `window.focus()` the tab. In practice the focus path was flaky (browsers throttle programmatic focus for security) and the layout side-effects surprised users more than helped. Notifications are now visualization-only — see it, know the terminal is idle, go look. The `rt:focus-session` listener in `page.js` and the `onclick` in `NotificationsProvider.jsx` are gone.

### Notes

- **Sessions persisted before v1.7.0** will not have `@project_name` or `@group_name` tmux options set, so their first idle notification after upgrade will fall back to the terminal name only. The next user-driven rename (or explicit assign-group, or sync from the dashboard) repopulates the label. No migration step is required.

## [1.6.1] — 2026-04-23

### Fixed

- **Storage tab reloaded into the wrong settings tab.** After any action in Settings → Storage that forces a full-page reload (activate Mongo/S3, sync push, sync pull, deactivate), the page came back on the default `servers` tab because the Settings page picks `activeTab` from `?tab=` in the URL at mount and the reload wasn't passing it. `reloadPage()` in `StorageTab.jsx` now calls `window.history.replaceState(null, '', '/settings?tab=storage')` immediately before `window.location.reload()`, so the browser re-mounts on the Storage tab — same visual continuity as `use router.replace() then reload`, one fewer redirect.

## [1.6.0] — 2026-04-23

### Added

- **S3 (and S3-compatible) as a third storage driver**, alongside the local files and MongoDB options introduced in v1.5.0. The Storage tab now shows three horizontal tabs — **Local**, **MongoDB**, **S3** — with a form and activation button inside each. S3 covers not just AWS but any endpoint-compatible target: **Cloudflare R2**, **Google Cloud Storage** (via S3 interoperability), **MinIO**, **Backblaze B2**, **DigitalOcean Spaces**, etc. Concrete fields: endpoint (optional — leave empty for AWS), bucket, region (defaults `us-east-1`; use `auto` for R2), Access Key ID, Secret Access Key, path prefix, and `force_path_style` checkbox (required for MinIO / self-hosted S3). Implementation in `frontend/src/lib/s3Store.js` uses `@aws-sdk/client-s3` (server-side only — doesn't reach the browser bundle). Cross-frontend concurrency safety uses the same `AsyncLocalStorage` + optimistic-lock pattern the Mongo driver uses, but the "version" metadata is the S3 object's **ETag** threaded via `IfMatch` (write only succeeds if the object hasn't changed since our read). 412 `PreconditionFailed` → `VersionConflictError` → auto-retry up to 3 times inside `withStoreLock`. A fresh key (object doesn't exist yet) uses `IfNoneMatch: '*'` to catch the concurrent-create race. This mechanism is native to S3 / every S3-compatible API — nothing custom to add to the stored objects.
- **Unified storage config** at `data/storage-config.json` with a `driver` discriminator (`'mongo' | 's3'`). Replaces the v1.5.x per-driver `data/mongo-config.json`. On first boot after upgrade, the legacy `mongo-config.json` is auto-migrated to the new unified shape (stored as `{ driver: 'mongo', uri, database }`), the legacy file is removed, and the frontend continues running with no user action required. The dispatcher in `frontend/src/lib/storage.js` is now driven by a driver registry (`file` / `mongo` / `s3`) and picks by name — adding a fourth backend later is a new file and a new case, nothing else.
- **Copy-to-clipboard for secrets**. Previously the URI input had an eye toggle that switched between masked and plaintext display (exposing the secret on screen). That's gone — the input is now always masked (`type="password"`), but every secret has a dedicated Copy button next to it that writes the **full plaintext value** to `navigator.clipboard`. On the active-config readout card, masked dots sit alongside a Copy button that pulls the raw value from the backend. The `GET /api/storage-config` now returns secrets in plaintext (behind `withAuth`, as the dashboard login already gates the whole API) so the UI can copy without a separate "reveal" endpoint. Display stays masked; clipboard has the real thing.
- **Shared storage context module** at `frontend/src/lib/storeContext.js` — a single `AsyncLocalStorage` instance plus `newContext()` helper used by both `mongoStore.js` and `s3Store.js`. The context shape now carries two parallel maps (`versionByKey` for Mongo `_version` integers, `etagByKey` for S3 ETag strings) so each driver reads its own discipline without a generic-any field.

### Changed

- **Storage tab UI redesigned around driver tabs**. The old "local vs MongoDB-with-one-form" layout is replaced by a horizontal tab strip: Local (icon), MongoDB (icon), S3 (icon), each with an asterisk marking the currently active driver. Clicking a tab reveals that driver's form and activate button. Sync tools and Deactivate button appear only under the tab matching the active driver, preventing actions against a driver that isn't live.
- **Sync endpoints renamed and generalized**. `/api/storage-sync/local-to-mongo` → `/api/storage-sync/local-to-cloud`, and `/api/storage-sync/mongo-to-local` → `/api/storage-sync/cloud-to-local`. Each now routes internally to whichever cloud driver is active (`mongo` or `s3`), so a user on S3 gets a working sync without the endpoint carrying a Mongo-only name. Old routes removed — they were only called by `StorageTab`, which now calls the new names.
- **i18n keys rearchitected around drivers**. New structure `settings.storage.drivers.{file,mongo,s3}.*` holds per-driver labels, descriptions, and field hints. Generic keys (`title`, `subtitle`, `typeToConfirm`, `syncTitle`, etc.) interpolate `{driver}` where the driver name matters. Previous Mongo-specific keys (`statusMongo`, `configureTitle`, `pushButton`, `pullButton`, `deactivateButton`) removed — their functionality is now covered by the generic keys. `errors.s3.*` namespace added. All three locale files (`en`, `pt-BR`, `es`) updated in parallel.

### Notes

- **Driver selection is hot-swappable** — no restart. Saving a new config in Settings → Storage immediately reloads the backend; in-flight requests finish on the old driver, new requests pick up the new one. Old client drained for 10s in background before being closed.
- **ETag stability**: S3 ETag matches MD5 of content for objects < 5 MB without multipart or SSE-KMS. All Pulse data files fit comfortably in that regime. If a user configures SSE-KMS at bucket level, ETag becomes opaque and the optimistic lock fails closed (gratuitous VersionConflictError on every write). Not handled in v1.6.0 — document and move on.
- **Legacy `data/mongo-config.json` migration** happens once on first boot and is idempotent: the function reads, writes the new format, removes the old file, sets `_config_loaded = true`. If anything crashes mid-migration the old file stays and the next boot retries.
- **Mongo 4.2+ requirement** stays (imposed by the `mongodb@7.x` Node driver, unchanged in this release).

## [1.5.0] — 2026-04-22

### Added

- **MongoDB as an optional storage backend, configurable via the UI (Settings → Storage).** The frontend has always persisted everything under `frontend/data/*.json` — projects, flows, groups, notes, prompts, servers, layouts, view-state, sessions, compose-drafts. That works great for a single install, but the moment you want two machines to share the same data (home PC + laptop, each with its own Pulse but same user), the local `data/` folders drift apart. v1.5.0 adds a pluggable storage layer: when a MongoDB URI is saved in the new Storage tab, every API route routes reads/writes through MongoDB instead of local files. No MongoDB configured = **byte-for-byte identical behavior to before** (the local-file code path is untouched). Implementation is a tiny dispatcher in `frontend/src/lib/storage.js` that decides which backend to use — `frontend/src/lib/jsonStore.js` (existing, unchanged) or the new `frontend/src/lib/mongoStore.js`. All 11 data-owning API routes migrated to call `readStore`/`writeStore`/`withStoreLock` from the dispatcher instead of `jsonStore` / `fs` directly, so the switch is invisible to route code. The MongoDB path uses a single collection `pulse_storage` with one document per logical file (`_id: 'projects' | 'flows' | …`), each document carrying a `_version` integer that is incremented on every write. Cross-frontend concurrency safety comes from an optimistic-lock pattern: `withStoreLock` enters a Node `AsyncLocalStorage` context before running the mutator; the nested `readJsonFile` stashes the document's `_version` in that context; `writeJsonFileAtomic` then filters `updateOne` on exactly that captured version. If a different Pulse frontend has updated the same document between our read and our write, `matchedCount === 0` triggers a `VersionConflictError` and the lock re-runs the mutator from scratch (up to 3 attempts) so the write rebases on the freshest state. Concurrent writes across N frontends are therefore serialized per-document without any cross-process locking primitive. `MongoDB 4.2+` is required by the `mongodb@7.x` Node driver; no replica set or transactions needed.
- **Hot-swap the storage backend at runtime — no restart needed.** When you save a MongoDB URI (or remove one), `storage.js` immediately invalidates its cached backend promise, re-reads `data/mongo-config.json`, re-initializes the new backend, and starts routing from the very next request. In-flight requests continue on the old backend until they finish; the old Mongo client is drained for 10s in the background before being closed, so no request sees a torn connection. The Mongo module exposes a new `beginReload()` function that detaches its internal state (client, db, init-promise) without closing, letting the storage layer swap to a new config cleanly. Result: the "Settings → Save → restart the process" loop collapses into a single click — toast appears, data source changes, done.
- **"Configure MongoDB" validation with ping test before save.** `PUT /api/storage-config` opens a short-lived `MongoClient` with a 3s timeout, runs `{ ping: 1 }` and `listCollections` to confirm reachability + permissions, and only then writes `data/mongo-config.json`. A bad URI (unreachable host, wrong credentials, firewall) returns 400 with `errors.mongo.connection_failed` and the user sees a toast — the config file is never touched, so you can't brick your Pulse with a typo. `GET /api/storage-config` reports the current disk state vs. runtime state (`configured` / `active` / `restart_required`), which the Storage tab uses to show "Pending config saved (restart required)" when the user has saved a new URI but hasn't restarted yet. `DELETE /api/storage-config` removes the config file and similarly flags a restart.
- **Two sync buttons for migrating between local files and MongoDB**, both guarded by "type 'sync' to confirm" modals because they're destructive. `POST /api/storage-sync/local-to-mongo` reads all 10 `data/*.json` files up-front (fail-early if any read errors), *then* wipes the Pulse documents in MongoDB (`deleteMany({})` on `pulse_storage`), then writes each loaded file in. Read-first-then-wipe ordering is deliberate: a disk error during read leaves MongoDB untouched instead of half-wiped. `POST /api/storage-sync/mongo-to-local` does the inverse: reads every document from MongoDB and writes each one to the matching local JSON file via `fileStore.writeJsonFileAtomic`. Neither operation crosses with the running backend — both endpoints import `jsonStore` and `mongoStore` explicitly rather than going through the cached dispatcher, so you can run them in either direction regardless of which backend is currently active. The expected flow is: (1) save MongoDB config, which validates + hot-swaps the backend, (2) click "Sync local → MongoDB" to seed the collections from the current local state. Rollback: (1) click "Sync MongoDB → local" to capture the current MongoDB state as local files, (2) click "Deactivate MongoDB" — the backend hot-swaps back to local files. No restarts required at any step.
- **`useRefetchOnFocus` hook** in `frontend/src/utils/useRefetchOnFocus.js`, and applied to `ProjectsProvider`, `ServersProvider`, `ViewStateProvider`, and `NotesProvider`. When the browser tab becomes visible again (via `visibilitychange` or `window focus`), the provider silently refetches its state from the backend. Debounced to once every 2 seconds so repeated focus events don't spam the server. `NotesProvider` additionally guards against refetching while there are `pendingPatches` or active `debounceTimers` — otherwise a note being typed while losing focus could have its in-flight changes clobbered by the refetch response. Purpose is mitigation of stale UI in the multi-device scenario: if you change a project name on your laptop and then tab back to your desktop, the dashboard now refreshes without needing a manual reload. Works the same way in local-file mode — it's a harmless extra GET per tab-focus-change in that mode and a correctness fix in the MongoDB mode.

### Changed

- **All 11 data-owning API routes re-pointed at the new storage layer.** No shape changes, no semantics changes, no new fields in the response payloads — only the import line changed (`import { readStore, writeStore, withStoreLock } from '@/lib/storage'` replacing assorted `jsonStore` and `fs` imports) and the internal function calls renamed accordingly. The routes in question: `api/projects`, `api/projects/stats`, `api/flows`, `api/flows/[id]`, `api/groups`, `api/notes`, `api/notes/[id]`, `api/prompts`, `api/servers`, `api/layouts`, `api/view-state`, `api/sessions`, `api/compose-drafts`. Routes that had been using `fs.readFile`/`fs.writeFile` + hand-rolled atomic rename (servers, prompts, groups, projects, layouts, view-state, projects/stats) now go through the same storage API as everything else, so the cold-start seeding, atomic write, and `withFileLock` serialization are uniform across every endpoint. The legacy `lib/jsonStore.js` module is intentionally unchanged and remains the local-file implementation behind the dispatcher.

### Notes

- **`mongodb` driver added as a direct dependency** (`^7.x`, server-side only — Next.js doesn't ship it into the browser bundle).
- **`data/mongo-config.json` is the one file that always stays local.** Storing it in MongoDB would be circular (you need the config to connect to MongoDB to read the config…). It is never synced by either direction of "Sync local ↔ MongoDB".
- **Runtime failure mode: fail-fast.** If the frontend boots with a saved MongoDB config but MongoDB is unreachable, `storage.js` caches the init failure on the backend promise, so every subsequent API call rejects with a 503 and `errors.storage.unavailable`. The UI shows an error toast; fix is to either bring MongoDB back up or delete `data/mongo-config.json` on disk and restart. This matches the "fail-fast, no silent fallback" rule from the project's top-level guidelines.
- **Race conditions across multiple frontends hitting the same MongoDB** are handled by the per-document `_version` optimistic lock + 3-retry loop in `withStoreLock`. Last-writer-wins still applies when two frontends edit the *same* field of the *same* document simultaneously (no automatic merge), but no write is ever silently dropped — a retry always picks up the freshest doc state before reapplying the mutator.

## [1.4.20] — 2026-04-22

### Fixed

- **Scrollback was cut off at the attach point** — scrolling up (mouse wheel on desktop, finger swipe on mobile) stopped at whatever was visible when the terminal tab was opened, even though `tmux capture-pane` (used by the "copy" modal) returned the full history. Root cause: `client/src/resources/terminal.py:websocket_terminal` starts the attach and then streams only what the pty emits *after* that moment. tmux's attach redraws the current viewport but never replays the pane's historical buffer, so xterm.js's own scrollback only ever contained the session from attach forward. Fixed by capturing the pane's history (`tmux capture-pane -p -e -S -5000 -E -1`, which excludes the current viewport so it doesn't duplicate with the attach redraw) the moment the WebSocket accepts the attach, and shipping that text as the first `output` message to the client. xterm.js processes it naturally, accumulates it in its scrollback, and the subsequent attach redraw paints the viewport on top — so scrolling up now walks through the real pane history up to 5 000 lines back.

### Changed

- **Mobile terminal scroll is now smooth and predictable, and fast flicks always register.** The touch-to-scroll handler in `frontend/src/components/TerminalPane.jsx` translates finger-drag pixels into tmux wheel events (`CSI < 64/65`). Two problems fixed: (1) the old `TOUCH_STEP_PX = 24` felt laggy on slow/medium drags because at ~60 Hz `touchmove` cadence each event carried ~5-15 px of delta, which frequently didn't clear the threshold and just piled into the accumulator — stuttery behaviour described as "às vezes vai, às vezes lento". Lowered to 6 so almost every event emits at least one scroll step regardless of finger velocity, and raised the per-event step cap to 40 so hard flicks aren't truncated. (2) `onTouchEnd` used to zero the accumulator unconditionally — if a fast flick's final `touchmove` hit the cap, the residual delta was silently discarded, making quick repeated flicks appear to "not respond". `onTouchEnd` now flushes any remaining accumulator (up to 100 steps as a safety bound) as scroll events before resetting. Result: scroll tracks the finger continuously and rapid-fire flicks each produce proportional scrollback movement.

## [1.4.19] — 2026-04-22

### Added

- **Mobile key bar: Shift and Tab split into two buttons with a latching Shift.** Previously the bar had a single combined `⇧Tab` key that always sent `CSI Z` (the Shift+Tab escape). To support both plain `Tab` (autocomplete) and `Shift+Tab` without the combo, `frontend/src/components/MobileKeyBar.jsx` now exposes a dedicated `⇧` button and a `Tab` button. The `⇧` button is a **latch** — tapping it toggles a visual "armed" state (primary-tinted background + `aria-pressed`) without sending anything to the terminal. The next press of `Tab` with the latch armed sends `\x1b[Z` (Shift+Tab) and disarms; any other key press also disarms the latch, so it behaves exactly like a smartphone OSK Shift. Just sending `Shift` on its own would have been a no-op (terminals don't have modifier state — Shift only exists as part of a combo), which is why the earlier "just split them" attempts broke the flow.
- **Drag-to-reorder for projects.** The Projects page (`frontend/src/app/(main)/projects/page.js`) now shows a grip handle on the left of each card; grab it to drag a project to a new position in the list. The new order is persisted via the existing `PUT /api/projects` endpoint (which already preserves array order — no backend change) and reflected everywhere that reads `projects` from `useProjects()`, including the Header dropdown. Implementation mirrors `GroupSelector`'s existing DnD: `@dnd-kit/core` + `@dnd-kit/sortable`, `PointerSensor` with `distance: 8` activation to keep regular clicks unaffected, and `reorderById` from `utils/reorder.js` for the list shuffle. A new `reorderProjects(fromId, toId)` helper in `services/api.js` handles the read-then-write, and `ProjectsProvider` exposes `reorderProject` with optimistic local-update + rollback via `refreshProjects()` on failure. Drag is disabled while a search filter is active (wouldn't make sense to reorder a filtered view). New i18n keys `projects.dragHandle` and `success.project_reordered` in `en`, `pt-BR`, `es`.

### Changed

- **Serialized backend-facing writes across the frontend** to close a class of reorder-on-the-wire bugs. Previously `setLayouts`, `setViewState`, `setSessionsSnapshot`, and `setComposeDrafts` were all fired "debounce → fetch without waiting". Two debounce ticks firing 600 ms apart could still have their PUTs overlap at the network layer — the older request finishing last would overwrite the newer value. Each of these call sites now chains through an `inFlight.current = inFlight.current.catch(() => {}).then(() => apiCall(payload))` ref in `frontend/src/providers/ViewStateProvider.jsx` and `frontend/src/app/(main)/page.js`, so successive writes observe server order equal to client order. Per-item writers (`patchNote`, `patchFlow`, etc., which use independent per-id timers) were already safe and weren't touched.
- **Backend mutations now go through `withFileLock`** for the routes that were still racing. `app/api/notes/route.js` (POST), `app/api/notes/[id]/route.js` (PATCH + DELETE), `app/api/sessions/route.js` (PUT + the cold-start migration in `readAndMigrate`), and `app/api/compose-drafts/route.js` (PUT) previously did `read → modify → atomic-write` without holding the lock. A note being edited and dragged simultaneously could lose one of the two mutations — whichever `rename()` landed last wiped the other's write. All four routes are now wrapped in `withFileLock` (same pattern `/api/flows/*` and `/api/layouts` already used), bringing every mutating JSON route onto the same safety floor. Migration paths were also serialized to avoid cold-start races between two tabs opening the app for the first time.
- **Dashboard layouts save now flushes on component unmount.** The previous cleanup only called `clearTimeout`, so dragging a mosaic split and navigating to `/flows` within the 500 ms debounce dropped the write. Added an unmount-only effect that inspects `layoutsSaveTimer.current` and, if a timer is still pending, chains a synchronous flush through `layoutsInFlight` using the latest `mosaicLayouts` snapshot captured in `latestLayoutsRef`. Mirrors the flush-on-unmount that `flows/page.js` was already doing for scene saves.
- **Sessions-snapshot persist now gates on `sessionsProjectId === activeProjectId`** — without this gate, the effect could fire during a project switch with the old `sessions` but the new `activeProjectId`, stamping pre-migration sessions with the wrong `project_id`. Narrow impact in practice (requires a null `project_id` in the payload), but closes the last family-B hole in the snapshot path.
- **Consolidated the three cross-project-safety guards into a single derived `projectDataReady` flag** in `frontend/src/app/(main)/page.js`. Previously every validator effect that touches `mosaicLayouts` or `selectedGroupId` had to repeat the check `hydrated && hydratedX && sessionsProjectId === activeProjectId && groupsProjectId === activeProjectId` — three effects, three copies, one "remember to add it" human step per future effect. The new `projectDataReady` variable combines all the conditions (`hydrated && hydratedLayouts && hydratedSessions && hydratedGroups && sessionsProjectId === activeProjectId && groupsProjectId === activeProjectId`) in one place, and every validator plus the `mosaicLayout` derivation now does a single `if (!projectDataReady) return;`. Any new effect added later that mutates or reads layouts/selected-group just needs to reference `projectDataReady` to inherit the safety.

## [1.4.18] — 2026-04-22

### Fixed

- **Group-scoped layouts of the active project were deleted after switching away and coming back**, even though the per-session purge guard was now race-safe. A *third* validator effect at `frontend/src/app/(main)/page.js:226-248` — responsible for pruning layout keys whose group id no longer exists in `groups` — was also running with stale `groups` (holding the previous project's list). With `groups=[]` from the previous project and `activeProjectId` already flipped to the new one, none of the current project's group ids validated, so the effect called `delete` on every `<activeProject>::<group_id>` key. The key didn't just go `null`, it vanished entirely. Applied the same `groupsProjectId !== activeProjectId` guard here as in the two previous fixes; now all three validation effects (session-tree prune, orphan-group-key prune, selected-group reset) wait for both `sessions` and `groups` to match the active project before running.
- **Selected group was reset to `null` every time the user returned to the Terminals page**, dropping them into the "Sem grupo" tab even though the previous session was inside a named group. Same class of bug as the earlier session/layout wipe: when `activeProjectId` flipped (or the Dashboard component re-mounted after navigating between routes), the `selectedGroupId` validator effect at `frontend/src/app/(main)/page.js:157-164` ran with `groups` still holding the *previous* project's list — the current selected group wasn't found in that stale list, so the effect called `setSelectedGroupId(null)`, which persisted through `ViewStateProvider` and wiped the per-project group key in `data/view-state.json`. Fixed with a dedicated `groupsProjectId` state that is only set after `setGroups(list)` completes, with the `activeProjectId` that was in effect when the fetch ran. The validator now bails out with `if (groupsProjectId !== activeProjectId) return;`, so it only runs once `groups` matches the active project. The `mosaicLayout` derivation also gates on `groupsProjectId === activeProjectId` to avoid rendering with a stale group list (which would otherwise produce an empty `sessionsInSelectedGroup` for ~100ms after a project switch).
- **Terminals stayed in the mosaic layout of their old group after being moved to a new group.** Assigning a session to a different group only updated its `group_id` on the session object; `validateTree` in `page.js` only checked whether session ids existed in `sessions` at all, not whether they belonged to the group of the layout key being validated. So after moving `term-13` from "Sem grupo" to "Teste", `proj-default::__none__` still referenced `term-13`, and adding the terminal into the Teste mosaic left it duplicated in both layouts. `validateTree` is now called per-key with a scoped `validIds` set that only contains session ids whose *effective* group id matches the group encoded in the layout key (with the same "group_id pointing at a deleted group falls back to null" logic that `sessionsInSelectedGroup` already used). Moving a terminal between groups now correctly removes it from the old group's layout on the next render.

## [1.4.17] — 2026-04-22

### Added

- **Selected group and selected flow are now persisted per-project on the backend**, so navigating between projects (or closing the browser, or opening the dashboard on a different machine) restores the exact same view you left each project in. Implemented via a new `/api/view-state` endpoint (`frontend/src/app/api/view-state/route.js`, `data/view-state.json`) that stores `{ "<project_id>::group": "group-id", "<project_id>::flow": "flow-id" }` behind `withAuth` and `withFileLock`, mirrored by a `ViewStateProvider` (`frontend/src/providers/ViewStateProvider.jsx`) that both `app/(main)/page.js` and `app/(main)/flows/page.js` consume. The provider debounces writes by 400 ms (same as layouts). Switching projects no longer resets the selected group to `null`; each project keeps its own last-selected group, and the sidebar's `GroupSelector` lands on it automatically on hydration. **First load note**: the pre-existing `localStorage` keys `rt:selectedGroupId` and `rt:selectedFlowId` (single global values) are not migrated — since they weren't per-project, there's no safe way to associate them with a specific project, so the first v1.4.17 load drops them and you re-select once per project. This is one-time only.

### Changed

- **Flow rename is now a dedicated modal** instead of an inline sidebar input. The old `RenameInput` sub-component in `frontend/src/components/Flows/FlowsSidebar.jsx` (inline textbox that committed on blur/Enter and cancelled on Escape) had the usual pitfalls of click-away-to-cancel behaviors — accidental blur during scrolling, no clear save/cancel affordance, and inconsistent with every other rename surface in the app. Replaced by `frontend/src/components/Flows/RenameFlowModal.jsx`, a centered overlay modeled on `RenameSessionModal`: explicit Save/Cancel buttons, Esc to close, disabled inputs + spinner while the PATCH is in flight, and auto-focus on the name field. New i18n keys `modal.renameFlow.*` added to `en`, `pt-BR`, and `es`.
- **Active flow card in the sidebar now keeps its action row expanded**, mirroring how a session card stays expanded while it's visible in the mosaic. Previously the rename/duplicate/delete buttons on the selected flow only appeared on hover (identical to every other row), forcing an extra mouse dance to edit the flow you're currently working on. `FlowsSidebar.jsx` now passes `alwaysExpanded={isSelected}` through to `SidebarCard` — the prop already existed in the shared card but was never wired up by any caller. Non-selected flows still auto-hide their actions and reveal them on hover.

### Fixed

- **Mosaic layouts were silently wiped every time the user switched projects**, so coming back to a project showed a blank dashboard instead of the 1×2/2×2 layout that was left open. Fixed in two layers in `frontend/src/app/(main)/page.js`: (1) the `validateTree` useEffect used to iterate every `<project>::<group>` key in `mosaicLayouts` and purge any session id not in the current in-memory `sessions` array — but `fetchSessions` only loads sessions for the *active* project (filters by `activeProjectId`), so every other project's session ids were treated as invalid and their layouts collapsed to `null`. The effect now skips keys belonging to other projects (matching the sibling group-validation effect at L211-232 that already got this right). (2) Even scoped to the active project, there was still a race: when `activeProjectId` flipped to a new project, React's commit order meant the validation effect ran *first* with `activeProjectId` already pointing at the new project while `sessions` still held the previous project's ids — and because the per-project scope guard now let the new project's key through, its tree was purged against the stale `sessions` before `fetchSessions` had a chance to replace them. Introduced a dedicated `sessionsProjectId` state that is only set *after* `setSessions(merged)` completes, with the `activeProjectId` that was in effect when the fetch was kicked off. The validation effect gains a `if (sessionsProjectId !== activeProjectId) return;` guard, so it only runs once the in-memory `sessions` match the active project. Combined, the two fixes mean the debounced save never again writes a zeroed tree to `data/layouts.json`, and cross-project round trips render the exact layout the user left.

## [1.4.16] — 2026-04-22

### Fixed

- **Typing in a note card was silently dropped when the note belonged to a project the user had created** (any project other than the built-in `proj-default`). Each keystroke flipped the footer to "saving…" but no character rendered in the textarea, and in most cases only the first keystroke's value ever made it to disk — looked at first like a Linux install-mode issue but reproduced on macOS and Windows too, once a non-default project was in use. Root cause was a stale-closure chain in `frontend/src/providers/NotesProvider.jsx`: `setNotes` closed over `activeProjectId` and filtered `allNotes` by it on every write (`prev.filter((n) => n.project_id === activeProjectId)`), re-memoized via `useCallback([activeProjectId])`. The callbacks that used it — `updateNoteLocal`, `flushPatch`, `patchNoteImmediate`, `createNote`, `deleteNote`, `closeOrDeleteIfEmpty` — were all memoized without `setNotes` (or `activeProjectId`) in their deps, so they captured the initial `setNotes` from first render, when `activeProjectId` was still `'proj-default'`. Once the `ProjectsProvider` hydrated and switched the active project to a user-created one, every `updateNoteLocal` call filtered by the wrong id, missed the note entirely, and returned `allNotes` unchanged. The debounced PATCH still fired via `pendingPatches` (a ref, immune to the closure) and the server saved correctly — but the local state never reflected it, so React kept syncing the textarea DOM back to its old empty value. Fixed by dropping the project-scope filter from `setNotes` entirely — it now updates `allNotes` as-is, and the existing `notes = useMemo(() => allNotes.filter(...))` continues to scope the visible list on read. `setNotes` is now memoized with `[]`, so nothing about it ever goes stale, regardless of which project is active.

## [1.4.15] — 2026-04-22

### Fixed

- **Mouse wheel stopped scrolling in Pulse terminals** on fresh machines, reverting to the pre-1.4.13 behavior of translating wheel to `↑`/`↓` arrow keys (navigating shell history instead of the terminal scrollback). Root cause: `ensure_tmux_config` in `client/src/tools/tmux.py` was called once from `recover_sessions()` at client startup, but at that point there's typically **no tmux server yet** — `tmux set-option -ga terminal-overrides` exits with `no server running on /tmp/tmux-1000/default` and `check=False` silently swallowed the error, leaving `terminal-overrides` empty. The first `tmux new-session` inside `create_session` then spawned the server without the `smcup@:rmcup@` override, tmux happily claimed the outer alt-screen on every attach, and xterm.js entered the alt buffer (no scrollback). Fixed by also calling `ensure_tmux_config()` **inside `create_session`**, right after the `tmux new-session -d` that guarantees the server is running. The startup call stays (harmless when it fails, useful when a server persists from a previous run); the new in-create-session call is what actually lands the override on cold starts.
- **Terminal scrollback wiped to viewport-height (~40 lines) as soon as Claude Code started** inside a Pulse terminal. Scrolling the wheel showed only the last ~40 pre-claude lines, while `tmux capture-pane` (the in-app "copy" modal) correctly returned the full history. Claude Code's startup triggers a `CSI 3 J` (ED3 — "erase scrollback") via tmux, and xterm.js's default handler trims the line buffer down to exactly `rows` entries — matching the observed behavior line-for-line. See [anthropics/claude-code#16310](https://github.com/anthropics/claude-code/issues/16310). Fixed in two layers: `frontend/src/components/TerminalPane.jsx` registers a custom CSI handler for `J` that no-ops `CSI 3 J` while letting ED0/1/2 fall through; `client/src/tools/tmux.py:ensure_tmux_config` now also appends `:E3@` to `terminal-overrides` so tmux stops emitting the sequence in the first place. `ED0`/`ED1`/`ED2` (erase visible regions) continue to work as expected, so plain `clear` and vim-style repaints still behave right.
- **"Open editor" button (VSCode) did nothing under the install-mode systemd user service**, despite the settings-configured binary path being correct and the same click working fine in `./start.sh` dev. Root cause was twofold in `install/systemd/pulse-client.service.tmpl`: (1) `PrivateTmp=true` bind-mounted `/tmp` to a per-unit private directory, severing access to the X server's socket at `/tmp/.X11-unix/X0`, and (2) none of the graphical session env vars (`DISPLAY`, `WAYLAND_DISPLAY`, `XAUTHORITY`, `DBUS_SESSION_BUS_ADDRESS`, `XDG_RUNTIME_DIR`) were passed into the unit — so `os.environ.copy()` in `routes/terminal.py:open_editor` had nothing to give VSCode, which silently exited on startup (stderr discarded via `DEVNULL`). Fix drops `PrivateTmp=true`, adds `PassEnvironment=` for the full GUI env set, adds an `ExecStartPre=` that calls `systemctl --user import-environment …` as a belt-and-suspenders for distros where the display manager didn't do it, adds `/snap/bin` to the unit's hardcoded `PATH`, and teaches `open_editor` to fill in `XAUTHORITY` / `DBUS_SESSION_BUS_ADDRESS` / `WAYLAND_DISPLAY` from the standard `/run/user/<uid>/` paths when the envs are still missing. `install.sh:enable_services` now also runs `systemctl --user import-environment` once during install so the button works without a logout/login cycle. The handler logs a structured line before launch (`launching editor: binary=… DISPLAY=… WAYLAND_DISPLAY=… DBUS=… XAUTHORITY=… XDG_RUNTIME_DIR=…`) to `journalctl --user -u pulse-client.service`, making any future breakage straightforward to diagnose without repro.
- **"Permission denied — only Telegram will notify" toast on every bell-icon click, with no way to grant permission.** The regression traces back to v1.4.12 changing the install default bind to `0.0.0.0` + seeding `servers.json` with the LAN IP — users now reach the dashboard via `http://192.168.x.x:3000`, and browsers block the Notifications API on non-secure origins (`window.isSecureContext === false`), so `Notification.requestPermission()` returns `'denied'` without prompting. This is a browser security constraint that no client-side fix can bypass without real TLS. What *can* be fixed is the UX: `NotificationsProvider` now exports a `permissionReason` (value `'insecure-context'` when the origin is HTTP-non-localhost), the sidebar bell click and the Settings → Notifications "Request permission" button switch to a longer, explanatory toast (`insecureContextToast`), and Settings → Notifications shows a persistent banner (`insecureContextBanner`) with the workarounds spelled out (use `http://localhost:<port>` from this machine, set up HTTPS, or rely on the already-working Telegram channel). New i18n keys in all three locales (`en`, `pt-BR`, `es`).

### Changed

- **`CAPTURE_LINES_DEFAULT` bumped 500 → 5000** in `client/src/routes/terminal.py`. The capture endpoint (the "copy" modal in the UI) now defaults to returning 5 000 lines of tmux pane history, matching the bigger scrollback buffers shipped in 1.4.13. Explicit overrides via the `lines` query param still respect `CAPTURE_LINES_MAX = 50 000`.

## [1.4.14] — 2026-04-22

### Fixed

- **Installer accepted garbage input from arrow keys during interactive prompts.** Pressing a Right/Left/Up/Down arrow at the `Dashboard host`, `Client host`, `Server URL`, or port prompts fed the terminal's raw escape sequence (e.g. `^[[C` for Right) straight into `read -r` — POSIX `sh` has no line-editing. The bogus value was then written to `~/.config/pulse/frontend.env` as `WEB_HOST=^[[C` and the dashboard service crashed on bind. `install/install.sh` now validates every host (IPv4 dotted-decimal or literal `localhost`) and every port (integer 1–65535) with `is_valid_host` / `is_valid_port`. Interactive prompts reprompt in a loop on invalid input with a hint that arrow keys aren't supported; non-interactive / env-var / upgrade paths all hit a final-pass validation that dies with a clear message telling the user which file to fix.

### Changed

- The same validators run against values loaded from existing `~/.config/pulse/client.env` and `frontend.env` during upgrades. Upgrading a Pulse install that already has a corrupt host or port (from a v1.4.12/1.4.13 prompt mishap) now fails fast with an actionable error instead of silently reinstalling with the broken value.

## [1.4.13] — 2026-04-22

### Changed

- **Mouse wheel now scrolls the browser's native scrollback in Pulse terminals.** On fresh installs, the wheel used to act as `↑`/`↓` arrow keys navigating shell history instead of revealing previous output — a symptom of tmux claiming the outer terminal's alt-screen on attach, which leaves xterm.js with no scrollback in the active buffer. Pulse's client now applies `tmux set-option -ga terminal-overrides ',*:smcup@:rmcup@'` at startup (in `client/src/tools/tmux.py:ensure_tmux_config`, called from `recover_sessions`). This tells tmux the outer terminal lacks `smcup`/`rmcup`, so tmux keeps xterm.js in the normal buffer on attach — the wheel rolls real scrollback, and output from apps like `vim`/`less`/Claude Code stays in history as they repaint instead of vanishing on exit. Apps inside tmux still get alt-screen semantics at the tmux level, so their UX is preserved. `-ga` appends, so any manual `terminal-overrides` the user has in `~/.tmux.conf` stays intact. Effective on new client attaches; existing attached sessions keep the old behavior until closed and reopened.
- **Terminal scrollback bumped from 10 000 → 50 000 lines** in `frontend/src/components/TerminalPane.jsx`. At ~256 B per line inside xterm.js's internal representation, that's roughly 12 MB per open terminal — plenty of room for long build logs, `tail -f`, etc, without being wasteful. Applies to new terminals; existing tabs keep the old limit until reloaded.

## [1.4.12] — 2026-04-22

### Added

- **Interactive network prompts in the installer.** `install/install.sh` now asks for dashboard/client host + port and the LAN IP the dashboard will use to reach the client, with auto-filled defaults the user can accept with Enter. The LAN IP is auto-detected (`hostname -I` on Linux, `route -n get default` + `ipconfig getifaddr` on macOS); if detection fails, the prompt is shown empty and the user must type a value — no silent fallback. `PULSE_NO_INTERACT=1` still works via `PULSE_API_HOST`/`PULSE_API_PORT`/`PULSE_WEB_HOST`/`PULSE_WEB_PORT`/`PULSE_SERVER_HOST` env vars. Upgrade path preserves existing `.env` values untouched (no re-prompting).
- **Modal for renaming sessions.** The pencil button in the sidebar now opens a dedicated modal with a single name field, matching the pattern of `NewTerminalModal`. Replaces the previous inline input that required careful blur/Enter/Escape handling.

### Changed

- **Default bind host is now `0.0.0.0` on every OS.** Previously native Linux and macOS defaulted to `127.0.0.1` and only WSL used `0.0.0.0`. The installer now shows a warning about LAN exposure before prompting, letting the user opt into `127.0.0.1` if they only need local access. This aligns with the Windows installer's existing default and makes mobile-browser access work out of the box.
- **`install/install.sh:seed_servers_json` uses the detected LAN IP** (or the user-provided value) instead of a hardcoded `127.0.0.1`. The dashboard stores this as the server's `host`, so a browser on another device in the LAN can actually reach the client. Previously a phone connecting to the dashboard would see the client as permanently offline because `127.0.0.1` resolved to the phone itself.

### Fixed

- **New tmux sessions opened in `$INSTALL_ROOT/client`** (the systemd/launchd `WorkingDirectory`) because the client inherited it and tmux inherits from the client. `client/src/resources/terminal.py:create_session_request` now defaults `cwd` to `os.path.expanduser("~")` when the payload omits it, so new terminals start in `$HOME` on Linux/macOS/Windows.
- **Mobile sidebar keyboard button showed a permanent spinner** when no terminal was open. The condition `composeLoadingId === activeTerminalId` in `Sidebar.jsx:698` evaluated `null === null` as true, flipping the icon to `Loader`. Now guarded by `activeTerminalId && …` so the `Keyboard` icon stays rendered when there's no active terminal (the button remains disabled via the existing `disabled` prop).
- **Settings tabs hid overflow on mobile.** `frontend/src/app/(main)/settings/page.js` used `overflow-x-auto` with the scrollbar hidden, so phone users had no way to know they could scroll right to reach the fourth tab. The tab row now uses `flex-wrap` on mobile (four tabs break into two rows of two) and keeps the horizontal-scroll behavior on `sm:` and up.

## [1.4.11] — 2026-04-22

### Fixed

- **`pulse config host` / `config password` / `config secure` silently failed to restart services after mutating `.env`.** The CLI called a `warn` helper that was never defined — only `log`/`err`/`die` existed in `install/pulse.sh`. Under `set -eu`, the undefined command returned 127 and killed the script *before* `cmd_restart` could run. On the user side it looked like `0.0.0.0: warn: not found`, the env file was updated, but the service kept binding the old host until the user ran `pulse restart` by hand. Now `warn()` is defined alongside `log/err/die` and writes to stderr in yellow, matching `install.sh`. Fixes the five affected call sites (`config host --client`, `config host --dashboard`, `config password` on failed restart, `config secure off`, and a stray `warn` inside `install.sh`'s `npm prune` branch).
- **`pulse version` and `pulse check-updates` showed the pre-upgrade version forever.** Version was stored in `~/.config/pulse/client.env:VERSION`, but `seed_client_env` early-returns when the file already has an `API_KEY=` (to preserve user edits across upgrades), so the `VERSION=` line was never refreshed after the first install. `pulse version` also reported "not installed" for `--dashboard-only` installs because `client.env` doesn't exist there. Single source of truth is now `$INSTALL_ROOT/VERSION`, rewritten on every `install.sh` run, read by both CLI commands. Legacy `client.env:VERSION` kept as a fallback for installs that predate this fix.
- **`pulse keys regen` and `pulse config ports --client` stopped updating `servers.json` on 1.4.10+ installs.** Both used `if s.get('id') == 'localhost'` to find the seeded local server, but 1.4.10 changed the installer to generate `srv-<uuid>` ids (to align with the UI flow and fix the silent sessions.json bug). Match is now by `host == API_HOST && port == API_PORT` (values read from `client.env`), with the old `id == 'localhost'` kept as a legacy fallback. Without this, regenerating the API key or changing the client port would leave the dashboard still calling the old values.
- **`pulse config paths` didn't mention `client/data` at all** — the directory holding Telegram bot config and persisted client-side state (the one `install.sh` already backs up across upgrades since 1.4.7). Now `paths` lists both `data (dashboard): .../frontend/data` and `data (client): .../client/data`. On Linux the `logs:` line now honestly points to journalctl (the actual log sink) instead of an empty `$STATE_ROOT/logs` that only macOS uses.
- **`pulse config open logs` on Linux tried to open `$STATE_ROOT/logs`, which is an empty directory** (logs live in the systemd journal). Replaced with a short hint pointing to `pulse logs` / `pulse logs -f` so users don't walk away thinking nothing is being logged.
- **`pulse logs` defaulted to `client` only, with no way to merge both services.** Now defaults to `all` (consistent with `start`/`stop`/`restart`) and uses `journalctl -u pulse-client.service -u pulse.service` so entries interleave by timestamp. macOS `all` target uses `tail -F` across both log files. Explicit `client` and `dashboard` still work.
- **`pulse open` hardcoded `http://localhost:$WEB_PORT`** regardless of `WEB_HOST`. When the dashboard is bound to a specific LAN IP (not `0.0.0.0`, not `127.0.0.1`), localhost may not be listening at all and the browser tab errors out. Now reads `WEB_HOST` and uses the bound host verbatim; `0.0.0.0`/`::`/empty collapse to `localhost` (bind-any answers there too).
- **macOS `pulse uninstall` didn't stop services before deleting plists**, so clients could keep running until reboot. Now `launchctl unload` runs before `rm -f`, mirroring the Linux side's `systemctl disable` flow.

### Changed

- `pulse config open` gains `data-client` as a first-class target and renames `data` to `data-dashboard` (old name kept as an alias — scripts that used `pulse config open data` keep working).
- Help text for `pulse logs` and `pulse config open` updated to reflect the new targets and default.

## [1.4.10] — 2026-04-22

### Fixed

- **`sessions.json` (and `compose-drafts.json`) silently stayed empty in install mode.** On a fresh Linux install the dashboard appeared to work — terminals opened, the UI listed them — but `~/.local/share/pulse/frontend/data/sessions.json` never grew past `{ "servers": {}, "updated_at": "…" }`, which also meant auto-restore after reboot had nothing to replay. The v1.4.9 `PULSE_FRONTEND_ROOT` fix was a red herring here: the file was being written to the correct path, just with an empty payload. Root cause was a mismatch between the installer and the API: `install/install.sh:seed_servers_json` seeded `data/servers.json` with `"id": "localhost"`, while `frontend/src/app/api/sessions/route.js` (and `frontend/src/app/api/compose-drafts/route.js`) only accepted server ids that started with `srv-` — a convention the UI's `POST /api/servers` satisfies (`srv-${randomUUID()}`) but the installer didn't. Every PUT from the snapshot effect matched no key, was silently normalized to `{}`, and returned 200. Dev mode (`./start.sh`) escaped the bug because it doesn't seed `servers.json` at all — the user creates the server from Settings → Servidores, where the id is generated in the right shape. Fix: the installer now generates a real UUID (`srv-$(uuidgen || /proc/sys/kernel/random/uuid)`) so new installs converge with the UI-created shape, and both API routes drop the `srv-` prefix requirement (the prefix was convention, not validation — the id is an object key, not a filesystem path, so any non-empty string is safe). Existing installs with `"id": "localhost"` keep working without migration.

### Changed

- `frontend/src/app/api/sessions/route.js` PUT accepts any non-empty server id string. `frontend/src/app/api/compose-drafts/route.js` regex no longer requires the `srv-` prefix (`^[A-Za-z0-9_-]+::[A-Za-z0-9_-]+$`). `install/install.sh:seed_servers_json` generates `srv-<uuid>` instead of the literal `localhost`.

## [1.4.9] — 2026-04-22

### Fixed

- `frontend/data/*.json` files (sessions, notes, prompts, flows, layouts, servers, compose-drafts) weren't being persisted in production installs, even though everything worked in `./start.sh` dev. Root cause: `jsonStore.readJsonFile` / `writeJsonFileAtomic` resolved paths against `process.cwd()`, and under systemd/launchd the process that actually handles writes doesn't always share the unit's `WorkingDirectory` with every internal worker Next spawns. Writes happened silently against a different path; no error, no log entry, the real file on disk just never changed. Fix: the dashboard unit/plist now set `PULSE_FRONTEND_ROOT=%h/.local/share/pulse/frontend` and `jsonStore` prefers that env var over `cwd`. Dev runs keep working via the `process.cwd()` fallback. `writeJsonFileAtomic` also now logs the failed absolute path on any exception so `pulse logs dashboard` can surface permission / path issues.
- **`pulse restart` was still killing tmux sessions.** v1.4.7 made the installer's `stop_services_if_running` use `systemctl kill --kill-who=main` (which signals only the main PID regardless of `KillMode`), so `pulse upgrade` stopped wiping tmux — but the companion change on the systemd unit template (`KillMode=process`) never made it into the commit. Any other `systemctl --user stop|restart pulse-client.service` — including `pulse restart` — still followed the default `KillMode=control-group` and took the tmux daemon down with it. The unit template now ships with `KillMode=process` as originally intended; `pulse restart` preserves live sessions.

### Changed

- `install/systemd/pulse.service.tmpl` picks up `PULSE_FRONTEND_ROOT`; `install/launchd/sh.pulse.dashboard.plist.tmpl` adds the same in `EnvironmentVariables`. Upgrading to 1.4.9 re-installs both so the next `pulse upgrade` / fresh install gets them without manual action.

## [1.4.8] — 2026-04-22

### Fixed

- `frontend/data/sessions.json` (the dashboard's per-server session metadata cache) wasn't being updated after creating or splitting a session when the server had been flagged offline by an earlier race. Sequence: dashboard loads → first `fetchSessions` hits the client while it's still booting → request fails → `offlineServerIds` keeps the server id. Moments later the client is up and `createSession` / `cloneSession` succeeds, so `sessions` state and the UI update — but the debounced snapshot effect still skipped the server because `offlineServerIds` was stale (`if (offlineSet.has(srv.id)) continue;`). The JSON file stayed at `{ "servers": {}, ... }` forever. Now `handleCreate` and `handleSplit` remove the server from `offlineServerIds` on success, so the next snapshot persists correctly.
- Auto-restore after reboot wasn't firing reliably. After a reboot tmux is gone, so the dashboard's startup flow — compare the sessions.json snapshot against live sessions and `POST /api/sessions/restore` any missing one (which runs `tmux new-session -c <cwd>` on the client) — is the only way sessions come back at the right path. Two issues made it miss: (a) the restore loop also gated on `offlineServerIds`, so a client that booted a second behind the dashboard never got its sessions restored; (b) `restoreAttemptedRef` flipped to true on the first try regardless of outcome, so even after the client came online a few seconds later, no retry ever happened. The gate is gone, and the ref now stays false until a request actually reaches the client — when `fetchSessions` later clears `offlineServerIds`, the effect re-fires and the restore goes through. Sessions come back at the same `cwd` they were in before the reboot.

### Changed

- Post-install summary now lists the full command set organized by purpose (service control, logs, keys, and every `pulse config` subcommand — password, ports, host, secure, rotate-jwt, paths, open, edit) instead of only five commands. Ends with a pointer to `pulse help` for the complete reference. Users no longer have to guess which subcommands exist — they're all printed right after installation.

## [1.4.7] — 2026-04-22

### Fixed

- **`pulse upgrade` was killing every live tmux session on Linux/WSL2.** The systemd user unit for the client didn't set `KillMode`, so the default (`control-group`) applied: `systemctl stop pulse-client.service` SIGTERMed the entire cgroup, taking the tmux server daemon down with it. The client spawns `tmux new-session -d`, which daemonises but — under cgroups v2 — stays in the unit's cgroup (fork doesn't escape the cgroup). Two fixes combined: (1) the unit template now declares `KillMode=process` so only the uvicorn PID gets signaled on future stops; (2) the installer's `stop_services_if_running` no longer uses `systemctl stop` — it uses `systemctl kill --kill-who=main --signal=TERM` instead, which signals only the main PID regardless of KillMode. That second change matters for *this* upgrade too: the installed unit file on disk still has the old KillMode default until after the upgrade finishes, and the new kill path sidesteps it. macOS/launchd was never affected (launchd terminates only the configured program, not a cgroup tree). `recover_sessions()` reattaches on next start.
- **`pulse upgrade` was wiping client-side user data** — Telegram bot/chat-id config, persisted session state, and anything else in `~/.local/share/pulse/client/data/` vanished on every upgrade. Notes, prompts, and flows (in `frontend/data/`) survived because `install_files()` already had backup/restore logic for that directory, but the matching block for the client was missing the same treatment — it just did `rm -rf $INSTALL_ROOT/client` and recopied. `install/install.sh:install_files` now mirrors the frontend's behavior for the client: move `client/data/` to `$TEMP_DIR` before wiping, then move it back after the fresh copy. Users on any earlier version should treat upgrades as data-destructive for client-side state until they're on 1.4.7+.
- Projects page couldn't scroll vertically on mobile (and anywhere the content was taller than the viewport) — the root container used `flex-1 overflow-y-auto`, but the parent `<main>` element is block-level, not a flex container, so `flex-1` had no effect and the div grew beyond the viewport without an overflow reference height. Switched to `h-full overflow-y-auto`, matching the Prompts and Settings pages.
- Settings tab bar (Servers / Telegram / Notifications / Editor) overflowed the viewport on narrow phones, triggering horizontal scroll on the whole page. The tab bar now scrolls horizontally inside itself (scrollbar hidden) with `whitespace-nowrap flex-shrink-0` on the buttons, so labels stay readable and the page stops stretching.
- Flows canvas background ignored the active theme on dark modes (Excalidraw's default `viewBackgroundColor` is `#ffffff`, which didn't match any of the 16 themed dark palettes). Newly created flows now default to `viewBackgroundColor: 'transparent'`, so the canvas inherits the themed container's `hsl(var(--background))`. Existing flows that had a user-chosen background color keep it (spread order preserves explicit scene state).
- Flows sidebar opened by default on mobile, covering the canvas. It now defaults to closed on mobile (open on desktop) on first visit; the user's explicit open/close preference is still persisted in `rt:flowsSidebarOpen` and respected on subsequent visits.

## [1.4.6] — 2026-04-22

### Fixed

- Telegram notifications from the client were shipped with pt-BR strings hardcoded in Python (`está aguardando há Ns`, `teste de notificação`), which bypassed the i18n catalog and ignored the user's locale. The browser channel had always respected i18n via the frontend `idleTitle` key — but the Telegram payload is composed inside the client's async `notification_watcher` loop, which has no incoming HTTP request to read `Accept-Language` from. Both strings are now in English, matching the project convention that external-facing messages default to English. Affected paths: `client/src/resources/notifications.py` (idle message) and `client/src/routes/settings.py` (test send button).

## [1.4.5] — 2026-04-21

### Fixed

- Under WSL2, the installer now binds `API_HOST` and `WEB_HOST` to `0.0.0.0` instead of `127.0.0.1`. Previously, the dashboard loaded in the Windows browser but couldn't reach the client API — fetches from the browser to `127.0.0.1:8000` failed because Windows `127.0.0.1` and WSL2 `127.0.0.1` are different loopbacks (WSL2 runs in its own Hyper-V network namespace). WSL2's `localhostForwarding` feature — the thing that makes `localhost:3000` on Windows reach the Next.js server inside WSL — only reflects bindings that listen on `0.0.0.0`; `127.0.0.1` stays invisible to Windows. Native Linux and macOS are unaffected and keep `127.0.0.1` as the safe default. `install.sh` uses the existing `PULSE_IS_WSL` detection to pick per-platform.

### Documentation

- New README section "Networking defaults" documenting the per-platform bind-host behavior, why WSL2 needs `0.0.0.0`, and how to use `pulse config host` to open access on the LAN (or revert to loopback-only on Linux/Mac).
- Expanded "Running the client on a remote server" into "Multiple servers — dashboard + remote clients" covering: `PULSE_CLIENT_ONLY` / `PULSE_DASHBOARD_ONLY` installs, firewall/NAT guidance for reaching remote clients, the Settings → Servers UI workflow (fields, probing, reorder), and a diagram of the typical multi-host architecture.
- Added `assets/demo.gif` (animated product tour) and 11 in-context screenshots — dashboard hero, projects list, notifications/telegram settings, editor override, prompts library, flows/Excalidraw, servers settings panel, mobile tab layout + MobileKeyBar, an Android browser notification, and a matching Telegram alert showing the last 20 lines of pane output — replacing most of the outstanding `TODO: add ...` placeholders.

## [1.4.4] — 2026-04-21

### Fixed

- Windows installer (`install/install.ps1`) crashing in `Invoke-Wsl` on Windows PowerShell 5.1 with `/bin/bash: line 1: Ubuntu: command not found`. Regression introduced in v1.4.3: the helper declared `param([Parameter(ValueFromRemainingArguments=$true)][string[]]$WslArgs)`, and on PS 5.1 that param binder treated tokens starting with `-` (like `-d` in `Invoke-Wsl -d Ubuntu ...`) as parameter-name attempts. No match was found, PS silently dropped the `-d`, and only the remaining args reached the binder — so `wsl -d Ubuntu -- sh -c '...'` executed as `wsl.exe Ubuntu -- sh -c '...'`, which asked WSL to run "Ubuntu" as a bash command. Switched the helper to the automatic `$args` variable, which bypasses the binder entirely and passes every token through verbatim.

## [1.4.3] — 2026-04-21

### Fixed

- **Windows installer (`install/install.ps1`) completely broken on Windows PowerShell 5.1** — crashed right after the banner with `[System.Char] não contém um método denominado 'Trim'`. Two root causes: (1) `wsl.exe` emits UTF-16 LE by default, so under Windows-1252 consoles (e.g. pt-BR) embedded NUL bytes corrupted pipeline line-splitting and `$_.Trim()` blew up when `$_` became a `[char]`; (2) `Get-DefaultDistro` indexed a single-string `$distros` with `[0]`, which returns `[char]` on PS 5.1 (no `.Trim()`). The script now forces UTF-8 on the console, sets `WSL_UTF8=1`, and routes all `wsl.exe` reads through an `Invoke-Wsl` helper that coerces to `[string]`, strips NUL/BOM, and always returns an array (uses `return ,@($arr)` — the leading comma is essential on PS 5.1 to preserve array shape for single-item results).
- Windows installer — additional Windows↔WSL interop hardening shipped in the same patch:
  - Abort clearly if the default WSL distro is WSL1 (was silently crashing minutes later in `systemctl --user`) or a container-engine VM like `docker-desktop`/`rancher-desktop` (minimal distro without `apt` — install.sh would fail).
  - Pass `PULSE_AUTH_PASSWORD` and the other `PULSE_*` env vars to WSL via `$WSLENV` (the native Windows↔WSL env bridge) instead of shell-interpolating into `bash -c "VAR='...' curl ..."`. Previously, passwords containing `'`, `` ` ``, `$`, `%`, or `"` were silently mangled — user set "my`pass" but got stored as "mypass".
  - Abort upfront if systemd is not enabled inside the WSL distro, with step-by-step instructions for `/etc/wsl.conf` + `wsl --shutdown`. Previously crashed deep inside `install.sh` with a cryptic `systemctl: command not found`.
  - `pulse.cmd` now quotes the distro name in the `wsl -d "..."` call (survives distros with spaces in the name) and is written with `Set-Content -Encoding OEM` instead of `ASCII` (survives non-ASCII distro names — ASCII was turning them into `?`).
  - `WEB_PORT` read from `frontend.env` now validates the value is numeric before using it; the fallback to `3000` no longer masks a silent parse failure.
  - User PATH deduplicates correctly on reinstall via trailing-backslash normalization — previously the same folder could be added multiple times.
  - Dashboard Start Menu shortcut and `pulse.cmd` are skipped when `PULSE_CLIENT_ONLY=1` (previously created a useless broken shortcut pointing at a nonexistent dashboard).
  - Validate `LOCALAPPDATA` is set before writing `pulse.cmd` instead of silently creating a relative-path file in the current directory.

## [1.4.2] — 2026-04-21

### Added

- `client/.env.example` and `frontend/.env.example` — both `start.sh` scripts try to copy `.env.example` → `.env` on first run, but the example files were missing from the repo, forcing new users to guess the variable names. `frontend/.env.example` ships with `AUTH_PASSWORD=change-me` (so `start.sh` fails fast until replaced) and `AUTH_JWT_SECRET=change-me` (auto-regenerated by `ensure_auth_secret` on first run).

### Fixed

- Dev runner (`client/start.sh`) was silently using the system Python (e.g. miniconda) instead of isolating deps in a `.venv`. Root cause: the script called `uv run uvicorn ...` with no `pyproject.toml` in the repo — without a project root, `uv run` does not create or use a project venv; it just executes the command against whatever interpreter it finds on PATH. If `uvicorn`/`fastapi` happened to be installed globally, it "worked" but ran outside any isolation. The script now creates `client/.venv` via `uv venv --python <.python-version>` and installs `requirements.txt` with `uv pip install`, then invokes `.venv/bin/uvicorn` directly — matching exactly what `install/install.sh` does in production (and what the systemd/launchd units execute).
- Removed the stale pip-based fallback path in `client/start.sh`. It was never exercised in practice (because `pulse_ensure_uv` always installs `uv` beforehand) and, if it had been, it would have masked a missing `uv` by installing deps into the system Python. The script now fails fast with a clear message if `uv` is not on `PATH`.
- Default `VERSION` written by `client/start.sh`'s `.env` generator bumped from `1.2.0` to `1.4.2` to match the actual release (was stale since 1.2.0 first public release).

## [1.4.1] — 2026-04-21

### Added

- `pulse config host [--client H] [--dashboard H]` — show/change bind hosts. Use `0.0.0.0` to expose the API or dashboard on the LAN (e.g. reach it from your phone); `127.0.0.1` keeps it localhost-only. Warns when exposing over plain HTTP and auto-restarts affected services.
- `pulse config secure <on|off>` — toggle `AUTH_COOKIE_SECURE`. `on` when behind HTTPS / reverse proxy (production); `off` for development over plain HTTP.
- `pulse config rotate-jwt [-y|--yes]` — regenerates `AUTH_JWT_SECRET`. Confirms first because it kicks every active login back to `/login`.

With this rollup every env in `client.env` and `frontend.env` is now reachable through a `pulse config`/`pulse keys` subcommand — no need to edit `.env` files by hand for day-to-day operation.

### Added (cont.)

- **Terminal capture modal** — a floating button in the top-right corner of every pane (both desktop and mobile, semi-transparent until hovered) opens a modal with the pane's scrollback rendered as plain text in a read-only textarea. Users can select freely with mouse/touch, filter by substring, copy to clipboard, or download as `.txt`. Works consistently inside alt-screen CLI apps (Claude Code, Cursor, `less`, `vim`) where xterm's own text selection is unreliable.
- Client endpoint `GET /api/sessions/{id}/capture?lines=N` — returns the pane's buffer via `tmux capture-pane -p -S -N` (default 500 lines, max 50000).

### Changed

- Notes FAB now uses the same `primary` color as the new "Copy" button so both floating actions read as a cohesive set, while keeping the FAB solid (not tinted) for affordance.

## [1.4.0] — 2026-04-21

### Added

- `pulse config` editor settings page — a new **Editor** tab in Settings lets you override the binary path used by "Open in VSCode" per server. Useful when the editor is installed somewhere Pulse's auto-detect doesn't know about. Includes an **Auto-detect** button that does a dry-run of the resolver and tells you which path it would use (override / PATH / well-known install location).
- Client endpoint `PUT /api/settings/editor` (override path, validated against `os.path.isfile` + `os.access(..., X_OK)`) and `POST /api/settings/editor/resolve` (dry-run resolver).
- Editor binary resolver now handles **Cursor**, **VSCodium**, **Windsurf**, VSCode Insiders, and standard VSCode installs on **macOS** (`/Applications/<App>.app/Contents/Resources/app/bin/<cli>`) in addition to the existing Linux paths. Any of `code`, `cursor`, `codium`, `code-insiders`, `windsurf` on PATH is accepted.

### Fixed

- "Open in VSCode" failing with `errors.editor_binary_not_found` on macOS when VSCode was installed but the `code` CLI wasn't added to PATH (a common case — users have to run `Shell Command: Install 'code' command in PATH` manually). The new fallbacks cover all `.app` installs directly.
- Error message for `errors.editor_binary_not_found` updated to mention Cursor/VSCodium and point users to the new Editor settings tab.
- Dashboard crashlooping on macOS for users who have Node installed via a version manager (nvm, fnm, asdf). The `ensure_node()` check in the installer looked at the shell's `node -v`, and if it found a modern version (e.g. nvm's `v25.1.0`), it skipped the brew install — but launchd never sees nvm/fnm/asdf, so the service fell back to `/usr/local/bin/node` or similar and Next.js refused to start. The installer now always `brew install node@20` on macOS regardless of what the shell `node` reports, and force-links it so the launchd PATH can always find it.

## [1.3.3] — 2026-04-21

### Fixed

- Dashboard stuck in a crashloop on macOS when a Node.js version below 18.18 was present in `/usr/local/bin/node` or elsewhere on the launchd PATH. Next.js 15 refused to start, logging `You are using Node.js 18.16.1. For Next.js, Node.js version "^18.18.0 || ^19.8.0 || >= 20.0.0" is required.` and launchd restarted the process in a loop. The launchd plist wrapper now loads brew's shellenv and walks a small list of formulas (`node@20`, `node@22`, `node@18`, `node`) at start time, prepending the first installed one to `PATH`. Works on Apple Silicon and Intel without substitution in the installer.

## [1.3.2] — 2026-04-21

### Fixed

- `pulse upgrade` crashing at the end with `Syntax error: "(" unexpected` on Debian/Ubuntu (dash). Root cause: `install.sh` overwrites `~/.local/bin/pulse` while dash is still reading it, so the parser's byte offset lands inside new-file content. Fix: `cmd_upgrade` now `exec`s the installer, replacing this shell instead of returning to it.
- `pulse help` and `pulse config` printing literal `\033[1m` escape sequences instead of formatting. The color variables stored backslash-escapes as strings, which `printf "%b"` expanded correctly but `cat <<EOF` did not. Fix: the setup block now materializes the variables as real ESC bytes via `$(printf '\033')`, so heredocs, `printf`, and `echo` all render them identically.

## [1.3.0] — 2026-04-21

### Added

- `pulse config password` — change the dashboard password interactively (or via `--stdin` / `PULSE_AUTH_PASSWORD`). Auto-restarts the dashboard.
- `pulse config ports` — show or change the client/dashboard ports. With `--client N` / `--dashboard N` it updates both `.env` files, keeps `servers.json`'s localhost entry in sync, and restarts the affected services.
- `pulse config paths` — print the install, config, logs, data, binary, and service-unit paths.
- `pulse config open <config|install|logs|data>` — open that directory in the system file manager.

### Fixed

- **Terminal panes auto-deleted with "Session ended" right after opening**, when Pulse ran under systemd/launchd. Root cause: `tmux attach-session` exits immediately without `TERM`, which systemd/launchd user units don't inherit from a shell. The client now injects `TERM=xterm-256color` before spawning tmux, and the systemd/launchd unit templates also set `TERM` as a belt-and-suspenders fallback.
- WebSocket handler now treats Starlette 1.0's `RuntimeError("WebSocket is not connected...")` as a clean disconnect instead of logging it as an error. That error was being raised when `send_output` closed the socket (e.g. on session-end) at the same moment the main loop was waiting on `receive_text`.

## [1.2.0] — 2026-04-21

First public release.

### Added

- One-line installer (`curl … | sh`) for Linux, macOS, and Windows (via WSL2).
- `pulse` CLI umbrella command — `status`, `start`, `stop`, `restart`, `logs`, `open`, `upgrade`, `uninstall`, `keys show/regen`, `config edit`, `version`, `check-updates`.
- systemd user units (Linux / WSL) and launchd LaunchAgents (macOS) with auto-start on login and automatic restart on failure.
- Windows installer (`install.ps1`) that verifies WSL2, delegates to the Linux installer, and creates a Start Menu shortcut + `pulse.cmd` on PATH.
- English as the default frontend locale.
- MIT license, CONTRIBUTING, SECURITY, and Code of Conduct.
- GitHub Actions release pipeline that publishes a tarball + installer scripts on tag push.

### Changed

- **Renamed `backend/` → `client/`.** The service running on the host is now called the Pulse *client* — a clearer name for an agent that can run locally or on a remote server managed from the dashboard.
- Default frontend locale is now English (was pt-BR). pt-BR and es remain fully supported and auto-selected when the browser language matches.
- Shared bootstrap helpers extracted to `install/lib/` so `client/start.sh` and `frontend/start.sh` share OS-detection and dependency-install logic.
- Installer now verifies the release tarball against the published `SHA256SUMS` and aborts on mismatch.
- Installer pins the client venv's Python to the version in `client/.python-version` (3.12), letting `uv` download it if the system doesn't have it. Prevents broken venvs when users run under pyenv/asdf with an older default.
- Installer now validates the system `python3` is ≥ 3.10 and fails fast with a clear message if not.
- Installer adds `~/.local/bin` to the active shell's rc file (bash/zsh) automatically when it isn't already on `PATH`, instead of only printing a reminder.
- Bumped minimum Node.js to 18.18 (was 18.17) to match Next.js 15 requirements.
- `pulse upgrade` now forwards `PULSE_CLIENT_ONLY`, `PULSE_DASHBOARD_ONLY`, `PULSE_NO_START`, and port overrides to the installer, so upgrades don't silently change install shape.
- Windows installer (`install.ps1`) forwards the full set of `PULSE_*` env vars into WSL — previously `PULSE_DASHBOARD_ONLY`, `PULSE_NO_START`, `PULSE_CLIENT_PORT`, and `PULSE_DASHBOARD_PORT` were dropped.

### Fixed

- Installer no longer leaves the terminal in `-echo` state if the user hits Ctrl+C during the dashboard password prompt.
- Installer now announces the sudo prompt before `loginctl enable-linger` instead of silently asking for a password mid-install.

### Notes

Migration from earlier dev builds: see the README "Self-hosting" section and run `./start.sh` once — it regenerates `.env` files with sane defaults.

[Unreleased]: https://github.com/kevinzezel/pulse/compare/v1.7.1...HEAD
[1.7.1]: https://github.com/kevinzezel/pulse/releases/tag/v1.7.1
[1.7.0]: https://github.com/kevinzezel/pulse/releases/tag/v1.7.0
[1.6.1]: https://github.com/kevinzezel/pulse/releases/tag/v1.6.1
[1.6.0]: https://github.com/kevinzezel/pulse/releases/tag/v1.6.0
[1.5.0]: https://github.com/kevinzezel/pulse/releases/tag/v1.5.0
[1.4.20]: https://github.com/kevinzezel/pulse/releases/tag/v1.4.20
[1.4.19]: https://github.com/kevinzezel/pulse/releases/tag/v1.4.19
[1.4.18]: https://github.com/kevinzezel/pulse/releases/tag/v1.4.18
[1.4.17]: https://github.com/kevinzezel/pulse/releases/tag/v1.4.17
[1.4.16]: https://github.com/kevinzezel/pulse/releases/tag/v1.4.16
[1.4.15]: https://github.com/kevinzezel/pulse/releases/tag/v1.4.15
[1.4.14]: https://github.com/kevinzezel/pulse/releases/tag/v1.4.14
[1.4.13]: https://github.com/kevinzezel/pulse/releases/tag/v1.4.13
[1.4.12]: https://github.com/kevinzezel/pulse/releases/tag/v1.4.12
[1.4.11]: https://github.com/kevinzezel/pulse/releases/tag/v1.4.11
[1.4.10]: https://github.com/kevinzezel/pulse/releases/tag/v1.4.10
[1.4.9]: https://github.com/kevinzezel/pulse/releases/tag/v1.4.9
[1.4.8]: https://github.com/kevinzezel/pulse/releases/tag/v1.4.8
[1.4.7]: https://github.com/kevinzezel/pulse/releases/tag/v1.4.7
[1.4.6]: https://github.com/kevinzezel/pulse/releases/tag/v1.4.6
[1.4.5]: https://github.com/kevinzezel/pulse/releases/tag/v1.4.5
[1.4.4]: https://github.com/kevinzezel/pulse/releases/tag/v1.4.4
[1.4.3]: https://github.com/kevinzezel/pulse/releases/tag/v1.4.3
[1.4.2]: https://github.com/kevinzezel/pulse/releases/tag/v1.4.2
[1.4.1]: https://github.com/kevinzezel/pulse/releases/tag/v1.4.1
[1.4.0]: https://github.com/kevinzezel/pulse/releases/tag/v1.4.0
[1.3.3]: https://github.com/kevinzezel/pulse/releases/tag/v1.3.3
[1.3.2]: https://github.com/kevinzezel/pulse/releases/tag/v1.3.2
[1.3.1]: https://github.com/kevinzezel/pulse/releases/tag/v1.3.1
[1.3.0]: https://github.com/kevinzezel/pulse/releases/tag/v1.3.0
[1.2.0]: https://github.com/kevinzezel/pulse/releases/tag/v1.2.0

# Changelog

All notable changes to Pulse are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [4.5.0] — 2026-04-30

Aligns Settings → Intelligence with the existing Telegram token editor: the
saved Gemini API key now loads directly into the input, can be shown/hidden,
edited, copied manually, or cleared by deleting the field value and saving.

### Changed

- **Gemini API key editing now matches Telegram.** The saved key is revealed into
  the API key input when the Intelligence tab loads. The dedicated *Copy key*
  and *Remove key* actions were removed; users can select/copy the visible field
  or clear it and save.
- **`PUT /api/intelligence-config` now treats an explicitly empty `api_key` as a
  clear request.** Omitting `api_key` still preserves the stored key for
  model-only updates.

### Internal

- Extended `intelligence-config-route.test.js` to cover preserving an omitted
  key, clearing with an explicit empty key, and rejecting empty saves when no key
  exists yet.

## [4.4.0-pre] — 2026-04-30

Introduces a reusable, page-grade loading component and rolls it out to the
sections that previously showed a tiny lone spinner — Tasks, Flows, Prompts and
the Notes manager — so the empty-area wait state matches the polished look used
by the terminal restoration overlay.

### Added

- **`PageLoadingState` component (`frontend/src/components/PageLoadingState.jsx`).**
  A reusable loading state with a larger animated icon inside a muted circle, a
  required `title`, and optional `description`, monospaced `detail`, custom
  `className`, and pluggable `icon` (defaults to `Loader` from lucide-react). The
  container fills the available area and centers itself; the live region uses
  `role="status"` + `aria-live="polite"` so assistive tech announces the wait.
- **i18n keys for the new loading copy.** Added `tasks.loadingTitle` /
  `loadingBody`, `flows.loadingTitle` / `loadingBody`, `prompts.loadingTitle` /
  `loadingBody`, and `notes.loadingTitle` / `loadingBody` in `en`, `pt-BR` and
  `es` catalogs.

### Changed

- **Tasks, Flows and Prompts pages** now render `PageLoadingState` while their
  initial data fetch is in flight, replacing the bare 20px spinner.
- **Notes manager** consumes `loading` from `NotesProvider` and shows
  `PageLoadingState` inside the list area only when no notes are rendered yet.
  Refetches over an already-populated list don't replace the items, the FAB
  stays operational, and the small inline action spinners are unchanged.

## [4.3.2-pre] — 2026-04-30

Hardens `pulse upgrade` so interrupted installs cannot strand user data outside
`~/.local/share/pulse/frontend/data` or `client/data`.

### Fixed

- **Upgrade data preservation is now interruption-safe.** The installer no longer
  moves `frontend/data` or `client/data` into `$TEMP_DIR` during long npm/build
  steps. It stores upgrade backups under `$INSTALL_ROOT/.upgrade-backups`, restores
  them on normal completion, and rolls them back on `EXIT`, `SIGINT`, or `SIGTERM`
  if the install exits early.
- **Next upgrade attempts recover stranded durable backups.** If a previous run
  was killed after moving a data directory but before restore, the next installer
  run restores the missing `client/data` or `frontend/data` before reseeding files.

## [4.3.1-pre] — 2026-04-30

Two Settings ergonomics improvements that make day-to-day backend and intelligence management less painful: you can now copy the saved Gemini API key from Settings → Intelligence (it stays masked in the UI; the raw value is only fetched when you click *Copy key*), and you can edit existing storage backends (rename, swap region/endpoint, rotate credentials) without having to delete-and-recreate them.

### Added

- **Settings → Intelligence: *Copy key* button.** Visible only when Gemini is configured. Calls a new authenticated endpoint that returns the raw key once, writes it to the clipboard via `navigator.clipboard.writeText`, and shows a localized success toast. The key never lives in component state.
- **Settings → Storage: *Edit* (pencil) action on every non-local backend card.** Opens the backend modal in edit mode. The driver is locked (a backend's driver is part of its identity), but name, endpoint/region/bucket/prefix/path-style/database can all be changed. Secret fields prefill with the masked placeholder `********`; the modal forwards whatever is in the field and the server resolves the placeholder (or an empty/whitespace value) back to the stored secret before persisting, so the user can rotate just the non-secret fields without retyping or accidentally wiping credentials. Edits go through the same ping validation as adds, so a broken config never gets persisted.
- **Server-side `PATCH /api/storage/backends/:id` with `{ name?, config? }`.** Refuses to touch the `local` backend. Resolves placeholder/empty secret fields back from the stored config, then re-pings S3/Mongo with the merged config before saving. Returns the masked backend in the response (mirrors the GET masking — secrets never echo back). Refuses unknown backend ids with a localized 404 (`errors.backend_unknown`). Driver promise for the edited backend is invalidated and drained in the background so the next read/write rebuilds with the new config.
- **Server-side `GET /api/intelligence-config?reveal=gemini`.** Returns `{ provider, api_key }` with `Cache-Control: no-store` so the raw key never lands in any browser/proxy cache. The endpoint rejects unknown providers (`errors.intelligence.unknown_provider`, 400) and not-configured providers (`errors.intelligence.gemini.not_configured`, 404). The default `GET /api/intelligence-config` continues to return only `{ configured, masked, model, updated_at }`.
- **`updateBackend(id, patch)` in `frontend/src/lib/storage.js`** plus `updateBackend(id, { name, config })` in `services/api.js`. Edits go through the same `_setConfigV2` write path used by `addBackend` / `setDefaultBackend`.

### Changed

- **All storage modals match the terminal/flow modal shell.** `AddBackendModal` (now also the edit modal) and `ShareBackendModal` use `bg-overlay/60 px-4` for the overlay, `bg-card border-border rounded-lg p-6` for the card, an inline X close button in the header, `bg-input border-border rounded-md` inputs, and `bg-brand-gradient` for the primary action — same look and feel as `NewTerminalModal` / `NewFlowModal`. Token-import remains a sub-mode of *Add backend*; it is not offered when editing.
- **Settings → Intelligence tab restyled to match Settings → Telegram.** Header (icon + title + *Configured* badge) lives inside the card with a bottom-border separator; subtitle below; field groups use `flex flex-col gap-1` with adjacent eye-toggle buttons (no overlay); hints in `text-[11px] text-muted-foreground`; action row at the bottom with the primary *Save* on `bg-brand-gradient` and *Copy key* / *Remove key* as outlined siblings; centered `Loader` spinner during the initial fetch.
- **Centered loading spinner on Tasks, Flows and Prompts pages.** While the page fetches its data (slow with the S3 backend), the canvas now renders a `Loader w-5 h-5 animate-spin` centered in the available area instead of plain "loading…" text — same spinner style used elsewhere in the dashboard. `PromptList` upgraded from a `py-10` top-aligned spinner to `h-full min-h-[200px]` vertical centering so the prompts page matches the others.

### Internal

- **`backends-route.test.js` extended** to 15 cases covering PATCH set_default (no regression), PATCH edit S3 with new credentials, PATCH edit S3 keeping the existing secret when `********` is sent, PATCH edit S3 keeping the existing secret when the field is cleared (empty/whitespace), PATCH edit Mongo keeping the existing URI on placeholder, PATCH edit returning 400 when the ping fails, PATCH edit returning 404 for unknown ids, and PATCH edit refusing to mutate `local`.
- **New `intelligence-config-route.test.js`** (4 cases) verifying that the default GET masks the key, `?reveal=gemini` returns the raw value, `?reveal=gemini` 404s when not configured, and `?reveal=<unknown>` rejects with `errors.intelligence.unknown_provider`.
- **i18n catalogs (en / pt-BR / es)** gained: `settings.storage.edit`, `settings.storage.addModal.editTitle/save/saving/successUpdated/secretPlaceholder/uriPlaceholder`, `settings.intelligence.gemini.copyButton/copyTooltip`, `success.storage.backend_updated`, `success.intelligence.gemini_copied`, `errors.intelligence.unknown_provider`, `errors.intelligence.gemini.copy_failed`, `errors.backend_clipboard_failed`. `errors.backend_local_immutable` was relaxed to also cover edits.
- Verified `npm test`: 30 files / 209 tests passed.
- Verified `npm run build`.
- Verified `python3 -c "import service"` on the client.

## [4.2.9-pre] — 2026-04-29

Removes a hidden probe to `localhost:<port>/health` that the dashboard fired on every server load. The probe was a heuristic to detect when a LAN-IP server happened to be the same machine the browser was on, so the "Open editor" button could fall back to local mode. In practice it generated confusing requests/CORS/TLS errors against a host the user never configured, and could even mis-classify a remote server as local if a different process happened to listen on the same port locally.

### Removed

- **`https://localhost:<port>/health` probe in `ServersProvider`.** The async `probeLocalReachable` function, the per-server `localReachable` Map, the 30s probe TTL cache, and the `useEffect` that drove the probe across `servers` changes are gone. The browser now only contacts the host the user actually configured (e.g. `https://192.168.0.130:7845/health`), nothing else.

### Changed

- **`isServerLocal(server)` is now a pure check.** A server is "local" only when both the browser and the configured host are loopback (`localhost` / `127.0.0.1` / `::1`). A server registered by LAN IP is treated as remote even if it physically runs on the same machine — for the local-editor fallback the user must register the server explicitly as `localhost`/`127.0.0.1` and open the dashboard from the same loopback origin. `testServer()` and the rest of the health flow are untouched and keep using `server.host`.
- **Removed dead `useServers().localReachable` reads** in `Sidebar`, `GroupSelector` and `TerminalMosaic`. These were only there to force a re-render when probe results landed; with the probe gone, the underlying server list re-render is enough.

### Tests

- Added `frontend/src/utils/__tests__/host.test.js`: covers `isLocalHost`, `isServerLocalToBrowser` (loopback-pair acceptance, cross-LAN rejection — including the regression case "browser 192.168.0.130 + server 192.168.0.130 stays remote with no probe"), and `buildRemoteEditorUrl` (sshAlias preference, cwd encoding, null fallbacks). 17 tests.
- Verified `npm test`: 29 files / 198 tests passed.
- Verified `npm run build`.

## [4.2.8-pre] — 2026-04-29

Unblocks the dashboard when every configured Pulse client is offline. Before this, hitting "No servers responded" on boot left the user stuck on the modal — the only action was *Try again*, which is useless when the real fix is editing protocol/host/port/API key in settings (the typical case after `pulse config tls on` flipped a client from HTTP to HTTPS).

### Fixed

- **"No servers responded" gate no longer traps the user.** When every configured client fails the boot health check, the dashboard now offers, alongside *Try again*, an *Open settings* button that deep-links into `/settings?tab=servers` (or directly into the offending server's edit form when there is exactly one) and a *Continue offline* button that dismisses the gate so the rest of the dashboard chrome stays usable. This matters most after `pulse config tls on` — the client switches to HTTPS and the previously-saved HTTP server config can only be repaired from settings.

### Changed

- **`serverBoot.allOfflineBody` rewritten** in en, pt-BR and es. The body now mentions that the client may be offline *or* that protocol/host/port/API key may be wrong (with `pulse config tls on` called out as the typical trigger), and `serverBoot.openSettings` / `serverBoot.dismiss` labels were added.

### Internal

- Extracted `ServerBootGateModal` into `frontend/src/components/ServerBootGateModal.jsx` and the URL helper into `frontend/src/lib/serverBootGate.js`. The dashboard page no longer hosts the component inline, which keeps the modal isolated from the dashboard tree and unit-testable.
- `vitest.config.js` now sets `esbuild.jsx: 'automatic'` so `.jsx` files compile under the React 17+ runtime in tests without requiring `import React` in every component.

### Tests

- Added `serverBootGate.test.js`: covers `buildSettingsTargetUrl` for empty / single / multi / unsafe-character / orphan inputs.
- Added `ServerBootGateModal.test.js`: asserts the modal renders nothing while hidden, no buttons during checking, the three action buttons (retry, open settings, dismiss) when every server failed, that each onClick wires through to the right handler, and that retry is disabled while a check is in flight.
- Verified `npm test`: 28 files / 181 tests passed.
- Verified `npm run build`.

## [4.2.7-pre] — 2026-04-29

Fixes a manifest path mismatch in project move that left the project visible on both the source and the destination backend. The mover wrote to the legacy pre-4.2.1 path (`projects-manifest.json`) while every other code path reads the canonical `data/projects-manifest.json`, so the entry on the source was never actually removed. Move now reuses the canonical helpers, drops the source entry for real, and stops writing the `.moved.json` redirect marker.

### Fixed

- **Move project leaves exactly one entry, on the destination backend.** `moveProjectShards` now updates the canonical `data/projects-manifest.json` via `addProjectToManifest` / `removeProjectFromManifest` from `projectIndex`, so `listAllProjects()` sees the project only on the destination after a move. The previous code wrote to the legacy `projects-manifest.json` path and silently no-op'd against the real manifest, so the project remained listed on the source.
- **`/api/storage/backends/[id]/manifest` reads the canonical manifest path.** The route now reads `data/projects-manifest.json` instead of the legacy `projects-manifest.json`, matching `/api/projects`, `/api/storage/import-token`, and the aggregator. S3/Mongo drivers strip the `data/` prefix on resolution, so the bucket key is unchanged.

### Changed

- **Move no longer writes a `.moved.json` redirect marker on the source.** The marker was only used by 4.2.x to surface a "this project moved" notice to other installs, and it has been removed alongside the manifest path fix. The cleanup pass now also deletes any pre-existing legacy `.moved.json` left behind by older 4.2.x moves.
- **Move modal warning text updated.** The "redirect notice" promise was removed in en, pt-BR, and es. The warning now states clearly that the project is removed from the source after the copy and that other installs that only had the source backend configured need the destination token to keep accessing it.

### Tests

- Updated `projectMove.test.js`: now seeds and asserts against `data/projects-manifest.json`, verifies that no `.moved.json` is written, verifies the cleanup pass removes a pre-existing legacy marker, and adds a regression covering the local → file-backed move flow that asserts `listAllProjects()` returns exactly one entry on the destination.
- Added `backend-manifest-route.test.js`: covers the canonical path read and the 404 response when the backend id is unknown.
- Verified `npm test` for the targeted suite: 5 files / 29 tests passed.
- Verified `npm run build`.

## [4.2.6-pre] — 2026-04-29

Closes the flow-only project bleed that could survive the group isolation fix. Flow autosave is the risky path because Excalidraw saves are debounced and can flush after a project switch.

### Fixed

- **Flows no longer appear in another project's "No group" bucket.** `/api/flows` now drops rows explicitly stamped for a different project instead of restamping them from the URL project id, while preserving legacy rows without `project_id`.
- **Flow PATCH/DELETE refuses mismatched project rows.** Autosave, rename, delete, and group reassignment now return `flow_not_found` instead of mutating a flow whose stored `project_id` belongs to another project.
- **Excalidraw autosave is bound to the originating project.** Pending canvas saves capture the project id when scheduled, so a delayed flush after switching projects does not use the new active project id or show stale "Fluxo não encontrado" toasts.

### Tests

- Added route coverage for flow project filtering and mismatched-project PATCH/DELETE rejection.
- Verified focused project-isolation tests for flows, flow groups, prompt groups, task board groups, and project storage.
- Verified `npm test` outside the sandbox: 25 files / 166 tests passed.
- Verified `npm run build`.

## [4.2.5-pre] — 2026-04-29

Finishes the project-isolation fix for prompt groups and hardens all per-project group APIs against cross-project rows. Prompt text can still be global, but prompt groups are now always owned by the active project.

### Fixed

- **Prompt groups are project-scoped only.** `/api/prompt-groups` no longer reads or writes the global prompt-groups file and now requires `project_id` for GET/POST/PUT/PATCH/DELETE. Legacy global prompt groups remain untouched on disk, but the UI and API ignore them.
- **Global prompts cannot carry a project group.** `/api/prompts` rejects non-empty `group_id` for `scope=global`, clears group ids when a prompt is saved as global, and validates project prompt groups against that project's `prompt-groups.json`.
- **Prompts UI no longer leaks group categories across projects.** The library and quick selector render only the active project's prompt groups, clear stale fetches, hide the group selector for global prompts, and treat any legacy global prompt `group_id` as ungrouped.
- **Flow and task group handling now fails closed on stale ids.** Legacy groups without `project_id` are stamped from the requested project, explicit mismatched groups are dropped, flows are stamped on read, and the Flows/Tasks pages ignore assignments or reorder actions for groups outside the active project.
- **Per-project group APIs filter contaminated shard rows instead of restamping them.** `flow-groups`, `task-board-groups`, and `prompt-groups` now drop rows whose stored `project_id` belongs to another project, and `validateGroupBelongsToProject` rejects those ids even if they appear in the current shard file.

### Tests

- Added route coverage for project-only prompt groups, prompt group validation on prompts, flow/task group project filtering, and group validation against mismatched `project_id`.
- Verified `npm test` outside the sandbox: 25 files / 164 tests passed.
- Verified `npm run build`.

## [4.2.3-pre] — 2026-04-29

Closes the remaining cross-project group leak that survived v4.2.2-pre. After switching projects, the Flows / Tasks / Prompts pages still showed the previous project's groups for one render cycle — long enough for the user to see them in the sidebar and dropdowns. The effect-time `setBoardGroups([])` shipped in v4.2.2-pre fired *after* the first render with the new `activeProjectId`, so any consumer reading `boardGroups` / `flowGroups` / `groups` directly during that render rendered stale entries before the empty array landed. Terminal groups didn't have the issue because the dashboard's main page already gates display through `groupsForDisplay = groupsProjectId === activeProjectId ? groups : EMPTY_ARRAY`.

### Fixed

- **Flows page (`app/(main)/flows/page.js`), Tasks page (`app/(main)/tasks/page.js`), and Prompts library (`components/prompts/PromptsLibrary.jsx`) gate their lists at render time.** New derived values `flowsCur` / `flowGroupsCur`, `boardsCur` / `boardGroupsCur`, and `promptsCur` / `groupsCur` return `EMPTY_ARRAY` whenever the cached `*ProjectId` doesn't match `activeProjectId`. All consumers (memos, sidebars, group selectors, modal pickers, count maps) now read from those gated values, so the first render after a project switch shows an empty list instead of the previous project's groups — even though the underlying state hasn't been cleared yet.
- **PromptsLibrary now tracks `groupsProjectId` separately from the legacy `groupsLoaded` flag** and clears `prompts` / `groups` synchronously at the top of `fetchAll` (mirroring the v4.2.2-pre clear that flows/tasks already had). This protects the case where the editor panel was already mounted across the project switch and would have re-read the previous project's group list.

### Notes

- Build clean, 153/153 tests still passing — no test changes; the fix is pure render-path discipline. New cases for the gate behaviour were not added because reproducing the one-frame race in vitest would require a custom render harness; flag if the reviewer wants explicit coverage.
- Backend validation from v4.2.2-pre (`validateGroupBelongsToProject`) is unchanged and remains the second line of defence: if a user does manage to pick a stale group through some other path, the server still refuses with `400 errors.group_not_in_project`.

## [4.2.2-pre] — 2026-04-29

Cross-project group leak fix. After creating two projects on the same install and switching between them, opening "New board" / "New flow" right after the switch could expose groups from the previous project in the dropdown — and the backend would happily accept them, leaving a board in project B pointing at a group that lived in project A. Both ends fixed.

### Fixed

- **Tasks page and Flows page now clear `boards` / `boardGroups` / `flows` / `flowGroups` synchronously when `activeProjectId` changes**, before the new fetch starts. The previous code waited until the fetch resolved to swap state, which left a window where any modal or dropdown saw stale entries from the project the user just switched away from. Mirrors the pattern that the dashboard's terminal-groups effect already had (`fetchGroups` ran `setGroups([])` before the await).
- **Backend validates `group_id` against the project's groups file in 4 routes:** `POST /api/task-boards`, `PATCH /api/task-boards/[id]` (for the `move_board_group` action only), `POST /api/flows`, and `PATCH /api/flows/[id]` (only when the patch actually touches `group_id`). If the supplied id doesn't exist in `<project>/{task-board,flow}-groups.json`, the route returns `400 errors.group_not_in_project` with `detail_params: { group_id, project_id }`. The skip-if-absent guard on `PATCH /api/flows/[id]` keeps the hot scene-autosave path off the extra read.

### Added

- **`validateGroupBelongsToProject(projectId, groupsFile, groupId)` helper** in `lib/projectStorage.js`. Returns `null` on success, or a `{ detailKey, detail, params }` object that callers can pipe straight into their existing `bad()` helper. Empty / null / undefined `groupId` short-circuits to success — the API contract for "no group" stays unchanged.
- **`errors.group_not_in_project`** i18n key in en/pt-BR/es: *"That group belongs to a different project — refresh and try again."*

### Notes

- **Test suite stays at 153 / 153** — the four route tests that mock `@/lib/projectStorage` were updated to expose `validateGroupBelongsToProject: vi.fn(async () => null)`. No new positive/negative cases for the validator yet; flag during code review if you want explicit coverage of the 400 path.

## [4.2.1-pre] — 2026-04-29

Onboarding gate + the long-overdue removal of the `proj-default` fallback chain, plus a handful of follow-up fixes after testing the manifest-as-truth refactor on a fresh install. After this release, the dashboard refuses to mount until the install has at least one project (created on the spot or imported via a backend share token), and every `?? DEFAULT_PROJECT_ID` workaround is gone.

### Added

- **OnboardingGate component** (`frontend/src/components/onboarding/OnboardingGate.jsx`). Mounts in `InnerLayout` next to `NotesUI`; visible whenever `loaded && projects.length === 0` and the route isn't `/login`. Two CTAs: *Create your first project* (name + backend dropdown — same shape as the project-page modal) or *Add a storage backend* (opens `AddBackendModal`; on token paste, manifest projects appear automatically and the gate dismisses on the next refresh). After either path the dashboard unblocks without further intervention.
- **DELETE-last-project guard.** `DELETE /api/projects/[id]` returns `409 errors.project_last_remaining` when the post-delete project list would be empty across every configured backend. The Projects page hides the trash icon under the same condition (`!is_default && projects.length > 1`); even if a stale tab fires the request, the server-side guard preserves the onboarding invariant.

### Changed

- **`ProjectSelector` falls back to "Loading..." instead of "No project".** With the onboarding gate enforcing at least one project before any UI mounts, the brief flash of `projectSelector.none` between login and the first `/api/projects` response was the only place that string still appeared — replaced by the existing `projectSelector.loading` for a clean transition.
- **`activeProjectId` defaults to `null` until `refreshProjects()` resolves with at least one project.** `ProjectsProvider` no longer seeds it with `DEFAULT_PROJECT_ID`; the gate covers the empty-list case and downstream code can rely on a non-null value pointing at a real entry.
- **Sessions/groups/task-boards drop the `project_id` fallback.** `app/api/sessions/route.js`, `app/api/groups/route.js`, and `lib/taskBoardsStore.js` previously stamped `proj-default` on any record missing a `project_id`. They now leave the field absent for legacy rows; new records always carry a real id from the active selector (which the onboarding gate guarantees exists).

### Fixed

- **`projects-manifest.json` no longer pollutes the install root on the file driver.** The path is now `data/projects-manifest.json`. The S3 and Mongo drivers strip the leading `data/` on resolution, so the bucket key (`<prefix>/projects-manifest.json`) and the Mongo doc id stay exactly where they were — share tokens minted on v4.2.0-pre keep working without changes. The file driver, which does *not* strip, now writes the manifest inside `<frontend_root>/data/` next to the rest of the dashboard's data instead of at the install root next to `package.json` and `server.js`.
- **One-shot self-heal for the misplaced legacy file.** First read of the manifest from the local backend checks for the pre-4.2.1 path (`<frontend_root>/projects-manifest.json`), and if found, atomically moves the file to the new location and deletes the legacy copy. Idempotent within the process; if the move itself fails (permissions, disk full) the next project write falls back cleanly to the new path so the system still self-corrects on subsequent boots.
- **First project on a fresh install auto-claims `default_project_id` and `active_project_id` per-install prefs.** Before this fix, a new user who completed the OnboardingGate landed on the dashboard with `data/project-prefs.json` still showing `{ active_project_id: null, default_project_id: null }` — the "Default" star badge stayed empty until manually clicked, and a fresh tab without sessionStorage fell back to "first project in the list" instead of an explicit user choice. `POST /api/projects` now reads the prefs file and, when either field is null, claims the new project for it. Subsequent project creations leave the existing prefs alone.

### Removed

- **`frontend/src/lib/projectScope.js`** along with its exports `DEFAULT_PROJECT_ID` (`'proj-default'`), `DEFAULT_PROJECT_NAME`, `ensureProjectId`, `migrateList`, and `filterByProject`. None of them resolved to a real backend in v4.x — `proj-default` had been a dangling literal since the default-project flag became a per-install pref. The seven call sites (`services/api.js`, `ProjectsProvider`, three API routes, `taskBoardsStore.js`, plus the file itself) drop the imports together.
- **`projectSelector.none` i18n key** in en/pt-BR/es. Replaced everywhere by `projectSelector.loading`.

### Notes

- **Test suite up to 153 / 153 green** (was 150 at v4.2.0-pre, +3 new). New cases cover the DELETE-last-remaining guard, the legacy-manifest self-heal, and the first-project pref claim. Existing reconciler test was relaxed to expect the manifest at `data/projects-manifest.json`.
- **A v4.3.0-pre tag was minted briefly during testing for the OnboardingGate work and then withdrawn before this release** — the OnboardingGate code is part of v4.2.1-pre. If `git fetch` shows v4.3.0-pre as a stale local tag, delete it: `git tag -d v4.3.0-pre`.

## [4.2.0-pre] — 2026-04-29

Manifest-as-truth refactor. Each backend now owns its own `projects-manifest.json` and that file is the source of truth for what projects live on it — the local `data/projects.json` shadow list is gone. A second install pointed at the same shared backend sees the same project list automatically, with no separate "import" step. The default project becomes a per-install preference, so two collaborators on the same backend each pick their own default without stepping on each other.

### Changed

- **Project list is aggregated from per-backend manifests.** `GET /api/projects` no longer reads a local list — it walks every configured backend's `projects-manifest.json`, decorates each entry with `storage_ref` (= backend id), and merges in per-install prefs to expose `is_default` / `active_project_id`. The response shape stays back-compat with the v4.1 contract (`{ projects, active_project_id }`) so the frontend provider keeps working without changes; the addition of `storage_ref` per entry is purely additive.
- **`POST /api/projects` requires `target_backend_id`.** Creating a project now writes directly into the chosen backend's manifest. There is no implicit "default backend" — callers state which backend the project belongs to. The new project picker modal exposes a Storage backend dropdown (defaults to Local) so the choice is explicit.
- **Mutations move to `/api/projects/[id]`.** `PATCH` accepts either `{ name }` (writes into the owning backend's manifest) or `{ set_default: true }` (writes the per-install pref). `DELETE` removes the manifest entry and best-effort cleans up the project's seven shard files. The bulk-overwrite `PUT /api/projects` is gone except for one narrow purpose: `{ active_project_id }` updates the per-install active pref.
- **Default-project semantics are per-install.** Default is no longer a flag baked into the project entry — it lives in `data/project-prefs.json`, alongside the active project. The "Protected" lock badge becomes a "Default" star badge; setting a different project as default is now a one-click action on each card.
- **Settings → Storage drops the separate "Import token" button.** AddBackendModal handles both flows internally via a "New backend" / "Paste share token" toggle. After pasting a token the backend is registered and its projects appear automatically on the next refresh — no preview-and-checkbox step. The standalone `ImportTokenModal` and `/api/storage/import-projects` route are removed.
- **Project reorder is gone.** With projects coming from per-backend manifests in config-order (Local first), there is no single ordering to drag — the reorder UI and the corresponding API surface are removed.

### Added

- **`projects-manifest.json` per backend.** Each backend carries its own list of projects (`{ id, name, created_at, updated_at }`) at the storage root, written atomically through the backend's own lock primitive. `addProjectToManifest` is upsert with id-based deduping so reconciler runs cannot duplicate or rewrite existing entries.
- **`data/project-prefs.json` (per-install).** Captures the two preferences that don't belong in any backend manifest: `active_project_id` (per tab, but tracked on the install too as a fallback for fresh tabs) and `default_project_id` (per install — two collaborators on the same backend each pick their own).
- **v4.1 → v4.2 reconciler.** The first boot of v4.2 reads the legacy local `data/projects.json` (last-touched in v4.1), pushes each entry into the matching backend's `projects-manifest.json`, extracts `is_default` / `active_project_id` into the new prefs file, renames the legacy file to `data/projects.json.legacy-v4-1` (kept on disk as the safety net), and bumps the storage-config marker to `v: 3`. Idempotent — subsequent boots run zero work. Errors fail soft: the migration promise self-evicts so a second call retries from scratch.
- **Storage config accepts both `v: 2` and `v: 3`.** The reader treats them identically; the marker only changes when the v4.1 → v4.2 reconciler runs on a fresh empty install (where there is nothing to reconcile but the bump still happens for forward consistency).

### Fixed

- **`DELETE /api/storage/backends/[id]` no longer reads the (now defunct) local projects list.** The "backend in use" guard now walks `listAllProjects()` (manifest aggregator) so the count stays correct after the v4.2 layout takes over.
- **`/api/projects/[id]/move` resolves the source backend via manifest scan** instead of the local `storage_ref` field. After the move, both source and destination manifests reflect the new state automatically — no shadow-list bookkeeping.

### Notes

- **Test suite up to 150 / 150 green.** The v4.2 route tests (`projects-route-v4-2.test.js`), the new `projectIndex.test.js`, the `projectPrefs.test.js`, and the reconciler tests all pass. Existing storage / migration / per-route tests stay green; assertions that compared `cfg.v === 2` were relaxed to `expect([2, 3]).toContain(cfg.v)` to cover both shapes.

## [4.1.0-pre] — 2026-04-29

The collaboration layer that the multi-backend foundation (4.0.x) was preparing for. One Pulse install can now host multiple named storage backends at once (personal S3, work S3, MongoDB, etc.), share access to a backend with a colleague via a single base64url token, and move individual projects between backends with redirect markers so other installs see the change cleanly.

### Added

- **Settings → Storage redesigned as a list of backend cards.** The previous Local / MongoDB / S3 tabs are replaced by one card per configured backend, each with actions for *Make default*, *Generate share token*, and *Remove* (the latter blocked while projects still route to it). Two top-level buttons — *Add backend* and *Import token* — handle adding new backends.
- **`pulsebackend://v1/<base64url>` share tokens.** Each remote backend can generate a versioned, URL-safe token that carries the full configuration (including credentials in plaintext — that is the contract). The generated token is shown in a modal with a destructive-styled warning, copy-to-clipboard support, and a select-all fallback for non-secure contexts where the Clipboard API is blocked.
- **Import token flow.** Pasting a token validates the prefix/version/JSON shape, pings the backend with the embedded credentials, registers the backend locally (with a new opaque UUID, not the one from the source install), reads `<prefix>/projects-manifest.json`, and shows a checklist of the projects available there. Selecting + confirming bulk-imports the chosen entries into local `projects.json` with `storage_ref` pointing at the freshly registered backend.
- **Move project between backends.** A new action in the project picker opens a modal that lists every backend except the current one, requires an explicit "I understand the consequences" checkbox, and on confirm copies all seven per-project shards to the destination, updates both manifests, writes a `.moved.json` redirect marker on the source (so other installs see where the project went), and updates the local `projects.json` `storage_ref` atomically. The ordering is designed so any partial failure is recoverable by re-running the move.
- **Periodic manifest refetch in `ProjectsProvider`.** Every five minutes and on tab focus, each remote backend's manifest is fetched and diffed against the local project list. New entries surface as a toast (`Backend Foo: 2 new project(s) available — Bar, Baz`) so a collaborator dropping a project into a shared backend doesn't require a manual refresh on the other side.
- **Color dots in the project picker.** Each project entry shows an inline circle whose color is a deterministic HSL hash of its `storage_ref`, with the local backend rendered in the muted-foreground token. Hovering reveals the backend id; the visual cue makes it obvious which backend a given project lives on without opening Settings.
- **Test infrastructure.** 31 new vitest cases covering the token codec (round-trip, validation rejections), the new API routes (backends list/add/remove/set-default, share-token, import-token, import-projects, project move), and the move algorithm itself (shard copy, manifest updates on both sides, redirect marker write, source-shard delete).
- **Project lifecycle event emitted on Move.** `MoveProjectModal` fires `project:storage-ref-changed { projectId, oldRef, newRef }` on the bus that Plan 2 wired in `ProjectsProvider`. No subscribers ship in this release; future per-project caches (Notes, Flows, Tasks) can hook in to invalidate after a move.

### Changed

- **Per-install routes (servers, sessions, recent-cwds, intelligence-config, compose-drafts, groups, projects/stats) now route their reads/writes through `readLocalStore` / `writeLocalStore` from `projectStorage.js`** instead of the legacy `storage.js` compat layer. This was already the fix in 4.0.2-pre — re-mentioned here because the new Settings UI relies on the same routing for `projects.json` reads. Net effect for users: per-install data stays local even when a remote backend is the default, with no further action needed.

### Fixed

- **`projects.json` route preserves `storage_ref` field on read and write.** The pre-existing `normalizeState` and `normalizePut` helpers were dropping `storage_ref` from each project entry — a leftover from before Plan 1 added the field. Net effect of the bug: the Settings UI counted every project as belonging to the local backend even when its data lived in a remote shard, and any edit through `PUT /api/projects` would have silently rewritten the file without `storage_ref`, flipping every project back to the default backend on next read. Caught during the 4.1.0-pre smoke test.

### Notes

- **Adding a backend pings before persisting.** `POST /api/storage/backends` runs `pingS3` or `pingMongo` against the supplied configuration before calling `addBackend`, so a typo in credentials surfaces as `errors.backend_unreachable` instead of leaving a broken backend registered. Same for `import-token`.
- **GET responses mask secrets.** `/api/storage/backends` masks `access_key_id`, `secret_access_key`, and `uri` (Mongo URIs) with asterisks. The full credentials only flow OUT through the share-token endpoint, never through the list view.
- **Removing a backend is blocked while projects depend on it.** `DELETE /api/storage/backends/[id]` returns 409 `errors.backend_in_use` with a sample of project names; users move the projects (or change the backend's default flag) before retrying.

### Fixed

- **Caso 2 migration now copies per-install files (servers.json, sessions.json, groups.json, recent-cwds.json, intelligence-config.json, compose-drafts.json, layouts.json, view-state.json) from remote to local before cleanup.** v3 stored these on the remote because v3 had a single backend; v4 keeps them strictly local. Without this copy step the v4.0.1-pre auto-cleanup deleted the only copy. The local file is preserved if it already has user data — only empty/missing locals get overwritten by the remote payload.
- **Cleanup now skips per-install files when the local copy is empty or missing.** Defense in depth against any future bug where the remote→local copy fails: the cleanup will refuse to delete a per-install file from the remote unless the local has populated content. Per-project files (sharded data) are still cleaned unconditionally.

## [4.0.2-pre] — 2026-04-29

### Fixed

- **Per-install data was being routed to the default backend instead of LOCAL.** Routes for `projects`, `servers`, `sessions`, `recent-cwds`, `intelligence-config`, `compose-drafts`, and `groups` (terminal groups) still used the legacy `storage.js` compat layer, which routes to `default_backend_id`. For installs with S3 or MongoDB as default, this caused per-install data (project list, server creds, session metadata, etc.) to be (incorrectly) read from and written to the remote backend. After the v3 → v4 migration deleted the legacy flat files from the remote, those routes started seeing 404s, falling back to defaults, and creating fresh "Default"-only state on the remote — overwriting the user's actual project list every time the dashboard opened. Local install state stayed correct throughout, but the dashboard was reading the wrong source.
- **Fix:** added `readLocalStore` / `writeLocalStore` / `withLocalStoreLock` helpers in `projectStorage.js` that always route to backend `'local'`, and converted the affected routes (plus `intelligence/transcribe` and `projects/stats`, which read the same per-install files) to use them.

### Recovery instructions for users hit by the bug

1. Upgrade to `v4.0.3-pre` (`pulse upgrade --preview`) — also includes the per-install migration fix below.
2. Delete the wrongly-created `projects.json`, `servers.json`, `sessions.json`, `recent-cwds.json`, `intelligence-config.json`, `compose-drafts.json`, `groups.json` from the remote backend (S3 console, `gsutil rm`, or `mongo` shell — depending on your driver). If your bucket has soft-delete enabled, you may be able to restore the original v3 versions of these files first via the cloud provider's recovery UI.
3. Restart the dashboard. Routes will now read from the local backend, where your data was always correct.

## [4.0.1-pre] — 2026-04-29

### Added

- **Auto-cleanup of legacy v3 flat files post-migration.** The v3 → v4 migration now removes the legacy flat layout automatically after a successful reshard. Caso 1 (file local) deletes per-project flat files (`flows.json`, `notes.json`, `prompts.json`, etc.); the backup at `data.backup-pre-v4/` remains as the safety net. Caso 2 (S3/Mongo) deletes per-project flat files plus the legacy `projects.json` and per-install files (`servers.json`, `sessions.json`, etc.) that v3 incorrectly stored on the remote. A verification step (manifest read + spot-check on one shard) runs before any deletes; if anything looks wrong, the legacy files stay in place.
- **Cleanup also runs on the "remote-already-sharded" short-circuit.** Installs that upgraded under `v4.0.0-pre` got the v4 layout but the legacy flat files were never removed — re-running the migration now picks them up and cleans the remote.
- **`deleteFile(relPath): Promise<boolean>` on all three storage drivers** (`FileDriver`, `S3Driver`, `MongoDriver`). Returns `false` for missing files (`ENOENT` / `404` / no matching doc), throws on other errors. Used by the cleanup pass.

## [4.0.0-pre] — 2026-04-29

Foundation release for the upcoming multi-backend storage feature. The dashboard's storage layer was rewritten internally so a single Pulse can soon route different projects to different remotes (e.g. one S3 for personal projects, one for company A, one for company B). **The collaboration features themselves — sharing a backend via a token, moving a project between backends, manifest sync — ship in 4.1.0-pre. This release is the foundation only; end users see no UI changes.**

### Changed

- **Storage schema bumped to v2.** `data/storage-config.json` now lists named backends (`{ id, name, driver, config }`) under `backends[]` with a `default_backend_id`. The legacy v1 shape is auto-migrated on first boot.
- **Per-project data is now sharded.** Flows, notes, task-boards, prompts, and their groups live under `data/projects/<project_id>/<file>.json` (or `<bucket>/<prefix>/projects/<project_id>/<file>.json` on S3/Mongo) instead of mixed in flat top-level files. Each project entry in `data/projects.json` carries a `storage_ref` field pointing at its backend.
- **Global prompts and prompt-groups moved to a dedicated location.** Prompts with no project assignment now live in `data/globals/prompts.json` (and `globals/prompt-groups.json`). Globals never travel to remote backends — they stay on each install.
- **Per-project API routes now require `project_id` (or `?scope=global` for prompts/prompt-groups).** Calls without it return 400. The frontend services pass the active project id automatically.
- **Create / patch / delete on per-project resources are atomic.** The server reads, mutates, and writes inside a per-file lock instead of relying on the frontend to send the whole array. Eliminates last-writer-wins races on prompts, flows, notes, and task-boards.
- **`/api/projects/stats` now reads from sharded shards** so per-project counts (used by the sidebar and `deleteProject` guard) are accurate after the migration.

### Added

- **vitest test infrastructure** (`vitest`, `aws-sdk-client-mock`, `mongodb-memory-server`). 73 tests cover drivers, registry, locks, migration, and route handlers.
- **`projectStorage` helper** (`frontend/src/lib/projectStorage.js`) that resolves `project_id` to its backend and routes file operations to the correct shard.
- **Two-phase v3 → v4 migration.** Caso 1 (file local) re-shards local data, creates `data.backup-pre-v4/`, writes the new v2 config. Caso 2 (S3/Mongo active) acquires a migration lock with heartbeat and writes the new sharded layout in parallel without touching the v1 flat files (so v3 readers continue working until cleanup).
- **Driver-specific migration locks.** S3 uses `IfNoneMatch` + heartbeat (90s timeout). Mongo uses a `_pulse_migrations` collection with TTL-style heartbeat. File driver is in-process.
- **Project lifecycle event bus** in `ProjectsProvider` — placeholder for the upcoming Move project feature in 4.1.0-pre.

### Removed

- **Destructive sync endpoints.** `/api/storage-sync/local-to-cloud` and `/api/storage-sync/cloud-to-local` were removed. They used `clearStorageCollection()` which would wipe an entire backend prefix — catastrophic in the new sharded layout where multiple projects (and possibly multiple installs) share a backend. The replacement is per-project Move, shipping in 4.1.0-pre.

### Migration notes

- **Backup is automatic.** First boot of 4.0.0-pre creates `data.backup-pre-v4/` (file installs) or leaves the v1 flat files intact alongside the new sharded layout (S3/Mongo installs).
- **Coexistence with v3.** During a rolling upgrade window, v3 installs pointing at the same S3/Mongo backend continue reading/writing the flat files. v4 installs read/write the sharded shards. The two layouts drift after migration — coordinate the rolling upgrade across machines and run the cleanup command (shipping in 4.1.0-pre) once everyone is on v4.
- **No new env vars.** The v2 schema lives in the existing `data/storage-config.json`.

## [3.3.2-pre] — 2026-04-29

### Fixed

- **Session refresh and restore are now guarded against reload/reconnect storms.** The dashboard coalesces overlapping `fetchSessions` calls, throttles repeated server-scoped reconnects, skips restore attempts while a server is known offline/checking, and keeps short-lived tombstones for killed terminals so stale snapshots cannot immediately restore a just-deleted session.
- **Offline servers now stop retrying automatically after three failed health attempts.** Server health uses a bounded 5s/15s/30s backoff and then moves to a manual retry state, while the notifications WebSocket follows the same three-attempt cap instead of reconnecting forever in the background.
- **Health and local-reachability probes no longer masquerade as session-list requests.** The frontend now uses the client `/health` endpoint for server checks and same-machine probes, and `/health` reports terminal counters while validating a provided API key.
- **Concurrent restore/create/clone paths no longer orphan duplicate PTYs.** The client registers PTYs atomically, retries generated id collisions, protects per-session WebSocket lock creation, closes active WebSockets on kill, and guards PTY write/resize/close operations with a lifecycle lock.
- **Remote storage can recover after a transient initialization failure.** MongoDB/S3 backend initialization promises are cleared on failure so later requests can reconnect without restarting the dashboard.

## [3.3.1] — 2026-04-28

### Fixed

- **Linux user services no longer accumulate terminal children after client stop/restart.** `pulse-client.service` now uses `KillMode=mixed` for direct PTY mode: uvicorn receives TERM first so it can close WebSockets with the restart code and run `PTYSession.close()`, then systemd clears any leaked descendants still left in the cgroup. This matches the post-tmux lifecycle, where sessions do not persist across client restarts, and prevents the `Found left-over process ... (code/node/next-server)` / `Unit process ... remains running after unit stopped` journal spam that could leave the installed client in a polluted state.
- **PTY shutdown catches foreground jobs in their own process groups.** `PTYSession.close()` now signals the shell pgroup, the current foreground pgroup from the PTY, and Linux child process groups discovered through `/proc`, so foreground tools like `npm run dev`, `ssh`, editors, and agents are much less likely to survive as orphaned session work after the client exits.
- **Local editor launches are detached from the Pulse client cgroup when systemd is available.** The `/open-editor` endpoint now tries `systemd-run --user` with a transient unit before falling back to the old detached `Popen` path, so VS Code/Cursor windows opened through Pulse are not swept up by the new cgroup cleanup.
- **The installed dashboard no longer triggers Next.js workspace-root warnings when another lockfile exists under `$HOME`.** `next.config.mjs` now pins `outputFileTracingRoot` to the frontend directory, avoiding the noisy "Next.js inferred your workspace root" log line seen on startup.

## [3.3.0] — 2026-04-28

### Changed

- **Tasks now use cleaner Trello-style cards.** Task cards no longer show inline assignee and date form controls; clicking a card opens the existing editor for those fields. Assignees render as compact initials avatars, and start/end dates appear only when they are set.
- **Task board columns are visually tighter.** The Kanban canvas now uses narrower columns, more compact headers, softer token-based column backgrounds, and less prominent add-card/add-column controls while preserving drag-and-drop behavior.

## [3.2.10-pre] — 2026-04-28

### Fixed

- **Restart recovery no longer opens WebSockets before restored PTYs exist.** The dashboard now treats client restart recovery as a per-server restore barrier: panes are blocked while the snapshot is being flushed and while `/api/sessions/restore` is in flight, early `GET /api/sessions` calls preserve the pre-restart session list for that server, and `4004 "Session not found"` closes are ignored while the barrier is active. Once restore succeeds, Pulse reconciles sessions once, clears the barrier, and remounts only that server's panes. This prevents the rapid WS open/disconnect storm without regressing automatic recovery after `pulse restart`.
- **Session refresh calls can now be traced by reason.** Setting `localStorage.rt:debugFetchSessions` to `1` logs each dashboard `fetchSessions` trigger with a reason label, making duplicate `GET /api/sessions` sources easier to identify without adding production noise.

## [3.2.9-pre] — 2026-04-28

### Fixed

- **Restore no longer loops forever (and stops hammering remote storage with HTTP 429) when two dashboards are open at once.** The forced-restore path used to treat a fully-skipped response (every requested session was `skipped: already_exists` on the backend) as a failure and call `scheduleRestoreRetry`. With two dashboards open against the same client (e.g. the user's two PCs viewing terminals in parallel during `pulse restart`), the first dashboard's POST `/api/sessions/restore` would create the PTYs; the second dashboard's POST would then arrive with the same payload and get every entry back as skipped. That triggered `skippedDuringForcedRestore`, which scheduled another retry 3s later, which produced another fully-skipped response, and so on — an unbounded loop of POSTs at 3s intervals. Each iteration ran `await fetchSessions()` → `setSessions(...)` → snapshot persist → `PUT /api/sessions`. With the storage backend on Google Cloud Storage, which rate-limits mutations on a single key (`sessions.json`) to roughly 1/s, the cascade quickly hit `HTTP 429 SlowDown` and bubbled up as `[s3Store] writeJsonFileAtomic failed: StorageUnavailableError`, leaving the snapshot stale across both dashboards. The fix treats any non-error result (including all-skipped) as success: the sessions get marked attempted, `fetchSessions` reidrates the React state, and the server is removed from `serversNeedingRestore`, ending the cycle. Only genuine failures (network error, unreachable backend) still schedule a retry.

## [3.2.8-pre] — 2026-04-28

### Fixed

- **Auto-restore now reliably triggers when the backend comes back, without requiring an F5.** v3.2.7-pre stopped the snapshot from being truncated, so `pulse restart` preserved the active terminal in the on-disk snapshot. But the dashboard still wasn't restoring it automatically — the user had to refresh the page to get the terminals back. Root cause: `markServerForRestore` was updating two different "this server is offline" stores asymmetrically. It added the server to the page's `offlineServerIds` array (which gates the snapshot persist effect and the restore promise loop), but it never told the `ServerHealthProvider` that the server had gone offline. The auto-recovery effect that fires the recovery `fetchSessions` watches `serverHealth` for a `OFFLINE → ONLINE` transition; with `serverHealth.status` stuck at `ONLINE` (because the WS-close path never went through `markServerOffline`), the transition never happened when the backend came back, so `fetchSessions` was never called and the restore loop had nothing to react to. The only remaining path to recovery was `scheduleRestoreRetry`'s 3s `setTimeout`, which silently stalled in some cases — leaving the dashboard stuck on "[connection lost]" until F5. The fix calls `markServerOffline(serverId, 'restart')` from `markServerForRestore`, so the health provider runs its 5s backoff probe; the moment the backend answers, the auto-recovery effect fires `fetchSessions` and the restore loop reidrates the active-project sessions.

## [3.2.7-pre] — 2026-04-27

### Fixed

- **Active terminal still vanishing on `pulse restart` — second source of the truncation found.** v3.2.6-pre's gate stopped `markServerForRestore` from flushing an empty snapshot, but the regular debounced persist effect (`useEffect` at `page.js:685`) had its own version of the same bug. After the backend comes back with no PTYs and `fetchSessions` returns `[]`, `setSessions([])` triggers the effect; by then the server is no longer in `offlineSet`/`restoreSet` (`fetchSessions` removed it on success), so the persist runs normally. With `liveByServer[server] = []` and `existing` holding entries from other projects plus the active-project terminal, the merge produced `mergedServers[server] = [...otherProjects, ...empty]` — silently dropping every active-project entry, including the one the user was viewing when restart fired. The restore effect then read the truncated snapshot and never POSTed `/sessions/restore` for the missing terminal, so the backend never recreated it. The fix adds a carve-out symmetric to the one in `markServerForRestore`: if `live.length === 0` *and* the existing snapshot has entries for the active project, leave the entry alone — that combination is the transient "backend just rebooted, restore hasn't run yet" window, never a real "user deleted everything" state (`handleKill` writes through its own `persistSnapshotForServer(serverId, remainingSessions)` sync prune and doesn't depend on this effect).

## [3.2.6-pre] — 2026-04-27

### Fixed

- **Active terminal no longer disappears from the snapshot when the client restarts fast.** v3.2.5-pre's `markServerForRestore` synchronously flushes the per-server snapshot before marking the server for restore, so a recently created terminal Y survives a `pulse restart`. But on a fast restart (backend back online in well under a second on LAN), a second WS close fires almost immediately: the dashboard remounts the pane via `bumpServerReconnectKey`, the new WS opens before the backend has restored anything, and the backend replies `4004 "Session not found"`. That close also routes through `handleReconnect` → `markServerForRestore`. Meanwhile `fetchSessions` triggered by `ServerHealthProvider`'s online flip has just set `sessions[]` to `[]` (the backend reports zero PTYs because restore hasn't run yet). The second `markServerForRestore` then flushes the snapshot with `liveForServer = []`, producing `mergedServers[server] = [otherProjects, ...empty]` — wiping every active-project session (including Y) from the on-disk snapshot. The subsequent restore poll reads the truncated snapshot and POSTs `/sessions/restore` without Y, the backend never recreates it, and `fetchSessions` removes Y from React state. Y is gone for good. The fix gates the flush on `sessions.some(s => splitSessionId(s.id).serverId === serverId)`: when there are no live entries for this server in the current React state, the existing on-disk snapshot is the source of truth and we leave it alone instead of overwriting it with empty.

## [3.2.5-pre] — 2026-04-27

### Fixed

- **`pulse upgrade` now leaves the client service genuinely running.** `install/install.sh:stop_services_if_running` previously sent SIGTERM via `systemctl --user kill --kill-who=main` and slept 2s before continuing — but `kill` does not flip the unit state, so when uvicorn took longer to drain in-flight WebSockets (the `/sessions/restore` poll keeps a request open every ~4s), the unit stayed `active` while the rest of the install ran. The later `systemctl --user enable --now` then no-op'd because the unit was still considered active, and once uvicorn finally exited gracefully `Restart=on-failure` did not trigger because clean exits aren't failures. Result: pulse-client ended up stopped and the user had to run `pulse stop && pulse start` to recover. The installer now uses `systemctl --user stop`, which blocks until the unit is truly inactive before files are overwritten and the new service is started. `pulse-client.service` also gained `TimeoutStopSec=15` so a stuck drain escalates to SIGKILL within a bounded window instead of stalling the upgrade indefinitely.
- **Deleting a terminal no longer resurrects it when another configured server is offline.** The auto-restore effect in the dashboard used a single global `restoreAttemptedRef` boolean: any failure on any server (typical when a second server is on a disconnected VPN) kept the gate open, so every subsequent `setSessions` change re-ran the restore against the on-disk snapshot — which still had the just-deleted session because the snapshot persistence runs on a 500ms debounce. The `POST /sessions/restore` poll then recreated the session on the healthy server, complete with a "1 session restored" toast. The gate is now per-server (`Set<serverId>`), and `handleKill` flushes the snapshot synchronously after a successful `DELETE` (passing the post-delete sessions list as an explicit override so the closure doesn't read the still-stale React state) so the restore poll never observes a deleted id.
- **Restarting the client no longer loses terminals that were created right before the restart.** The snapshot persistence effect skips servers in `offlineServerIds` or `serversNeedingRestore` (so it doesn't overwrite the snapshot with the empty session list `fetchSessions` produces while the server is unreachable). When the user creates terminal Y and runs `pulse restart` within the 500ms snapshot debounce window, the WS close (`1012 Client restarting`) calls `markServerForRestore`, the server enters `restoreSet`, and the debounce never persists Y. After the restart the restore poll reads a snapshot without Y, the backend never recreates it, and the next `fetchSessions` wipes Y from React state. `markServerForRestore` is now async and flushes the snapshot for the affected server *before* marking it for restore, capturing the pre-restart state of `sessions[]` while it still contains Y.
- **The compose / send-text / prompt modal now surfaces the real validation error instead of a generic "unexpected server error".** `POST /api/sessions/{session_id}/send-text` gained `max_length` validation in v3.2.4-pre, but FastAPI's default 422 returns `detail` as a list of error objects. The frontend's `request()` helper expected `detail` to be a string and fell back to `errors.server_unknown` ("Servidor X: erro inesperado"), masking the actual reason. A global `RequestValidationError` handler in `client/src/service.py` now collapses the first error to a localized string and returns the same `{detail, detail_key, detail_params}` contract used for `AppException`, with new i18n keys `errors.invalid_payload` (pt-BR/en/es). `pty.write` in `send_text` is also wrapped in a try/except: a write to a PTY whose shell has died now returns `410 Gone` with `errors.session_write_failed` instead of an unhandled 500.
- **`SEND_TEXT_MAX_LENGTH` raised from 10000 to 50000 chars and mirrored on the client.** The compose modal now ships `maxLength={SEND_TEXT_MAX_LENGTH}`, a character counter that appears at ≥90% of the limit (turning red over the cap), and disabled send buttons when the cap is exceeded. The frontend `PROMPT_BODY_MAX` constant in `services/api.js` is bumped to match so prompt bodies dispatched via `/send-text` aren't rejected by client-side validation either.
- **PTYs no longer leak as orphan processes on client shutdown.** `close_active_websockets_for_shutdown` previously closed only the active WebSockets, leaving the registered `PTYSession` subprocesses alive in the systemd cgroup as zombies (`Unit process X (bash) remains running after unit stopped` lines piling up in `journalctl`). With direct PTYs (post-v3.0) sessions don't persist across client restarts anyway — `recover_sessions()` is a no-op — so the function now also calls `PTYSession.close()` on every registered PTY (idempotent: remove_reader → SIGHUP on pgroup → close fd → wait) and clears the `sessions` dict before uvicorn exits.

## [3.2.4-pre] — 2026-04-27

### Fixed

- **The server boot modal now covers the full viewport.** The blocking server check overlay is fixed to the browser viewport, including the header, so the terminal dashboard cannot be interacted with while the initial server batch is still settling.
- **The server boot modal appears immediately on terminal page hydration.** The dashboard now starts with the boot gate visible and fills in server details once the configured server list is loaded, removing the short delay before the modal appeared.

## [3.2.3-pre] — 2026-04-27

### Changed

- **Terminal boot is blocking again when server state must be reconciled.** Entering or refreshing the terminal dashboard, switching projects, or changing the configured server list now runs one full server batch before opening the workspace. The modal closes only after every configured server has either responded or timed out and at least one server is online.
- **All-offline boot keeps the user on a retry modal.** If every configured server fails the initial batch, Pulse keeps the terminal screen blocked with the per-server failure reasons and a retry button instead of opening an empty or half-hydrated workspace.
- **Remote server checks now time out after 1 second.** Session loading, health checks and remote requests fail faster so VPN-off servers move to offline/backoff state quickly.
- **The terminal dashboard no longer uses progressive offline snapshot stubs.** The post-`v3.2.0-pre` `pendingSessionServerIds` and `snapshot_only` rendering paths were removed in favor of one simpler boot batch plus the existing health backoff.

### Fixed

- **VPN transitions now trigger session reconciliation without a page refresh.** Dead or zombie terminal WebSockets detected on visibility/page/network changes now remount the affected server panes and refetch sessions, so opening or closing a VPN no longer leaves the dashboard stuck until F5.

## [3.2.2-pre] — 2026-04-27

### Fixed

- **Switching projects with an offline server no longer leaks groups from the previous project.** `fetchGroups` now runs through its own `runId` epoch counter (independent of `fetchSessions`) and resets `groups` immediately on project change before awaiting `/api/groups`, mirroring the existing treatment in `fetchSessions`. A late response from a previous project's fetch is dropped instead of overwriting the new project's group list. Project switch is also blindfolded across every async mutation handler (`handleCreate`, `handleSplit`, `handleRename`, `handleKill`, `handleAssignGroup`, `handleToggleNotify`, `handleReorderGroups`, `handleHideGroup`, `handleCreateGroupInline`) — each captures the active project at dispatch time and bails out before applying success state or rollback if the user has switched projects.
- **Cold boot with an offline server no longer empties the dashboard.** The "paused-state placeholder for offline terminals" promised by v3.2.0 only worked when the server had been online earlier in the session. On a fresh boot the offline server contributed nothing to `sessions`, so `validateTree` wiped its tiles from the rendered mosaic, leaving an empty dashboard behind the TLS modal until F5. The dashboard now hydrates a separate `snapshotByServer` state from the persisted sessions snapshot and merges it into a `sessionsForDisplay` view-model: for each server that is currently in `offlineServerIds` and has no live sessions, snapshot entries are decorated with `composeSessionId`, server identity fields and a `snapshot_only: true` flag, then handed to the sidebar, the workspace context bar, the mosaic and the search-param resolver. The live `sessions` array remains the canonical source for snapshot persistence, auto-restore, draft cleanup and mutations — `snapshot_only` never reaches disk.
- **Snapshot-only stubs never open WebSockets.** `TerminalPane` now treats `session.snapshot_only === true` as offline alongside `serverHealth.status === 'offline'`, so the existing `OfflineOverlay` renders the paused panel even during the brief render where `serverHealth` is still `unknown`.
- **Bad API key no longer masquerades as a paused server.** `bad_key` errors (HTTP 401) are excluded from the snapshot-fallback path, so a misconfigured key surfaces as a regular offline chip with the `serverFilter.reason.bad_key` message instead of misleading "paused" panels that suggest a VPN dropout.
- **Dashboard groups load even when no servers are reachable.** `fetchGroups` previously short-circuited when `servers.length === 0`, leaving `hydratedGroups=false` and stalling `projectDataReady`. Groups come from the local `/api/groups` endpoint and are independent of remote servers, so the short-circuit was wrong; it has been removed. `fetchSessions` keeps its zero-server short-circuit but now flips `hydratedSessions=true` when `serversLoaded && servers.length === 0`, allowing `projectDataReady` to open in genuine zero-server configurations. The boot effect waits on `serversLoaded` (not `!serversLoading`) so the `/login → /` transition no longer races the provider's first real load.

## [3.2.1] — 2026-04-27

### Fixed

- **Dashboard no longer waits for the slowest server before showing terminals.** Previously a single offline/VPN server stalled the initial render for the full 3-second remote timeout because the page batched every server's `getSessions` response with `Promise.allSettled` before painting. Sessions are now merged into the dashboard incrementally per server: online servers render their terminals as soon as they reply, while a server still in flight or in timeout keeps its saved layout metadata, snapshot data and compose drafts intact via a new `pendingSessionServerIds` gate. A run-id epoch counter discards obsolete responses when the active project changes mid-fetch, and the auto-restore flow continues to wait for every server to settle so it does not race the partial picture.

## [3.2.0] — 2026-04-27

### Added

- **Workspace context bar with split groups/servers header.** The dashboard now ships a dual-pane header above the terminal mosaic. On desktop it splits 50/50 — groups on the left, servers on the right — each with horizontal scrolling. On mobile the two bars stack into compact horizontal rows (groups first, then servers), so picking a group and switching the active server filter both fit on a small screen.
- **Server filter chips with live health.** Each server appears as a pill with a status dot (online / offline / checking / unknown), the count of sessions in the active group, and an exclusive `All` chip that clears the filter. Clicking a server scopes the sidebar list and the terminal mosaic to that server only without mutating the saved layout, so hidden tiles return when you click `All` again.
- **Per-server retry button.** Offline server chips and offline terminal placeholders expose a `Retry` action that runs an explicit health check and surfaces the result via toast (`toast.serverReconnected` on success, the existing `errors.server_*` family on failure).
- **`ServerHealthProvider` with backoff.** A new top-level provider tracks `{ status, reason, lastSeenAt, lastCheckedAt }` per server and re-checks offline servers with a jittered 5/15/30/60/120-second backoff. Background probes are silent — the chip status updates without a toast.
- **Paused-state placeholder for offline terminals.** When a server is known offline, terminal panes for that server stop opening WebSockets and render an inline overlay with the session name, server name, offline reason and a `Retry server` button. No more red `[Connection lost]` ANSI lines piling up while a VPN is disconnected.

### Changed

- **Reconnect is now server-scoped by default.** Automatic recoveries from a single server's WebSocket failures (`client_restart`, `heartbeat_timeout`) now destroy and remount only that server's panes via a new per-server reconnect counter, instead of remounting the whole mosaic. Manual `Reconnect` from the sidebar still performs a global reconnect with the existing `toast.reconnecting` notification.
- **Background fetch failures no longer surface as toasts.** Initial dashboard load, focus refetches, automatic restore, and passive WebSocket health probes update the per-server health state instead of stacking error toasts. Toasts remain for explicit user actions (create/kill/rename, manual retry, server settings save).
- **Remote server requests now time out after 3 seconds by default.** Creating a terminal, loading sessions and health checks now fail fast when a VPN/offline server does not respond, so the UI leaves loading states quickly and marks the server offline without blocking other servers.
- **Sidebar drops the vertical servers section.** Server selection moved out of the sidebar into the workspace context bar; the sidebar keeps the new-terminal button, reconnect/reload controls, search, sessions list, clipboard gallery and attach-file button. The `selectedServerIds` localStorage key is no longer written.
- **Project switch resets the server filter.** Switching active project clears the active server filter so chips never carry over from another project's server set.
- **Server labels now keep color on the connection icon only.** Server identity colors no longer appear in the dashboard server chips or session tags; Wi-Fi icons now carry the status color (green online, red offline) while the pill text stays neutral.

### Fixed

- **Offline VPN servers no longer freeze the dashboard.** With multiple servers across different VPNs, an offline server now stays as a status chip in the header rather than triggering global reconnect loops, repeated error toasts, or remounts of healthy panes on other servers.
- **Successful mutations heal stale offline status.** Creating a session or splitting a session also marks the target server online in the health provider, mirroring the existing `offlineServerIds` behavior so the snapshot effect persists fresh data immediately.
- **Heartbeat timeouts pinpoint the right server.** The passive WebSocket heartbeat in `TerminalPane` now passes `session.id` and a `heartbeat_timeout` reason on failure, so the parent reconnect handler can scope the recovery to the affected server's panes only.

## [3.1.0] — 2026-04-27

### Added

- **Tasks page with native Kanban boards.** A new top-level `/tasks` area lets you organize work into per-project boards with columns and tasks. Boards live inside groups (mirroring the Flows pattern), each board starts with `Todo` / `Doing` / `Done` columns, and tasks carry title, description, start/end dates and assignee. The column the card sits in *is* its status — there's no separate status field to keep in sync.
- **Drag-and-drop columns and tasks.** Built directly on `@dnd-kit` (already shipped with the project): reorder columns horizontally, drag tasks between columns including empty ones, and reorder within a column through dedicated drag handles. Drag works in any direction — left ↔ right, up ↔ down — using the `closestCorners` collision detection recommended for Kanban boards.
- **Two new synced documents.** `data/task-boards.json` and `data/task-board-groups.json` join the storage layer (now 14 synced documents) so Kanban data flows through Settings → Storage to MongoDB and S3 just like the rest of the workspace.
- **Assignee suggestions auto-populate.** The assignee field on a task offers a dropdown of every name already used in tasks for the active project — no separate "people" store, no extra setup. A "Manage" button on the task editor lets you remove a name from the dropdown by clearing it from every task on the board in one shot.
- **Task descriptions generate media previews.** Image links, direct video links and YouTube links pasted into a task description render as previews on the card and inside the editor, so separate media URL fields are no longer needed.

### Changed

- **Project stats now report task boards and tasks.** `/api/projects/stats` and the Projects page surface `taskBoards` and `tasks` counts, and project deletion is blocked until those are also empty.
- **Column creation and renaming now use modals.** Task columns follow the same modal pattern used by groups and flows instead of editing inline in the board.
- **Cards expose quick edits.** Assignee and dates can be adjusted directly on the card without opening the full task editor.

## [3.0.1] — 2026-04-27

### Changed

- **Terminal pane toolbar actions are always visible.** Split horizontal, split vertical, open editor, maximize and close controls no longer require hovering over a terminal pane.

## [3.0.0] — 2026-04-27

### Changed

- **Pulse Graphite is now the default theme.** New sessions load Graphite immediately, the old default dark theme is no longer offered in the selector, and saved `dark` preferences migrate to Graphite.
- **Omni theme is now available.** The theme selector includes Omni, with matching dashboard tokens and xterm.js terminal colors.
- **Graphite UI states are now neutral.** Active navigation, selected groups, selected terminals, prompt filters and related selected states now use the graphite light-gray treatment instead of the previous blue accent.
- **Primary actions are no longer gradient buttons.** Buttons that used the brand gradient now render as solid theme-aware controls across all themes, matching the quick prompt modal direction.
- **Pulse branding now uses a graphite mark.** The in-app logo, app icon and static logo assets were refreshed to a neutral graphite badge without the blue-purple gradient.

### Fixed

- **Terminal and notes floating action buttons are no longer translucent.** The terminal gear FAB and the desktop notes FAB now share a solid dark button style and matching compact size.

## [2.11.1-pre] — 2026-04-26

### Fixed

- **Prompt group counts now align with the other group rows.** Hidden edit/delete actions no longer push the count badge away from the right edge on real prompt groups.
- **Prompt group create and rename now use modals.** Prompt groups now follow the same modal interaction pattern as the other group managers instead of editing inline in the sidebar.

## [2.11.0-pre] — 2026-04-26

### Added

- **Prompts now have a full-screen library experience.** The prompts page was rebuilt around a dedicated library view with group navigation, pinned/ungrouped buckets, global vs project scope filters, search, preview/edit panels and mobile-first navigation.
- **Prompt groups are now first-class storage data.** The dashboard exposes prompt-group APIs, persists `data/prompt-groups.json`, includes prompt groups in storage sync, and remembers the active prompt scope, group and prompt per project/browser tab through `sessionStorage`.
- **Pulse Graphite theme.** Added the new dark theme palette across the theme registry, CSS tokens and xterm.js colors.
- **Prompt library prototype is preserved in docs.** The static UX prototype used to evaluate prompt-library layouts is saved under `docs/prototypes/`.

### Changed

- **Prompt sending now asks for a terminal target from the library.** The library shows a single `Send` action per prompt, opens a terminal picker, and leaves `Send` vs `Send + Enter` to the destination modal. The terminal gear quick-picker keeps the direct two-action flow because the target terminal is already known.
- **Prompt actions are cleaner on mobile.** The prompt preview now has a back action, shorter `Copy`/`Send` button labels, and a visible copied state after copying.

### Fixed

- **Legacy prompts are normalized when loaded.** Existing saved prompts without the new group/scope fields are normalized by the prompts API so older users keep their data.
- **Saving prompts no longer makes them disappear from the current view.** When a saved prompt changes between global/project scope or moves groups, the library follows the prompt into a visible filter instead of selecting a sibling.
- **Prompt sends no longer duplicate Mosaic leaves.** Sending from the prompt library no longer redirects through `/?session=...`, and Mosaic insertion is idempotent so an existing terminal id cannot be inserted twice.
- **Prompt quick selector send buttons now show in-flight state.** The terminal gear modal disables duplicate sends and shows a spinner while a prompt is being delivered.

## [2.10.1] — 2026-04-26

### Fixed

- **Empty flow selection is now preserved per project and group.** Toggling the selected flow off stores an explicit empty-selection marker in the tab-scoped view state, so the Flows screen stays blank after refreshes, project switches, group switches and tab navigation until another flow is selected.

## [2.10.0] — 2026-04-26

### Added

- **Flows now have independent groups.** The Flows page uses the same horizontal group bar layout as terminals while storing its groups separately in `data/flow-groups.json`. Existing flows without a valid flow-group id appear under `No group`, new flows can be created directly in the active group, flows can be moved between groups from the sidebar, and the active flow/group view is preserved per project and per browser tab through `sessionStorage`.
- **Flow groups are included in project accounting and storage sync.** Project stats now count terminal groups plus flow groups, and the storage sync file list includes `data/flow-groups.json` so MongoDB/S3/local sync keeps flow group state with the rest of the workspace.

### Fixed

- **Flow-group reordering preserves groups from other projects.** Reordering a flow group now rewrites the complete flow-groups store while only changing the active project's group order.
- **Hidden flow groups no longer leak their flows into `No group`.** Hidden groups remain valid ownership buckets, so hiding a group removes its flows from the visible list instead of reclassifying them as ungrouped. If the hidden group was selected, the persisted flow-group selection is cleared back to `No group`.

## [2.9.2-pre] — 2026-04-26

### Fixed

- **The dashboard now keeps the active project after a page refresh.** `ProjectsProvider` initializes the tab's active project from `sessionStorage` before consumers render, tracks the tab-scoped selection with a ref to avoid stale refresh closures, and only falls back to the stored server active project when the tab's project no longer exists. This prevents `/api/projects.active_project_id` from overwriting the project selected in the current tab while preserving the existing per-project group, terminal and layout state.

## [2.9.1] — 2026-04-26

### Fixed

- **Recent paths in the New Terminal modal are no longer truncated on mobile.** Each entry in `Caminhos recentes` (`frontend/src/components/NewTerminalModal.jsx`) now wraps long paths over multiple lines (`break-all` instead of `truncate`), so the user can read the full directory on narrow viewports without relying on the title tooltip. The remove (`X`) button was switched to top-aligned (`items-start`) so it stays next to the first line of a multi-line path, and the recents list `max-h` was bumped from `40` to `48` to give wrapped entries a bit more breathing room before the inner scroll kicks in.
- **Codex CLI input no longer disappears when typing the first key on Android Chrome.** xterm.js's default `scrollOnUserInput` is now disabled, so the local viewport stops jumping to the buffer bottom on every keystroke before the PTY responds. The dashboard still scrolls to the bottom on every output chunk, so normal "follow latest output" behaviour is preserved. The `visualViewport.resize` listener was also hardened: it now compares `rows`/`cols` before vs. after `fitAddon.fit()` and only sends a fresh `resize` to the PTY (and a corresponding `scrollToBottom`) when the dimensions actually change, plus the debounce was bumped from 80 ms to 200 ms to absorb Gboard suggestion-bar jitter that triggered redundant SIGWINCHes — Ink-style TUIs (Codex CLI) clear+redraw on every SIGWINCH and were repainting compactly during keyboard animation, leaving the input above the visible viewport.

## [2.9.0] — 2026-04-25

### Changed

- **Voice transcription now sends straight to the terminal.** Tapping `Transcribe` in the voice modal posts the recognized text to the active session via the existing `send-text` endpoint without `Enter`, so the user can review the line at the prompt and press Enter themselves. The intermediate compose editor is no longer opened from the voice flow — that path was duplicating the keyboard action and adding an extra confirmation step. The voice hint copy was rewritten in pt-BR / en / es to reflect the new direct-send behaviour.

### Fixed

- **Voice modal pause/resume now updates reliably.** The recording sub-views were declared as functions inside `VoiceCommandModal` and rendered as `<RecordingBody />`, which made React see a fresh component type on every render and unmount/remount the pause button on every state change. They are now rendered as plain JSX-returning helpers, so the pause click handler stays attached and the audio context suspend/resume promises are awaited and logged on failure instead of being fire-and-forget.
- **Voice modal recording indicator goes static when paused.** The pulsing red dot now stops animating and dims to the muted token while the recording is paused, matching the `Pausado` label so the state is visible at a glance.

## [2.8.0] — 2026-04-25

### Fixed

- **Visible terminal panes survive client restarts without being deleted from the session snapshot.** The client now marks shutdown WebSocket closes as a service restart (`1012`) instead of the normal `"Session ended"` terminal contract, and the dashboard treats that path as reconnectable. Servers in the restart/restore window are excluded from snapshot, draft and mosaic cleanup until `/sessions/restore` has rebuilt the PTYs and the panes have remounted against the new client process.
- **Session snapshots now preserve restored labels.** The local `/api/sessions` store keeps `group_name` and `project_name`, so restored terminals continue to carry readable notification labels after a client restart.

## [2.7.2-pre] — 2026-04-25

### Added

- **Voice input for terminal panes.** The pane action menu now includes a microphone action that opens a compact recorder with a themed waveform, pause/resume controls and a separate transcribe button. Once Gemini returns text, Pulse opens the existing compose modal with the transcript ready for review and send.
- **Intelligence settings for Gemini transcription.** Settings now has an `Intelligence` tab where users can save, replace or remove a Gemini API key and choose between active Gemini Flash / Flash-Lite models, including Gemini 3 preview options. The configuration is stored through Pulse's active storage backend (`file`, MongoDB or S3) and included in local/cloud sync.
- **Authenticated Gemini transcription APIs.** The dashboard now exposes authenticated local routes for intelligence config and audio transcription, keeping the Gemini API key server-side and enforcing audio size, MIME and timeout limits.

### Fixed

- **Voice recording upload size now matches the server limit.** Browser audio is resampled to 16 kHz WAV before upload, recording auto-stops at four minutes, and the client rejects oversized blobs before calling the transcription endpoint.
- **Gemini model changes no longer require re-pasting the API key.** Updating the selected model now preserves the stored key on the server.
- **Voice modal actions are more reliable.** Closing a recording aborts any in-flight transcription and cleans up microphone resources immediately, while pausing preserves captured audio without continuing to append samples.
- **Voice modal no longer gets stuck while checking configuration.** Loading the Intelligence settings now has an explicit timeout and retry path, so a stalled local config request leaves the loading state instead of spinning forever.

## [2.6.0] — 2026-04-25

### Added

- **Smart mosaic insertion that keeps tiles balanced and avoids the third-terminal disappearance.** A new `insertSession()` helper in `frontend/src/utils/mosaicHelpers.js` walks the current tree and attaches the new pane to the lightest branch while alternating the parent split direction (`row`/`column`). It replaces the four hand-rolled `{type:'split', children:[…]}` blocks in `frontend/src/app/(main)/page.js` (used by `handleCreate`, `handleSelectSession`, the deep-link `?session=` flow and the mobile path).
- **Generic clipboard upload.** A new client endpoint `POST /api/clipboard/file` accepts any `UploadFile`, sanitizes the original name through an allowlist, and stores it under `/tmp/pulse-clip-<random>-<safe>.<ext>`. The frontend ships a matching `saveFileToTemp(serverId, file, name)` and a renamed `AttachFileButton` (drops `accept="image/*"`) so users can attach PDFs, source files, etc., not just images. The legacy `POST /api/clipboard/image` and `saveImageToTemp()` are kept as thin wrappers for backwards compatibility.
- **Disconnection-aware terminal action menu.** The pane gear FAB (`frontend/src/components/PaneActionsFab.jsx`) subscribes to a new `subscribeTerminalConnection()` helper exported by `TerminalPane.jsx`. When the WebSocket of that session is `closed` / `replaced`, the gear is disabled with a tooltip (`terminal.actions.disconnected`) and any open menu is auto-collapsed so the user can no longer fire actions that would silently no-op.
- **`isTerminalConnected(sessionId)` / `getTerminalConnectionState(sessionId)`.** Read-only helpers exposed by `TerminalPane.jsx`. Used by the compose flow and the FAB to gate UI on real WebSocket health.

### Changed

- **Compose modal is now transactional.** `frontend/src/app/(main)/page.js#handleComposeSend` no longer calls `sendKey()` (raw WebSocket) plus a `setTimeout` race. It calls `sendTextToSession()` (HTTP), and only on a successful response does it clear the persisted draft and close the modal. On `isTerminalConnected()=false` the modal stays open and shows the disconnected toast; on a server error the draft is preserved. The `ComposeModal` itself now disables both Send buttons and shows a `<Loader>` while the request is in flight.
- **Pane action menu redesign.** The four satellite buttons that orbited the gear are now compact pill buttons (icon + short label) stacked under the gear, using new short labels `terminal.actions.{capture,prompts,notify,compose}Short`. The “prompts” button switched from `MessageSquareText` to `Sparkles` (`lucide-react`) to signal the AI/snippet nature of saved prompts.
- **Mosaic tree is normalized at every entry point.** `normalizeMosaicTree()` is run on layouts read from `sessionStorage`, on every `Mosaic onChange`, and inside `setMosaicLayout` itself. The legacy `{type, children, splitPercentages}` shape is converted to the canonical `{direction, first, second, splitPercentage}` shape and any node with a missing child is collapsed into its surviving sibling.
- **`sendKey(sessionId, data)` returns a boolean** instead of failing silently when the WebSocket is not `OPEN`. Existing callers now gain visibility into "did this keystroke actually leave the browser?".
- **Notification renamed: `_cleanup_old_clipboard_files()`** in `client/src/routes/terminal.py` only removes files that start with the controlled `pulse-clip-` prefix, instead of indiscriminately deleting every `.png` under `/tmp` older than 24h. Constants renamed to `MAX_CLIPBOARD_FILE_BYTES`, `CLIPBOARD_CHUNK_BYTES`, `CLIPBOARD_TMP_MAX_AGE_SECONDS`.

### Fixed

- **Third terminal no longer disappears when dropped beside two existing tiles.** The previous code mixed two split shapes (`{type, children, splitPercentages}` from in-app helpers, `{direction, first, second, splitPercentage}` from `react-mosaic-component`'s drag/drop). When a node ended up with one valid child plus an unrecognized sibling, `react-mosaic-component` rendered an empty tile slot for the missing side and effectively hid one of the panes. Normalization now collapses one-child splits and converts every node to the canonical shape before persisting/rendering.
- **Compose modal no longer wipes the draft when the WebSocket was already dead.** Previously the click handler unconditionally called `sendKey()` (silent no-op on a closed socket) and then cleared the draft, so a pre-typed message vanished without ever reaching the terminal. With the HTTP-based confirmation, the draft now survives any failure mode and the user sees a toast instead.
- **Compose drafts are now preserved even when the last edit was still debounced.** A failed send immediately persists the current textarea content before the modal can be closed, and the modal close button is disabled while a send request is in flight.
- **The HTTP `send-text` endpoint now has an explicit payload limit.** Compose sends are capped server-side before writing to the PTY.
- **Legacy clipboard image uploads keep their original i18n contract.** `/api/clipboard/image` still emits `success.image_saved` / `errors.image_too_large`, while the new generic file endpoint uses the file-specific keys.
- **Mobile compose now follows the same disconnected-session guard as the pane action menu.** The collapsed sidebar compose button stays disabled until the active terminal is connected.
- **The file attach picker now enforces the same 15-item limit as the clipboard gallery.** Oversized selections are trimmed before previews or upload paths are created.
- **Note minimize (`-`) only collapses the body now.** `frontend/src/components/Notes/StickyNote.jsx` keeps a local `minimized` flag: when on, `Rnd` shrinks to the header height (36px), `NoteBody` and the saved-status footer are hidden, and resizing is disabled. The `X` button keeps its prior behavior (`closeOrDeleteIfEmpty`); the `-` button no longer doubles as “close”.

## [2.5.12] — 2026-04-25

### Fixed

- **Next.js build workers now have `NODE_OPTIONS` stripped even after Next loads environment files.** The installer preloads a small guard during `next build` that clears `NODE_OPTIONS` and patches child process creation so worker processes cannot inherit invalid flags reintroduced after startup, such as `--r=` from a host-specific env source.

## [2.5.11-pre] — 2026-04-25

### Fixed

- **Installer npm isolation now uses distinct empty config files.** `install/install.sh` no longer points both npm `--userconfig` and `--globalconfig` at `/dev/null`, which npm rejects as double-loading the same config file before dependency install starts. The clean npm helper now creates separate empty config files under the installer temp directory and uses those paths instead.

## [2.5.10-pre] — 2026-04-25

### Fixed

- **Dashboard production builds now bypass npm scripts and run Next.js in a minimal clean environment.** The installer calls `./node_modules/.bin/next build` directly through `env -i`, preserving only basic process variables like `HOME`, `PATH`, and locale while clearing every `NODE_OPTIONS` / npm node-options form. This prevents user shell, nvm, npm config, or lifecycle-script behavior from reintroducing invalid flags such as `--r=` into the Next.js build worker.

## [2.5.9-pre] — 2026-04-25

### Fixed

- **Dashboard dependency install and build now ignore user/global npm config files.** `install/install.sh` runs npm through a clean helper that clears `NODE_OPTIONS`, both `NPM_CONFIG_NODE_OPTIONS` environment forms, and points npm `--userconfig` / `--globalconfig` at `/dev/null` while forcing `--node-options=`. This prevents a broken `node-options=--r=` in `~/.npmrc` or a global npm config from being re-applied after the installer has sanitized the environment.

## [2.5.8-pre] — 2026-04-25

### Fixed

- **Dashboard builds now also clear lowercase `npm_config_node_options`.** Some shells or user npm environments export `npm_config_node_options=...` instead of `NPM_CONFIG_NODE_OPTIONS`, letting npm re-inject a broken `NODE_OPTIONS` value such as `--r=` into the Next.js build worker. `install/install.sh` now clears both forms for `npm ci`, `npm install`, `npm run build`, and `npm prune`.

## [2.5.7] — 2026-04-25

### Fixed

- **Linux installer now installs apt packages correctly when invoked as root.** `install/install.sh` uses a dedicated apt helper so `DEBIAN_FRONTEND=noninteractive` is applied before `apt-get` when no sudo wrapper is needed, preventing `/bin/sh` from trying to execute `DEBIAN_FRONTEND=noninteractive` as a command after the NodeSource repository is configured.

## [2.5.6-pre] — 2026-04-25

### Fixed

- **Linux installer now runs the NodeSource setup script correctly when invoked as root.** `install/install.sh` no longer appends `-E` after an empty sudo command while installing Node.js 20, which previously made `/bin/sh` try to execute `-E` as a command and abort with `sh: 182: -E: not found` on fresh root installs.

## [2.5.5-pre] — 2026-04-25

### Fixed

- **Installer now also clears `NPM_CONFIG_NODE_OPTIONS` for every `npm` call.** A user `.npmrc` with `node-options=...` (or an exported `NPM_CONFIG_NODE_OPTIONS`) made npm reinject `NODE_OPTIONS` for the spawned Next.js build worker even though the installer already set `NODE_OPTIONS=` on the command line. With a malformed value such as `--r=...` the worker would die with `is not allowed in NODE_OPTIONS` (Node exit 9) and `next build` would never produce `.next/BUILD_ID`. `install/install.sh` now passes both `NODE_OPTIONS=` and `NPM_CONFIG_NODE_OPTIONS=` to `npm ci` / `npm install` / `npm run build` / `npm prune`, blocking that reinjection path without requiring the user to clean up their `.npmrc`.

## [2.5.4] — 2026-04-25

### Fixed

- **Dashboard install/build now ignores inherited `NODE_OPTIONS`.** The installer runs `npm ci` / `npm install` / `npm run build` / `npm prune` with a clean `NODE_OPTIONS`, preventing user shell flags from breaking `next build` on fresh servers. The dashboard production entrypoints also clear `NODE_OPTIONS` in `frontend/start.sh`, `install/systemd/pulse.service.tmpl`, and `install/launchd/sh.pulse.dashboard.plist.tmpl`, so a contaminated user environment cannot crash `node server.js` after install.
- **Installer build logs now report the real failing exit code.** `run_logged_tail()` now captures the command status directly before printing the truncated log, instead of reading the status of the surrounding `if` compound. Failed builds now show the actual npm/Next.js exit code alongside the last log lines.

## [2.5.3] — 2026-04-25

### Fixed

- **The installer no longer starts the dashboard after a failed production build.** `install/install.sh` now captures `npm ci` / `npm install` / `npm run build` output to a temporary log and checks the command's real exit status before showing the last log lines on failure. This avoids the previous `cmd | tail` pattern under `/bin/sh`, where `tail` could mask a failed npm command and let installation continue until `pulse.service` crashed at runtime with Next.js' `Could not find a production build in the '.next' directory` error. The installer also asserts that `frontend/.next/BUILD_ID` exists after `next build` before it reports success.

## [2.5.2] — 2026-04-25

### Added

- **Manual `Reload page` button next to the reconnect button in the sidebar.** When mobile Chrome resumes from a long background pause and the WebSocket/network state cannot be recovered transparently (most often after WhatsApp swap or screen lock on 5G), the user now has a one-tap full-document reload available without leaving the app. Wired to `window.location.reload()` and exposed via `t('sidebar.reloadPage')` in the three locales.

### Fixed

- **Pulse internal env vars no longer leak into spawned terminal shells.** `client/src/tools/pty.py` now spawns the user's shell with a sanitized environment built by the new `build_pty_env()`. The function inherits `os.environ` (preserving toolchain variables like `PATH`, `HOME`, `SHELL`, `SSH_AUTH_SOCK`, `DISPLAY`, `WAYLAND_DISPLAY`, `LANG`, `LC_*`, `AWS_*`, `GOOGLE_APPLICATION_CREDENTIALS`, etc.) and then drops every key found in Pulse env files (`client/.env`, `frontend/.env`, `~/.config/pulse/client.env`, `~/.config/pulse/frontend.env`), plus fallback internal keys such as `COMPOSE_PROJECT_NAME`, `VERSION`, `API_HOST`, `API_PORT`, `API_KEY`, `WEB_HOST`, `WEB_PORT`, `AUTH_PASSWORD`, `AUTH_JWT_SECRET`, `AUTH_COOKIE_SECURE`, `TLS_ENABLED`, `TLS_CERT_PATH`, `TLS_KEY_PATH`, and everything starting with `PULSE_`. `TERM` is set to `xterm-256color` when missing. Previously the systemd template and `start.sh` would `EnvironmentFile`/`set -a` the client config into the uvicorn process, and `subprocess.Popen(env=os.environ.copy())` propagated all of it into every terminal — `COMPOSE_PROJECT_NAME=pulse` hijacked Docker Compose in unrelated projects and `API_KEY` / `AUTH_JWT_SECRET` ended up visible in the user's `env` output.
- **`start.sh` (root) no longer sources both `.env` files into the orchestrator process.** It now reads only `API_PORT` and `WEB_PORT` via `pulse_env_get` for the pre-spawn port checks, leaving the actual env loading to each child's own `start.sh`. Previously a wide `source client/.env` followed by `set -a; source frontend/.env` left the orchestrator (and therefore both children spawned via `&`) with a merged environment — for example `TLS_ENABLED=true` from `frontend/.env` reached the client and made uvicorn try to start in HTTPS mode without the matching cert paths.
- **`client/start.sh` `unset`s dashboard variables (`WEB_HOST`, `WEB_PORT`, `AUTH_PASSWORD`, `AUTH_JWT_SECRET`, `AUTH_COOKIE_SECURE`, `TLS_*`) before sourcing `client/.env`,** then sets local TLS defaults (`TLS_ENABLED=false` etc.) so the client only enables TLS when its own `.env` says so. `frontend/start.sh` does the symmetric cleanup, `unset`ing `COMPOSE_PROJECT_NAME`, `VERSION`, `API_HOST`, `API_PORT`, `API_KEY` before loading `frontend/.env`. Together with the PTY denylist above, this means a stale variable in one process can no longer poison the other or the shells the user opens through Pulse.
- **Login redirects are now a full document navigation after setting the auth cookie.** The login form used to call `router.replace()` immediately after `/api/auth/login` returned 200. In Next.js dev mode this could intermittently reuse a stale unauthenticated app-router transition before the middleware observed the freshly-set auth cookie, sending the user back to `/login` even though the password was accepted. The form now uses `window.location.replace()` for the post-login transition, so the next request is a normal document load with the cookie attached.
- **The dashboard auth cookie now uses the standards-compliant name `rt_auth`.** The previous `rt:auth` name contained a colon, which is outside the RFC cookie-name token grammar and can be rejected inconsistently by browsers even though server-side HTTP clients may accept it. New logins set `rt_auth`; middleware and API auth wrappers still accept the legacy `rt:auth` cookie during the transition, and logout clears both names.

## [2.5.1] — 2026-04-25

### Fixed

- **`pulse upgrade` no longer crashes while resolving the latest release.** `install/install.sh` and `install/pulse.sh` now read the GitHub releases payload from temporary files before invoking Python, instead of passing the full JSON response as a shell argument. This avoids `python3: Argument list too long` on repositories with many releases.

## [2.5.0] — 2026-04-25

### Added

- **Preview release channel.** Pulse now distinguishes stable releases (`vX.Y.Z`) from preview releases (`vX.Y.Z-pre`). Preview releases are flagged as GitHub prereleases by `.github/workflows/release.yml` (the workflow now passes `--prerelease` automatically when the pushed tag ends in `-pre`) and are filtered out of every default code path: the dashboard's update modal queries `https://api.github.com/repos/kevinzezel/pulse/releases?per_page=100` and picks the first release where `prerelease !== true` and the tag does not end in `-pre`, `pulse upgrade` instructs the installer to resolve `latest` as the latest stable, and `pulse check-updates` compares against the stable channel by default. The two checks (GitHub `prerelease` flag + `*-pre` tag suffix) act as a defense-in-depth pair: the workflow automates the flag for tags created by the standard release script, the suffix catches releases created manually without ticking the prerelease checkbox.
- **`pulse upgrade --preview`** installs the latest preview release. Resolves `PULSE_VERSION=preview` and forwards it to `install/install.sh`. Useful for users who want to validate an in-flight feature before it lands on stable.
- **`pulse check-updates --preview`** queries the preview channel without installing anything. Output now uses explicit `latest stable:` / `latest preview:` labels so the channel is unambiguous, and the comparison no longer recommends a downgrade when the installed version is ahead of the queried channel (e.g. running `2.5.0-pre` while querying stable `2.4.1` no longer suggests "Update available").
- **`PULSE_VERSION=preview`** in `install/install.sh` resolves to the latest preview tag. `PULSE_VERSION=latest` keeps its existing meaning but now explicitly excludes preview tags. Pinning a specific tag (`PULSE_VERSION=v2.5.0-pre`) remains supported as an explicit per-install opt-in. The installer now logs `resolved <channel> → <tag>` so the user sees exactly which tag a `latest`/`preview` request landed on.
- **`frontend/src/utils/version.js`** with `stripLeadingV`, `isPreviewVersion`, `comparePulseVersions`, and `isOlderThan`. SemVer-lite comparator that understands `X.Y.Z` and `X.Y.Z-pre`, with the rule that same-core stable outranks prerelease (`2.5.0 > 2.5.0-pre`). Used by `UpdateNotifierProvider` so a server running `2.5.0-pre` is no longer flagged as outdated when the latest stable is `2.4.1` — the modal now requires the installed version to be strictly older than the latest stable.

### Changed

- **`UpdateNotifierProvider` outdated-server detection** now uses `isOlderThan(installedVersion, latestStable)` instead of strict string inequality. Servers ahead of the latest stable (typically because they're on the preview channel) are no longer surfaced in the update modal.
- **`/api/update-status` cache** now stores `latestVersion: null` cleanly when GitHub answers but no stable release exists yet (only previews published). Treated as "no update info" by the dashboard — the modal stays closed instead of misfiring.
- **`CLAUDE.md` release flow** now defaults all AI-generated releases to `vX.Y.Z-pre` (preview channel). Stable tags (`vX.Y.Z` without `-pre`) are only published when the repo owner explicitly asks for the promotion. The release script template, CHANGELOG section header, and `/tmp/pulse-release-...sh` filename now embed the `-pre` suffix by default.

## [2.4.1] — 2026-04-25

### Fixed

- **Replaced terminal connections no longer keep suppressing idle alerts from the old device.** When a phone or another tab opens the same session, the desktop terminal WebSocket closes with `4000 "Replaced by new connection"` and now marks that pane's stream as inactive. `TerminalPane` only sends `viewing` while its own terminal WS is open and active, so a stale desktop pane showing "Connection replaced" cannot keep acking Rule 5 while the real work happens on the phone. The active device still sends presence normally; if the session later becomes idle and no active viewer is present, notifications fire as expected.

## [2.4.0] — 2026-04-25

### Added

- **Smart multi-monitor presence policy** in `Settings → Notifications`, now the default for new installs (`localStorage.rt:notify-presence-policy = "smart"`). Designed for the multi-monitor workflow where Pulse stays visible on a side monitor while the user works in another app: the heartbeat keeps suppressing idle alerts as long as (a) the tab is visible and the terminal is in viewport, and (b) the operating system reports recent input via the [Idle Detection API](https://developer.mozilla.org/en-US/docs/Web/API/Idle_Detection_API) — even without window focus. When the user steps away from the keyboard or locks the screen, the OS-level signal flips and the watcher's Rule 5 stops being acked → the alert fires normally. Existing preferences (`strict`, `visible`) are preserved verbatim, no silent migration. The legacy "Multi-monitor" mode was renamed to "Always-visible multi-monitor" and kept as an advanced option for users who explicitly want presence to require nothing more than tab visibility.
- **Idle Detection API integration** centralized in `frontend/src/providers/NotificationsProvider.jsx`. The new `requestIdleDetection()` triggers `IdleDetector.requestPermission()` strictly under a user gesture (the `Enable system detection` button in Settings), starts a detector with the spec-minimum threshold of 60s and exposes the live `userState` (`active`/`idle`) and `screenState` (`locked`/`unlocked`) so the heartbeat decision can read them synchronously. After the first authorization, the detector is re-armed silently on subsequent sessions by checking `navigator.permissions.query({name: 'idle-detection'})` and then starting the detector directly (no permission prompt, no user-gesture dependency). A persistent flag `localStorage.rt:notify-idle-detection-armed` records the user's intent so re-arming doesn't keep retrying after revocation. Without permission (or on browsers without the API), `smart` falls back to "input within Pulse in the last 2 minutes (no focus required)" — explained in the Settings UI so the user knows what to expect.
- **`canSendViewingHeartbeat()`** exported from `NotificationsProvider`, replacing the per-mode logic that used to live inline in `TerminalPane.sendHeartbeat`. The decision tree now lives in one place: `visible` → always; `strict` → focus + activity in last 30s; `smart` → IdleDetector says active+unlocked, or fallback to local activity in last 2 min. `lastUserActivityTs` (the global keyboard/mouse/touch listener) was moved from `TerminalPane.jsx` to `NotificationsProvider.jsx` so both presence modes can consult it without duplication.
- **Health probe for the multi-client notifications WebSocket.** `/ws/notifications` now accepts `{type:"ping"}` and responds with `{type:"pong"}`; the frontend probes it every 30s and reconnects if no pong arrives within 5s, avoiding the "OPEN but dead TCP" state where viewing heartbeats looked sent but never reached the client. `TerminalPane` also mirrors `{type:"viewing"}` through the terminal WS when available, so the exclusive terminal connection remains a best-effort fallback instead of being skipped whenever `sendViewing()` returns successfully.
- **3-mode presence picker** in `frontend/src/components/settings/NotificationsTab.jsx` (Strict / Smart multi-monitor / Always-visible multi-monitor) with descriptive hints, a `(recommended)` badge on Smart, and a status block that appears under Smart explaining the Idle Detection state (unsupported / unrequested / permission-denied / monitoring with live `userState`+`screenState` / failed) and offering the `Enable system detection` action when applicable.
- **i18n keys** for all the above in `pt-BR.json`, `en.json`, `es.json`: `notifications.presencePolicySmart`, `notifications.presencePolicySmartHint`, `notifications.presencePolicyRecommended`, `notifications.idleDetectionTitle`, `notifications.idleDetectionPrompt`, `notifications.idleDetectionEnable`, `notifications.idleDetectionRequesting`, `notifications.idleDetectionMonitoring`, `notifications.idleDetectionUnsupported`, `notifications.idleDetectionDenied`, `notifications.idleDetectionFailed`, `notifications.idleDetectionFallback`, `notifications.idleDetectionEnabledToast`, `notifications.idleDetectionDeniedToast`, `notifications.idleDetectionUnsupportedToast`, `notifications.idleDetectionFailedToast`, `notifications.idleUserState.{active,idle}`, `notifications.idleScreenState.{locked,unlocked}`. Existing `presencePolicyVisible` / `presencePolicyVisibleHint` strings were updated to reflect the rename to "Always-visible multi-monitor (advanced)".

### Changed

- **`NOTIFICATIONS.md` updated** to document the smart policy, the Idle Detection enrollment flow, the notifications-WS health probe, the new constants (`STRICT_ACTIVITY_THRESHOLD_MS`, `SMART_FALLBACK_ACTIVITY_THRESHOLD_MS`, `IDLE_DETECTOR_THRESHOLD_MS`, `NOTIFICATIONS_WS_PING_INTERVAL_MS`, `NOTIFICATIONS_WS_PONG_TIMEOUT_MS`), the new `localStorage` keys, and an expanded verification checklist (now 13 items, separating smart with/without Idle Detection from the legacy always-visible mode).

## [2.3.0] — 2026-04-25

### Added

- **Self-signed TLS acceptance modal** in the dashboard. When a server registered with `protocol: "https"` is unreachable from the dashboard (in practice: the browser is blocking the request because the self-signed certificate has not been accepted yet), a modal opens at boot with two sections — "Accept self-signed certificate" listing the affected HTTPS servers with an `Open /health` button that pops a new tab pointing at `https://<host>:<port>/health` (so the user can accept the cert via the browser's "Advanced → Continue anyway" flow), and "Mixed content" listing servers wrongly registered as `http` while the dashboard runs over `https` (an HTTPS dashboard cannot fetch HTTP URLs at all) with an `Edit server` deep-link to `Settings → Servers` pre-loaded for that entry. The modal also exposes a `Re-test now` button that re-runs `fetchSessions` to refresh `offlineServerIds`.
- **Per-server silencing for the TLS modal.** Each item in the modal has a "Don't warn me about this server" action (bell-off icon) that adds the server id to `localStorage["rt:tlsModalSilencedServerIds"]`. Silenced servers never appear in the modal again on this machine (across tabs and reloads), but keep working normally everywhere else. Designed for the legitimate-offline case (e.g. a server that only exists when on the VPN). Settings → Servers shows a "TLS warnings silenced" badge next to silenced servers and a bell button to revert (`Re-enable warnings`). The modal also has a session-scoped `Close` button that hides it for the current tab via `sessionStorage["rt:tlsModalDismissed"]`.
- **`frontend/src/utils/serverHealth.js`** consolidating `timeoutSignal`, `isMixedContent` and `testServer` (the `/health` + `/api/sessions` probe) — previously inlined in both `ServersTab.jsx` and `ServersProvider.jsx`. `testServer` now short-circuits with `{ ok: false, reason: "mixed_content" }` before any fetch when the dashboard is on HTTPS and the server is on HTTP, so the existing reason-based UI in `Settings → Servers` surfaces the actual cause instead of a generic "unreachable". A new translation `settings.servers.test.reason.mixed_content` was added in all 3 locales.
- **`frontend/src/utils/tlsSilenced.js`** with `readSilencedIds` / `writeSilencedIds` / `addSilencedId` / `removeSilencedId`, shared by the modal and `ServersTab`.

### Changed

- **`ServersProvider.probeLocalReachable` now uses the shared `timeoutSignal` from `utils/serverHealth.js`** with a `cancel()` callback that clears the underlying `setTimeout` once the fetch resolves — the previous local copy returned only the `AbortSignal`, leaving the timeout pending until it fired (~1.5 s of dead handles per probe; harmless in practice but cleaner now).

## [2.2.0] — 2026-04-25

### Fixed

- **PTY now drains continuously, independent of any WebSocket being connected.** Previously, the asyncio reader on the master fd was registered inside `websocket_terminal()` (`loop.add_reader`) and removed on disconnect. While no client was attached, nothing consumed the master fd — the kernel buffer (4–64 KB) filled up and the shell's `write()` blocked, effectively pausing whatever was running (Claude Code, builds, watchers). On a phone with the browser minimized this looked exactly like "the agent stopped while the tab was hidden and only resumed when I came back". Side-effect on notifications: the watcher reads from `pty_session.get_scrollback_bytes()`; with the reader gone, the scrollback froze and the display hash never changed → the idle alert fired after `idle_timeout` while the agent was actually blocked, not idle. Fix: the reader now lives inside `PTYSession`, registered in `start()` and removed in `close()` (before `os.close(fd)` to avoid an EBADF on the selector callback). The `_on_pty_read` always feeds `append_to_scrollback` (the source of truth) and best-effort enqueues to a per-WS bounded `asyncio.Queue` (`maxsize=256`, drop-oldest on overflow). `websocket_terminal()` no longer manages the reader at all — it only does `attach_listener(queue)` after sending the scrollback replay and `detach_listener(queue)` in the `finally`. EOF (`os.read` returns `b""`) is handled inside `PTYSession._handle_eof`: idempotent, removes the reader, signals the listener with the existing `None` sentinel. The reader install/remove uses `loop.call_soon_threadsafe` against a module-level main-loop reference captured by `_start_background_tasks`, because the FastAPI session-creation endpoints (`POST /sessions`, `/sessions/restore`, `/sessions/{id}/clone`) and `kill_session_request` are defined as `def` (sync) and run in the thread pool — `asyncio.get_running_loop()` would raise there. `close()` blocks on a `threading.Event` until the threadsafe `remove_reader` actually executes, so the `os.close(fd)` that follows can never race with a pending selector callback. `recover_sessions()` was also moved from module scope into the `@app.on_event("startup")` handler.

### Changed

- **Semantics of idle-watcher Rules 2, 4, and 5 unified.** Previously, "user typing" (Rule 2) and "user watching" (Rule 5) only suppressed the current tick — stepping away for 15s would reopen the alert window. And the hash dedup (Rule 4) had a 30-min TTL ("if you didn't reply in 30 min, I'll alert again"). Now all three rules share the same semantics: **permanent ack per hash**. Typing (even without Enter) or seeing the terminal for one tick marks `notified=True` for that visual state; the system only re-alerts when the agent changes the display (= a new idle phase for real). Rule 4 lost its TTL — it's now eternal dedup keyed on `last_notified_hash`. Constant `NOTIFIED_HASH_TTL_SECONDS` removed. Explicit trade-off: if you saw it and the agent stays stuck on the same screen forever, you don't get a reminder — aligned with "if I saw, I know".

### Fixed

- **PTY/scrollback robustness after code review.** (1) `_ws_locks` no longer leaks — `_drop_session` and `kill_session_request` now pop the entry alongside the rest of the cleanup (previously accumulated 1 orphan `asyncio.Lock` per session created/killed, ~80B each). (2) `PTYSession.close()` now reaps the zombie immediately via `process.wait(timeout=0.1)` instead of waiting for `reap_dead_ptys` (30s) or `Popen` GC — relevant under high churn (creating/killing 1000 sessions in sequence could hit `RLIMIT_NPROC`). (3) Scrollback trim now aligns to the next "safe" boundary (`\n` or start of `\x1b`) within a 256-byte window instead of cutting exactly at `SCROLLBACK_BYTES` — avoids letting the replay start mid-escape-sequence (xterm.js would render `[31m` as a literal and pyte could confuse a partial OSC with a BEL terminator "eating" legitimate lines).

- **`visualViewport.resize` `useEffect` in `TerminalPane` now only mounts on touch devices.** Previously it fired on desktop too (zoom in/out, window resize), redundantly with the `ResizeObserver` that already covered those cases. Gated via `matchMedia('(pointer: coarse)')`. Benign (refit is idempotent) but it was triggering 6× refits/zoom on a mosaic with 6 panes.

- **Dead code `cwd_at_start` fallback removed from `restore_sessions_request`.** The frontend only sends `cwd` in the snapshot payload — the fallback was never reached. Also rewrote the `PTYSession` docstring to drop the archaeological tmux reference ("Substitui a sessão tmux…" → "Shell session bound to a PTY…").

- **Mobile touch scroll stopped spitting garbage (`65;1;1M65;1;1M…`) into the shell.** The touch handler in `frontend/src/components/TerminalPane.jsx` always sent SGR mouse sequences (`\x1b[<64;1;1M` / `\x1b[<65;1;1M`) to the PTY's stdin, regardless of what was running inside. In apps with mouse tracking enabled (vim, htop, less, Claude Code) that's correct. But on a bash prompt — where the shell doesn't interpret SGR mouse — those bytes leaked into the input buffer and the user saw fragments printed as literals (`65;1;1M65;1;1M…`) accumulating on the line. Fix: a new `sendScrollStep(direction)` helper reads `terminal.modes.mouseTrackingMode` before deciding; if `'none'`, calls `terminal.scrollLines(±1)` (local xterm.js scroll, doesn't touch stdin); otherwise, keeps the SGR path. Bonus: fixed a latent bug where `onTouchEnd` had inverted directions vs. `onTouchMove` — the residue flush at the end of a flick could "jump back" from where the user just scrolled.

- **Cursor stopped disappearing under the virtual keyboard on mobile.** `viewport.interactiveWidget = "resizes-content"` was already set in `app/layout.js` (shrinks the visible area when the keyboard pops up), but the terminal container kept its physical dimensions in the flex layout — `ResizeObserver` didn't fire, `fitAddon` didn't recompute, the cursor (which was near the bottom) ended up covered. Fix: a new `useEffect` in `TerminalPane` listens to `window.visualViewport.resize` with an 80ms debounce and triggers `fitAddon.fit()` + sends a fresh resize to the backend (SIGWINCH on the shell so TUIs reformat) + `terminal.scrollToBottom()`. Well-behaved TUI apps (vim/htop/Claude Code) reformat smoothly; misbehaved ones may flash once.

### Removed

- **`tmux` dependency dropped from the client.** Every session is now a shell spawned directly into its own PTY (`pty.openpty` + `subprocess.Popen` with `setsid`); the `client/src/tools/tmux.py` module (~363 LOC, 21 functions wrapping the CLI) was deleted and replaced with `client/src/tools/pty.py` containing the `PTYSession` class (~150 LOC). The `tmux` binary is no longer a prerequisite. No tmux server is started or queried during the client lifecycle. Explicit trade-off (decided with the user): sessions die when the client restarts — previously they survived because they lived inside the tmux daemon. The frontend already had (and still has) a client-side snapshot of the metadata (`getSessionsSnapshot` + auto-restore via `/sessions/restore` in `frontend/src/app/(main)/page.js`), so a client restart is followed by automatic re-opening of sessions with the same name/group/project/cwd — only the shell history is lost (expected).

- **`POST /api/sessions/sync` endpoint deleted** along with the `sync_sessions_request` handler. With no external session source (tmux is gone), `/sync` became a no-op. The "Sync" button in the sidebar and the `syncSessions` function in `services/api.js` were removed too.

- **"Copy tmux command" button removed from the Sidebar and the "New Terminal" modal**, along with their handlers (`handleCopyTmux`, `handleCopy` in the modal). Without tmux, copying `tmux attach-session -t term-N` has no useful destination. Corresponding i18n keys (`sidebar.copyTmux`, `sidebar.sync`, `modal.newTerminal.copyTooltip`, `toast.syncDone`, `toast.syncPartial`) removed from all 3 locales.

- **`errors.tmux_session_not_found` key removed from the client i18n catalog** in all 3 languages. The flow now uses `errors.session_not_found` (already existing) for both "ID not in the dict" and "PTY died" — consistent with the single-lifecycle of PTY mode.

### Added

- **`client/src/tools/pty.py`**: `PTYSession` class (encapsulates `process`, `master_fd`, scrollback `bytearray` with a 512 KB hard cap and head-trim) + `_pty_by_session` registry. API: `start`, `write`, `resize` (ioctl TIOCSWINSZ + SIGWINCH to the process group), `append_to_scrollback`, `get_scrollback_bytes`, `get_cwd` (via `tcgetpgrp(master_fd)` + `/proc/PID/cwd` — picks the foreground job, e.g. vim/Claude Code running inside the shell), `is_alive`, `kill` (`SIGHUP` to the pgroup so children die too), `close`. Registry helpers: `get_pty`, `register_pty`, `unregister_pty`, `list_pty_ids`.

- **`pyte==0.8.2` dependency** (Python terminal emulator). Used exclusively by the notification watcher in `_render_pane_via_pyte`: each watcher tick does `screen.reset()` + `stream.feed(scrollback_bytes)` in an isolated thread via `asyncio.to_thread` and returns `"\n".join(screen.display)`. The result is the canonical visual state of the PTY — no ANSI, no cursor, no redraw noise. Per-session `_pyte_screens` cache; rebuilt when geometry changes.

- **`reap_dead_ptys()` startup task** in `client/src/resources/terminal.py`. 30s loop that checks `pty.is_alive()` for every registered PTY, propagates close 1000 "Session ended" to the active WS (if any), and removes from both dict + registry. Covers the "shell exits via Ctrl-D while no one is attached" case — without this, zombie PTYs would linger in the registry until rediscovery on reconnect.

### Changed

- **Idle notification system drastically simplified** (~130 LOC removed in `client/src/resources/notifications.py`). Gone: the `_BORDER_ONLY_LINE_RE`/`_BORDER_DECORATED_LINE_RE`/`_BORDER_RUN_RE` regexes, the `_clean_snippet_line` helper, the `_normalize_content_for_hash` function, and the entire "Reconcile cached `notify_on_idle` + scope names with the tmux options" block (~25 LOC, ~4 subprocess calls × N sessions × 5s). All of that existed to compensate for tmux visual artifacts (resize redraws, decorative borders redrawn on every wrap, extra escape sequences) — there's nothing left to filter with a pure PTY rendered through pyte. The hash now operates directly on `screen.display`. The 5 anti-spam rules (Rule 1-5) stay intact; only the source of the hash changed.

- **`RESIZE_GRACE_SECONDS` reduced from 20s → 5s.** Without the cosmetic redraw jitter of tmux, the window only needs to cover the real reflow of TUIs (vim/htop/Claude Code reformatting columns after SIGWINCH).

- **`recover_sessions()` is now a no-op** with an explanatory log message. There's no more server-side persistence; the frontend is the source of truth on restart and fires `/sessions/restore` automatically.

- **`websocket_terminal()` refactored**: pulls `PTYSession` from the registry instead of spawning `tmux attach-session`; the scrollback replay uses `pty.get_scrollback_bytes()` (byte-perfect — colors/cursor/ANSI preserved) instead of `tmux capture-pane`; resize delegates to `pty.resize()`; the `finally` cleanup no longer kills the process (the PTY stays alive between connections — that's exactly the point). PTY EOF (shell exit) propagates close 1000 and triggers `_drop_session()`.

- **`clone_session_request()` cleaner**: previously spawned a new tmux session and sent `tmux send-keys cd <cwd>`; now creates `PTYSession(start_directory=cwd)` directly and the shell is born in the right directory. No race between `new-session` and the subsequent `cd`.

- **Endpoints `/sessions/{id}/send-text`, `/sessions/{id}/cwd`, `/sessions/{id}/capture` reimplemented inline**: direct write to `master_fd`, `/proc/PID/cwd` lookup via `PTYSession.get_cwd()`, render via pyte (instead of `tmux capture-pane`).

- **Documentation updated** (`CLAUDE.md`, `README.md`, `NOTIFICATIONS.md`, `CONTRIBUTING.md`, `docs/MULTI-SERVER.md`): architecture sections, prerequisites (no tmux), watcher description, constants table, gotchas. `NOTIFICATIONS.md` got an explicit note explaining how pyte made the entire border-regex scheme unnecessary. Translated `NOTIFICATIONS.md` and `CLAUDE.md` to English to align with the rest of the public-facing docs.

## [2.1.1] — 2026-04-25

### Added

- **`[y/N]` confirmation prompt before any CLI action that restarts the Pulse client.** Without tmux backing the sessions, restarting `pulse-client` kills every running PTY (vim, htop, ssh, Claude Code, etc.). The frontend auto-reopens terminals at the same name/group/cwd via the snapshot in `frontend/data/sessions.json` + `/sessions/restore`, but shell history and any unsaved foreground state are lost — too easy a footgun to leave silent. New helper `_confirm_client_restart` in `install/pulse.sh` (mirrors the existing `_tls_confirm` pattern: `[y/N]` default no, honors `-y`/`--yes`) is wired into:
  - `pulse stop` / `pulse restart` (only when the target is `client` or `all`; `pulse stop dashboard` and `pulse restart dashboard` stay silent — they don't touch PTYs)
  - `pulse upgrade`
  - `pulse config host --client …` / `pulse config ports --client …` (prompt fires before any `.env` write, so declining is a true no-op)
  - `pulse config tls on --client` / `pulse config tls off --client` (the existing TLS preview now mentions terminal termination explicitly; the existing `_tls_confirm` already covered the prompt)
  - `pulse uninstall` (the existing prompt now also lists running-terminal termination)
- Each command accepts `-y` / `--yes` to skip the prompt for scripting / CI. Internal cascades (e.g. `cmd_config_host` calling `cmd_restart client` after the user already confirmed once) pass `-y` through, so the user is never prompted twice for the same action.

### Changed

- **`pulse help` reorganized**: `[-y]` annotated on every command that restarts the client, plus a trailing note explaining why the prompts exist.
- **`pulse restart` on macOS no longer pipes through `cmd_stop` + `cmd_start`.** Inlined the launchctl unload/load loop so the prompt-and-flag plumbing doesn't need to thread through two helpers — same observable behavior, cleaner internals.

## [2.1.0] — 2026-04-25

### Changed

- **Per-tab UI state moved from `localStorage` + UUID coordination to `sessionStorage`.** Active project, active group per project, active flow per project, and the mosaic layout per `(project, group)` tuple are now persisted in `sessionStorage`, which the browser already isolates per tab. Opening 2, 3, 5 Pulse tabs in the same Chrome profile gives you that many independent working views — different active projects, groups, and mosaics — without the previous fragile UUID-claim choreography. F5 preserves state; closing the tab discards it (intentional). Switching projects no longer touches `frontend/data/projects.json`'s `active_project_id` — each tab owns its own pick locally. New keys (all in `sessionStorage`): `rt:activeProjectId`, `rt:view::<projectId>::group`, `rt:view::<projectId>::flow`, `rt:layout::<projectId>::<groupId|__none__>`.

### Removed

- **`frontend/src/lib/tabSession.js` deleted (~220 LOC).** With `sessionStorage` doing the isolation natively, the per-tab UUID generated via `crypto.randomUUID()`, the `rt:tab-profiles` registry in `localStorage`, the 10-tab LRU eviction, the `BroadcastChannel('rt:tab-coord')` claim/announce dance for race resolution, and the one-shot migration that backfilled state from `data/layouts.json` / `data/view-state.json` are all gone. The companion `GET /api/migrate-state` route and the now-unused `setActiveProject(projectId)` exported from `services/api.js` were removed alongside.

### Added

- **`frontend/src/lib/sessionState.js`**: thin helpers `ssRead`, `ssWrite`, `ssRemove`, `ssListKeysWithPrefix` mirroring `localState.js` but for `sessionStorage`.
- **`frontend/src/lib/legacyCleanup.js`**: `cleanupLegacyKeys()` runs once on the first load of `(main)/page.js` and wipes the dead keys from the previous architecture (`rt:tab::*` in `localStorage`, `rt:tab-uuid` in `sessionStorage`, `rt:tab-profiles`, `rt:migrated-from-server`). Idempotent — safe to keep around indefinitely.

## [2.0.2] — 2026-04-25

### Fixed

- **Idle notification title now always carries `{project} › {group} › {terminal}`, even on the default project or in "no group".** Previously, when `project_name` or `group_name` was falsy, the composer (`_compose_context` in `client/src/resources/notifications.py` and `handleEvent` in `frontend/src/providers/NotificationsProvider.jsx`) silently dropped that part — so a session in the default project under no group showed only the terminal name; one under the default project + a real group showed only `group › terminal`. The user couldn't tell at a glance which project the alert came from. Fix on three fronts: (1) `(main)/page.js` now passes `t('sidebar.noGroup')` and `t('projects.defaultName')` (new key, "Default" / "Padrão" / "Predeterminado") as the default labels in `handleCreate`, `handleAssignGroup`, and the auto-restore snapshot — so the backend stores a human-readable label even in the no-group / default-project cases, and the label moves with the terminal when it gets reassigned to another group; (2) `_compose_context` always emits three parts, falling back to static `"Default"` / `"No group"` for legacy sessions created before this contract (Telegram has no recipient locale, so the fallback stays in English); (3) `handleEvent` mirrors the same defense for browser notifications using the active locale. The user's prior preference (memory: "always show project name, including Default") is now structurally enforced rather than depending on the caller.

## [2.0.1] — 2026-04-25

### Fixed

- **Terminal stayed "alive but blank" after returning from background, requiring F5.** On mobile (Chrome Android tab freezing) and on desktop (suspend/resume, Wi-Fi flap), the WebSocket TCP could die silently — no FIN/RST delivered — and `WebSocket.readyState` kept reporting `OPEN`. The auto-reconnect path in `(main)/page.js` is gated by `hasDeadConnections()` (a `readyState` check), so it never fired and the user saw a frozen terminal until a full page reload. Two layers of fix: (1) **active probe on `visibilitychange`** — when the tab becomes visible, `probeAllTerminals(2000)` sends `{type:'ping'}` to every terminal WS and waits for `{type:'pong'}`; if any times out, `handleReconnect()` runs; (2) **passive heartbeat in `TerminalPane`** — every 30s with the tab visible, each pane pings its own WS and calls the new `onReconnect` prop directly if no pong arrives in 5s, recovering even when visibility never changed. Backend ships a one-line `elif msg_type == "ping": await websocket.send_json({"type":"pong"})` in `websocket_terminal()`. Idle-notification flow (separate `/ws/notifications` channel) was unaffected by either bug or fix.

- **"Capture output as text" button only returned the visible viewport (~30-50 lines) instead of the full history.** The endpoint `GET /sessions/{id}/capture?lines=N` accepted the `lines` parameter but discarded it: it called `_render_pane_via_pyte(pty)` which renders into a fixed-size `pyte.Screen(cols, rows)`. Pyte's `Screen` has no scrollback — feeding 512 KB of byte history into a 30-row screen overwrites every line as it goes, leaving only the current viewport in `screen.display`. The line-count presets (100/500/2k/10k) in the modal were therefore cosmetic. Fix: new `_render_full_history_via_pyte(pty, max_lines)` in `notifications.py` uses `pyte.HistoryScreen(cols, rows, history=12000, ratio=0.5)`, joins `screen.history.top` (chars from each `StaticDefaultDict` line) with `screen.display`, and truncates to the last `max_lines`. Restores parity with the previous `tmux capture-pane -p -S -<N>` behavior. The original `_render_pane_via_pyte` is kept untouched for the idle watcher (only needs the visible state).

## [1.14.1-pre] — 2026-04-24

### Fixed

- **Watcher de notificações idle agora é menos sensível a resize/redraw do tmux.** Cada sessão grava `last_resize_ts` quando recebe `resize`; se uma sessão já tinha alertado e o hash do pane muda dentro de 20s após resize, o watcher atualiza apenas o baseline visual e mantém `notified=True`, evitando reenvio quando celular/desktop mudam o tamanho do tmux e TUIs redesenham/wrapam a tela.
- **Hash usado para detectar "output novo" agora é normalizado antes da comparação.** Linhas puramente decorativas (`-----`, `────`, bordas de caixas) são removidas, labels cercados por bordas são de-decorados e espaços finais são ignorados. O snippet da notificação continua usando o conteúdo capturado limpo para exibição. Isso reduz falsos positivos causados por barras/caixas que aparecem em redraw de agentes e por diferenças pequenas de formatação pós-resize.

## [1.14.0] — 2026-04-24

### Added

- **Notificações idle agora têm modo local "Multi-monitor" para considerar um terminal visível mesmo quando a janela do Pulse não está focada.** A configuração fica em Settings → Notifications, persiste em `localStorage.rt:notify-presence-policy` e deixa claro o limite real do browser: ele não sabe para qual monitor o usuário está olhando, só expõe visibilidade da aba, foco da janela e viewport. O modo `Estrito` continua sendo o default e preserva a regra anterior (`aba visível + janela focada + atividade recente + pane na viewport`); o modo `Multi-monitor` usa `aba visível + pane na viewport`, cobrindo o fluxo comum de Pulse aberto num monitor e editor focado em outro.

### Changed

- **Heartbeat de "estou vendo" foi desacoplado do WebSocket exclusivo do terminal e agora usa o `/ws/notifications` multi-cliente como canal primário.** Antes, abrir a mesma sessão no celular fechava o WS do desktop com `4000 "Replaced by new connection"`; o desktop podia continuar visualmente aberto, mas parava de mandar `{type:'viewing'}` e o watcher voltava a notificar após o grace de 15s. Agora `TerminalPane` envia presença por `NotificationsProvider.sendViewing()` para o WS de notificações do servidor, que aceita múltiplos clientes autenticados, mantendo o WS do terminal como fallback. O backend valida tamanho do payload e `session_id` antes de tocar `last_viewing_ts`.

### Fixed

- **Alertas idle do browser são deduplicados entre abas do mesmo navegador.** O watcher inclui `event_id` em cada evento `idle`, derivado da sessão, hash visual e timestamp de última saída; o frontend grava esse id em memória + `localStorage` e propaga via `BroadcastChannel`, evitando que duas abas conectadas ao mesmo `/ws/notifications` disparem toast, som e notificação nativa em duplicidade. `renotify` das notificações nativas também foi desativado para não re-alertar quando o browser reaproveita a mesma tag.

## [1.13.7] — 2026-04-24

### Changed

- **Aviso de "isso pode quebrar servers cadastrados, atualize o `protocol` no Settings → Servidores depois" agora aparece em TODA execução de `pulse config tls on/off/regen` — independente do escopo (`--client`, `--dashboard`, ambos) e do estado anterior.** A v1.13.5 introduziu confirmação prévia mas só listava remotos quebrados quando o subcomando era `on --dashboard`; quem rodava `on --client` (ou qualquer `off`/`regen`) não era avisado de que o `protocol` registrado em `frontend/data/servers.json` ia ficar incoerente com o que o uvicorn passa a servir, e descobria sozinho depois — exatamente o "bug fantasma" que a confirmação tinha que evitar. Fix em `install/pulse.sh`: o helper `_tls_warn_remote_servers` (filtrava só remotos `host != local && protocol == http`) foi substituído por `_tls_print_breakage_warning` que **sempre** roda. Imprime um bloco `!! Heads-up: this will likely break some servers until you fix them up.` com receita explícita ("flip protocol → https para servers agora servindo TLS, ou → http para servers agora em plano; pra remotos: SSH lá, `pulse config tls on`, depois atualiza o protocol localmente") e em seguida lista **todos** os servers cadastrados em `servers.json` no formato `name  protocol://host:port` para o user cruzar visualmente. Se `servers.json` não existe (ex: dashboard não instalado), imprime nota dim "(servers.json not found — check the dashboard once it's up)" em vez de pular silencioso. Chamado de `on`, `off` E `regen` antes do prompt `Continue? [y/N]` — três pontos no código, mesmo helper. Motivação dos cenários cobertos: (1) `tls on --client` quebra a request `http://server:porta` que o dashboard ainda faz contra o uvicorn que agora exige TLS; (2) `tls off --client` quebra `https://server:porta` que o dashboard tenta contra uvicorn que voltou a HTTP plano; (3) `tls on --dashboard` aciona mixed-content para qualquer server `http` na lista; (4) `tls off --dashboard` é o cenário menos crítico mas ainda pode quebrar se o user tinha flipado entries pra `https` quando ligou TLS antes; (5) `regen` invalida exception de cert em todo device — não muda protocol mas todos param até re-aceitar.

## [1.13.6] — 2026-04-24

### Added

- **Documentação do gotcha "abrir todos editores no remoto agrega numa única window do VS Code" + workaround `window.openFoldersInNewWindow: on`.** Nova seção `## Opening files in your local editor` em `docs/MULTI-SERVER.md` com 3 partes: (a) explica o comportamento dual do botão "open editor" (local chama `/open-editor` → `code <cwd>` direto, remoto gera `vscode://vscode-remote/ssh-remote+<host>/<cwd>` e delega ao Remote-SSH do VS Code do browser); (b) **SSH alias for remote** documenta o campo `sshAlias` da v1.13.0 com exemplo de bloco `Host` no `~/.ssh/config` (necessário quando a conexão SSH usa IdentityFile/User/Port custom — VS Code Remote-SSH só pega isso de um `Host` block, não da URL); (c) **Group "open all" on a remote — VS Code single-instance gotcha** explica que ao clicar o botão de abrir todos num grupo remoto com N sessões, por padrão o VS Code **substitui** a folder na window existente em vez de abrir N windows — limitação do URL handler `vscode-remote://` que não tem query param público pra forçar nova window. Workaround: configurar `"window.openFoldersInNewWindow": "on"` no User Settings do VS Code do user (`Cmd/Ctrl+,` → buscar `openFoldersInNewWindow` → `on`). Local "open all" não tem esse problema porque a v1.13.1 já força `code -n <path>` no spawn (flag `-n` reconhecida pela whitelist Code-family). Entry no ToC, link cross-ref no `README.md` (linha 140) apontando pra essa seção via `docs/MULTI-SERVER.md#opening-files-in-your-local-editor`.

### Changed

- **Toast preventivo do "abrir todos editores do grupo" remoto agora orienta o user sobre o workaround do VS Code em vez de só explicar o stagger.** Mensagem da chave `groupSelector.openAllRemoteStaggerHint` reescrita nos 3 locales (pt-BR/en/es): incluiu menção a `window.openFoldersInNewWindow: on` direto no toast — o user vê a dica enquanto as N janelas vão abrindo escalonadas. `duration` do toast subiu para `Math.max(urls.length * 1500, 6000)` (mínimo 6s) pra garantir tempo de leitura do texto mais longo. Comentário no código (`frontend/src/components/GroupSelector.jsx` `openAllInGroup`) reescrito pra documentar com clareza que o stagger ataca **C1** (popup blocker / user gesture), mas **NÃO resolve C2** (VS Code Remote single-instance dedup é absoluto, não temporal — testes empíricos com 500ms na v1.13.3 e 1500ms na v1.13.4 ambos mostraram dedup quando a config padrão do VS Code está ativa). Aponta o leitor pra `docs/MULTI-SERVER.md` e pro workaround. Sem mudança de comportamento ou novas chaves i18n — só ajuste de copy + duration.

## [1.13.5] — 2026-04-24

### Changed

- **`pulse config tls on|off` agora exige flag explícita (`--client` e/ou `--dashboard`) e mostra preview + pede confirmação antes de aplicar mudanças.** A versão original em v1.13.2 assumia "ambos" quando o usuário não passava nenhuma flag — comportamento inspirado em `pulse config host` / `ports`, mas perigoso aqui porque `tls` toca em mais coisas: gera cert, escreve em ambos os `.env`, **flipa `AUTH_COOKIE_SECURE`** no dashboard, e **restarta dois serviços**. Bater Enter sem prestar atenção podia derrubar a sessão atual e deixar o usuário sem saber por quê. Fix em `install/pulse.sh`: scope flag virou **obrigatório** para `on` e `off` — `pulse config tls on` (sem flag) morre com `die "specify --client and/or --dashboard"`. Validação acontece antes do preview pra mensagem ser direta. Validação adicional pra escopo inválido: `--client` quando `client.env` não existe (ou `--dashboard` sem `frontend.env`) também morre antes de mexer em qualquer arquivo, em vez do silent skip da v1.13.2 que deixava o user adivinhando se algo aconteceu. `show` continua sem flag (read-only, sempre lista ambos); `regen` ignora flag (cert é compartilhado).

- **Confirmação interativa antes de qualquer mudança no estado.** A v1.13.2 tinha o helper `_tls_warn_remote_servers` rodando **depois** do `update_env_key` — o aviso de "esses N servers remotos vão quebrar" aparecia quando o `.env` já estava modificado e o restart estava prestes a rolar (jeito errado: o aviso virava lamento, não escolha). Agora, `on`/`off`/`regen` mostram um bloco "About to ...:" listando exatamente o que vai mudar (cert path, env keys, services to restart, lista de remotes em mixed-content para o caso `--dashboard`) e param em `Continue? [y/N]`. Decline (`N`, Enter, qualquer coisa que não seja `y/Y/yes/YES`) imprime "aborted — no changes made" e retorna `0` sem ter tocado em nada — a chamada é totalmente atômica do ponto de vista de side-effects. Nova flag `-y|--yes` pula o prompt para uso em scripts/automação (mesmo padrão de `pulse config rotate-jwt`). Helper privado `_tls_confirm` extraído para deduplicar entre os 3 subcomandos. `regen` confirma **sempre** (até com `-y` o aviso aparece na preview, mas `-y` ainda pula o prompt — coerência com os outros) porque invalida exceções de cert em todo device que já confiou no antigo.

### Added

- **Documentação completa de TLS auto-assinado em `docs/SELF-HOSTING.md`.** A v1.13.2 introduziu `pulse config tls` mas só documentou no `CHANGELOG.md` e no `--help` da própria CLI. Nova seção `## HTTPS without a reverse proxy (self-signed)` em `docs/SELF-HOSTING.md` explica: motivação (browser secure context, notificações, clipboard, PWA quando acessado de outro device da LAN), como ligar (`pulse config tls on --client --dashboard`), o gotcha de mixed-content para servers remotos cadastrados como HTTP (com receita de SSH+`pulse config tls on` lá+update no Settings), comandos auxiliares (`off`/`show`/`regen`), e caveats (modo dev sem TLS, Mobile Safari mais estrito, openssl ≥ 1.1.1). Comandos novos adicionados ao bloco do `## The pulse CLI` (linhas 31-34: `tls show`/`on`/`off`/`regen`). Tabela de Config files agora lista `TLS_*` envs como opcionais e o par `tls/{cert,key}.pem` como arquivos criados sob demanda. ToC atualizado com a entrada nova. Menção curta de uma linha adicionada em `README.md` na seção `### Polish` (parágrafo "Optional self-signed HTTPS") com link direto para a seção do SELF-HOSTING.md — README continua sendo pitch, todo o detalhe vive na doc operacional.

## [1.13.4] — 2026-04-24

### Changed

- **Delay do stagger das aberturas remotas em "abrir todos editores do grupo" revertido de 500ms para 1500ms.** A v1.13.3 baixou o `setTimeout(window.open, i * 500)` em `frontend/src/components/GroupSelector.jsx` `openAllInGroup` (caminho remoto) tentando reduzir a latência percebida — mas o intervalo curto não dá tempo do VS Code Remote completar o handshake SSH da 1ª URL antes da 2ª chegar, e o single-instance lock do URL handler `vscode://vscode-remote/...` agrega: a 2ª URL **sobrescreve** a folder na window que ainda estava abrindo a 1ª (o usuário vê "abriu 1, depois sobreescreveu e abriu o segundo em cima do primeiro"). Voltado para 1500ms — valor empiricamente seguro identificado no review do v1.13.2 e validado naquela release. Trade-off aceito: 3 sessões = 4.5s de espera total, mas cada folder abre em sua própria janela como esperado. Toast `groupSelector.openAllRemoteStaggerHint` ("Aberturas remotas escalonadas a cada 1.5s pra evitar dedup do VS Code Remote.") e `duration: urls.length * 1500` atualizados nos 3 locales (pt-BR/en/es). Comentário no código agora documenta o experimento falho da v1.13.3 pra evitar que alguém tente baixar de novo sem entender o trade-off.

## [1.13.3] — 2026-04-24

### Changed

- **Delay do stagger das aberturas remotas em "abrir todos editores do grupo" reduzido de 1500ms para 500ms.** A v1.13.2 calibrou o `setTimeout(window.open, i * 1500)` em `frontend/src/components/GroupSelector.jsx` `openAllInGroup` no caminho remoto (3 sessões = 4.5s de espera total) com base na suposição de que o VS Code Remote precisava de ~1-2s pra processar o setup SSH+folder antes da próxima URL chegar — empiricamente o intervalo curto de 500ms já é suficiente pro VS Code tratar cada URL como nova janela e dispensa a espera longa que dava sensação de "travou". 3 sessões agora abrem em ~1.5s total. Toast `groupSelector.openAllRemoteStaggerHint` ("Aberturas remotas escalonadas a cada 0.5s pra evitar dedup do VS Code Remote.") e `duration: urls.length * 500` atualizados nos 3 locales (pt-BR/en/es). Comentário no código marca `500ms` como valor de teste — pode subir se algum cenário (rede mais lenta ao server, VS Code com extensões pesadas) começar a mostrar dedup novamente.

## [1.13.2] — 2026-04-24

### Added

- **Suporte opcional a HTTPS auto-assinado no dashboard e no client, ativado via novo subcomando `pulse config tls`.** Motivação: a Notification API do browser exige *secure context* — `https://` ou `localhost`. Hoje o Pulse rodava `http://127.0.0.1:3000` (que conta como secure por ser loopback) e tudo funcionava no desktop, mas a partir do momento que o user acessava o dashboard de um celular/tablet/outro PC da mesma LAN via `http://192.168.x.y:3000`, deixava de ser localhost, deixava de ser secure context, `Notification.requestPermission()` retornava `denied` e nada notificava (mesmo problema afeta clipboard API, service workers PWA, etc — tudo que a spec de browsers exige secure context). Solução implementada em camadas: **(a) Geração de cert** — novo helper `pulse_generate_tls_cert` em `install/lib/common.sh` (também replicado dentro de `install/pulse.sh` em `_tls_ensure_cert` para evitar dependency runtime) usa `openssl req -x509 -newkey rsa:2048 -nodes -days 825` (825 dias é o cap que o Safari aceita pra self-signed desde 2020) com SAN cobrindo `DNS:localhost,DNS:$(hostname),IP:127.0.0.1,IP:::1` e EKU `serverAuth`; cert vai pra `$CONFIG_ROOT/tls/cert.pem` (chmod 644), key pra `$CONFIG_ROOT/tls/key.pem` (chmod 600), dir 700. Geração é **on-demand** (install fresh não toca em cert) — a primeira execução de `pulse config tls on` cria o par; chamadas subsequentes são idempotentes (não regenera se já existe), preservando cert exceptions já aceitos em browsers/devices. **(b) Subcomando** — `cmd_config_tls` em `install/pulse.sh` aceita `on|off|show|regen` + flags `--client` / `--dashboard` espelhando o padrão de `pulse config host` e `pulse config ports` (sem flag = ambos, decisão de UX para cobrir o caso 95%). `on` faz `update_env_key` em `client.env` e/ou `frontend.env` setando `TLS_ENABLED=true` + `TLS_CERT_PATH`/`TLS_KEY_PATH`; quando ativa o dashboard, **também** flipa `AUTH_COOKIE_SECURE=true` automaticamente (o cookie `rt:auth` com flag `Secure` é necessário pra browser não descartá-lo sob HTTPS — replicar a regra que `cmd_config_secure` já encapsulava). `off` reverte: `TLS_ENABLED=false` + `AUTH_COOKIE_SECURE=false` no dashboard. Ambos restartam apenas os serviços no escopo afetado (`cmd_restart client` / `cmd_restart dashboard`). `show` imprime o cert path com `(exists)`/`(missing)`, expiração via `openssl x509 -noout -enddate`, subject CN, SAN completo, e o estado de `TLS_ENABLED` em cada um dos dois `.env`. `regen` deleta cert+key e gera de novo (avisa que browsers terão que aceitar o novo cert). **(c) Aviso de mixed content** — quando o user roda `pulse config tls on --dashboard`, o helper `_tls_warn_remote_servers` lê `frontend/data/servers.json` via `python3` heredoc inline e lista entries cujo `host` ∉ `{localhost, 127.0.0.1, ::1, $(hostname)}` e estão com `protocol: http`. Esses são **remotes** (outras instâncias pulse-client em servidores diferentes, registradas no Settings) que vão quebrar mixed-content quando o browser tentar `ws://outro-host` vindo do `https://dashboard` — política de segurança do browser, não contornável. O CLI **não modifica o JSON automaticamente** (mexer no `protocol → https` faria browser tentar TLS handshake contra um uvicorn remoto que ainda tá em HTTP, falhando do mesmo jeito); imprime instruções explícitas: "SSH na máquina remota, `pulse config tls on` lá, depois flipa o protocol no Settings → Servers". Decisão de UX após brainstorming: prefere "avisar e deixar o user resolver" sobre "bloquear ativação até resolver" (que travaria casos legítimos de quem precisa reconfigurar o remoto AGORA via dashboard) e sobre "ignorar silenciosamente" (que esconderia o bug fantasma). Sem `python3` ou sem `servers.json`, helper retorna silencioso (não-bloqueante). **(d) cmd_open scheme-aware** — `cmd_open` (que abre o dashboard no browser do user) agora lê `TLS_ENABLED` do `frontend.env` e usa `https://` quando true, evitando o caso besta do user ter ligado TLS mas o `pulse open` continuar tentando `http://` e o browser dar warning genérico de "site doesn't respond properly".

- **Custom server Next.js (`frontend/server.js`) substitui `next start` em produção; `client/start.sh` aprende a passar `--ssl-keyfile/--ssl-certfile` ao uvicorn quando `TLS_ENABLED=true`.** Next.js 15 não tem flag pra terminar TLS no `next start` (só `next dev --experimental-https` que é dev-only e usa mkcert) — pra dashboard servir HTTPS precisa wrapping no `https.createServer` do Node. `frontend/server.js` (~60 linhas, runtime puro Node sem build) lê `WEB_HOST`/`WEB_PORT`/`TLS_ENABLED`/`TLS_CERT_PATH`/`TLS_KEY_PATH` do `process.env`, com fallback de cert pra `$PULSE_CONFIG_ROOT/tls/{cert,key}.pem` (env var injetada pelo systemd unit / launchd plist). Quando `TLS_ENABLED=true`, faz `fs.readFileSync` do par e `https.createServer({cert,key}, handler)`; caso contrário `http.createServer(handler)` — comportamento HTTP idêntico a `next start` 1:1. Em ambos os casos o request handler vem de `next({dev:false}).getRequestHandler()`, preservando todo o request handling do App Router (API routes, middleware, static assets). Falha de leitura de cert quando `TLS_ENABLED=true` é **fail-loud** (`process.exit(1)` com mensagem orientando `pulse config tls on`) — silenciosamente cair pra HTTP nesse caso desfaria o ponto inteiro de optar por TLS (cookie Secure flag e notification permission ambos dependem de secure context real, não de "tentamos mas deu errado"). Modo `dev` do frontend (`npx next dev`) ficou **intencionalmente sem TLS** — Next dev tem seu próprio HMR server e wrapping ele em HTTPS quebra hot reload; quem quiser testar HTTPS local roda `--prod`. No client (`client/start.sh`), o último bloco de `exec uvicorn` ganhou branch `if [ "${TLS_ENABLED:-false}" = "true" ]; then ... --ssl-keyfile "$TLS_KEY_PATH" --ssl-certfile "$TLS_CERT_PATH"; else ...; fi` com guards `pulse_die` se `TLS_ENABLED=true` mas paths estão vazios ou ilegíveis (orienta o user pra `pulse config tls on`).

### Changed

- **Service units (systemd + launchd) reescritos pra acomodar o branching TLS sem perder o entrypoint único.** `install/systemd/pulse.service.tmpl`: `ExecStart` trocou `exec npx next start -H "$WEB_HOST" -p "$WEB_PORT"` por `exec node server.js` — server.js cuida do branch HTTP/HTTPS lendo `TLS_ENABLED` do `EnvironmentFile=`, então o unit não precisa saber nada sobre TLS state. Adicionado `Environment=PULSE_CONFIG_ROOT=%h/.config/pulse` para cobrir o fallback de cert paths quando `TLS_CERT_PATH`/`TLS_KEY_PATH` estão vazios em `frontend.env` (caso edge: user editou `.env` à mão). Detecção nvm/volta/fnm preservada idêntica. `install/systemd/pulse-client.service.tmpl`: `ExecStart` virou wrapper sh `set -a; . "$HOME/.config/pulse/client.env"; set +a; if [ "${TLS_ENABLED:-false}" = "true" ]; then exec uvicorn ... --ssl-keyfile ... --ssl-certfile ...; else exec uvicorn ...; fi` — systemd `${VAR}` expansion não suporta argumentos condicionais, sh wrapper sim. `EnvironmentFile=` continua presente (idempotente: o sh wrapper re-source o arquivo). `install/launchd/sh.pulse.dashboard.plist.tmpl`: idem dashboard.service — string final do `ProgramArguments` troca `exec npx next start` por `exec node server.js`; `EnvironmentVariables` ganha `PULSE_CONFIG_ROOT`. `install/launchd/sh.pulse.client.plist.tmpl`: idem pulse-client.service — string final do `ProgramArguments` ganha o mesmo if/else TLS.

- **`seed_client_env()` e `seed_frontend_env()` no `install/install.sh` ganharam `TLS_ENABLED=false` + `TLS_CERT_PATH=` + `TLS_KEY_PATH=` no heredoc do fresh install; upgrade path ganhou backfill via novo helper `_backfill_env_key`.** Fresh install já escreve as 3 envs com defaults vazios (TLS off, paths vazios — o CLI preenche quando o user roda `pulse config tls on`). Upgrade path (quando `client.env`/`frontend.env` já existe e tem `API_KEY`/`AUTH_PASSWORD` populado) preserva o env existente como antes, **mas** roda `_backfill_env_key "$env_file" TLS_ENABLED false` (e analógos pra `TLS_CERT_PATH`/`TLS_KEY_PATH`) — só faz append se a chave não estiver presente, deixa intacto se já existir. Isso garante que upgrades de < 1.13.2 → 1.13.2 fiquem com o schema novo sem quebrar configs custom (paths de cert externos manualmente setados, por exemplo). `client/.env.example` e `frontend/.env.example` também ganharam as 3 chaves com comentários explicando o fluxo `pulse config tls on`.

### Fixed

- **"Abrir todos editores do grupo" no caminho remoto agora abre os N editores em vez de só o primeiro (Chrome/Firefox); Safari ganha mensagem clara quando popup blocker bloqueia.** A v1.13.1 só corrigiu o caminho local — o remoto continuou abrindo só o primeiro VS Code mesmo com `Promise.allSettled` + burst sync. Code review forense identificou duas causas independentes que o "burst sync" não atacava: (a) **C2 — VS Code Remote tem single-instance lock próprio no URL handler `vscode://vscode-remote/...`**: 2 URLs disparadas em rajada são processadas pela mesma instância já rodando e só a última pasta vira a folder ativa (não há `?newWindow=true` público pro remote URL scheme, ao contrário do CLI `code -n`); (b) **C1 — `window.open` consome transient activation por chamada (não por task)**: a partir do 2º `window.open` no mesmo tick após `await`, popup blocker começa a atuar, hard no Safari (bloqueia tudo) e relax no Chrome/Firefox (popup-chain heuristic) — então "burst sync" funcionava por acidente em browsers permissivos. Fix em `frontend/src/components/GroupSelector.jsx` `openAllInGroup` (caminho remoto): troca o `for (const url of urls) window.open(url, '_blank')` (burst) por `Promise.all(urls.map((url, i) => new Promise(resolve => setTimeout(() => { const popup = window.open(url, '_blank'); resolve(popup === null ? 'blocked' : 'sent'); }, i * 1500))))` — stagger de 1500ms entre cada abertura. O delay ataca **C2** dando tempo do VS Code Remote completar o setup SSH+folder antes da próxima URL chegar (empiricamente VS Code trata a próxima como "abrir em nova janela" depois de ~1-2s); para **C1**, o stagger reduz a janela em que o popup blocker percebe rajada, mas não elimina o problema no Safari (gesture já era ao tempo do 1º setTimeout). Toast informativo "Aberturas remotas escalonadas a cada 1.5s" (`groupSelector.openAllRemoteStaggerHint`) aparece preventivamente quando há 2+ remotos, com `duration: urls.length * 1500` pra cobrir todo o stagger e evitar sensação de "travou".

- **Toast "Abrindo VS Code em N sessões" não mente mais quando o browser bloqueia popups.** Antes, `done += 1` era incrementado assim que `window.open()` retornava, sem checar se o popup foi de fato criado — o toast `groupSelector.openAllDone` ("Abrindo VS Code em 3 sessões") aparecia mesmo quando o browser tinha bloqueado 2 das 3 aberturas, dando ao usuário a impressão errada de sucesso (pior tipo de bug — quebra trust). Fix: `window.open(url, '_blank')` retornando `null` (sinal padrão de popup bloqueado pelo browser) agora é contabilizado num contador separado `blocked`, e o toast de feedback final tem prioridade nova: se `blocked > 0`, dispara `showError` com a chave nova `groupSelector.openAllBlocked` ("X de Y aberturas bloqueadas pelo browser. Permita popups pra este site nas configurações.") — explicita o que aconteceu e como o usuário corrige. Caso `blocked === 0` mas `failed > 0` (cwd fetch failure ou helper retornando null), mantém `openAllPartial`. Caso tudo OK, `openAllDone` continua. Detecção via `popup === null` é confiável pra **bloqueio**, mas não consegue detectar dedup do VS Code Remote (a popup é criada e fecha imediatamente após handoff pro OS; nada sinaliza pro JS se o VS Code de fato abriu nova janela ou agregou na existente) — limitação intrínseca de protocol handlers em browsers.

## [1.13.1] — 2026-04-24

### Fixed

- **"Abrir todos editores do grupo" agora abre os N editores em vez de só o primeiro — tanto no fluxo local (endpoint `/open-editor` spawnando `code <path>`) quanto no remoto (URL handler `vscode://vscode-remote/...`).** Antes, com 2+ terminais de paths distintos num grupo, clicar no ícone de "abrir todos" do chip do `GroupSelector` resultava em só o primeiro terminal abrir — dois bugs independentes atuando em cada caminho: (a) no local, `subprocess.Popen([binary, cwd], ...)` em `client/src/routes/terminal.py:386` era chamado em sequência pelo handler `openAllInGroup` (`for (const session of targets) { await openEditor(session.id) }`), mas o VS Code / Cursor / Codium tem single-instance lock — a 2ª chamada de `code <path>` é interceptada via IPC pela instância já rodando e silenciosamente *agregada* na janela existente (adicionando pasta ao workspace) ou simplesmente descartada, dependendo da config `window.openFoldersInNewWindow` do usuário; (b) no remoto, o handler fazia `await getSessionCwd(session.id)` antes de cada `window.open(url, '_blank')`, e qualquer `await` entre cliques consome o "user gesture" do browser — popup blockers (Safari o mais estrito, bloqueia tudo após o 1º await; Chrome/Firefox com blocker default bloqueiam a 2ª+ abertura) silenciosamente eliminam as aberturas subsequentes. Fix em duas camadas: 
  - **Backend**: `client/src/routes/terminal.py` `open_editor` ganhou query param `new_window: bool = Query(False)`; quando `true` **e** o binário resolvido é da família Code (whitelist `_NEW_WINDOW_SAFE_NAMES` = `code` / `cursor` / `codium` / `code-insiders` / `windsurf` / `code-oss` / `vscodium`, basename sem extensão), o spawn vira `[binary, "-n", cwd]` em vez de `[binary, cwd]`. A flag `-n` é reconhecida por todos esses como "nova janela", burlando o single-instance lock. Se o usuário tem um `editor_override` custom fora da whitelist (ex: `nvim`, `emacs` — onde `-n` significa outra coisa, tipo "no swapfile" no nvim), o guard `_supports_new_window_flag(binary)` ignora o param e cai no spawn antigo sem `-n` — prefere que o bug de "só abre o primeiro" continue nesses editores exóticos a quebrá-los totalmente. Comportamento default (click individual) preservado — spawn continua sem `-n`, o editor lida como o usuário tem configurado.
  - **Frontend API**: `frontend/src/services/api.js` `openEditor(compositeId, { newWindow = false } = {})` aceita o novo opcional e propaga como `?new_window=true`. Call individuais (Sidebar, PaneToolbar, PaneActionsFab, GroupSelector single) não mudam — continuam chamando sem opções → backend recebe `new_window=False`.
  - **Frontend GroupSelector**: `openAllInGroup` reescrito pra separar targets em locais e remotos, e atacar cada bug diretamente. Locais: `Promise.all(localSessions.map(s => openEditor(s.id, { newWindow: true })))` em paralelo — cada spawn tem `-n` e abre sua própria janela. Remotos: pré-fetch de *todos* os cwds via `Promise.allSettled(remoteEntries.map(({ session }) => getSessionCwd(session.id)))` em paralelo (um único `await` antes do burst), depois loop sync puro `for (const url of urls) window.open(url, '_blank')` sem nenhum `await` entre aberturas — minimiza a janela de tempo em que o popup blocker pode intervir. Chrome e Firefox com blocker default passam a abrir todos; Safari ainda pode limitar múltiplas aberturas quando o usuário não permitiu popups pra este site (limitação intrínseca do browser, não contornável sem instalar algo do lado do browser). Toast final consolidado agrega sucesso/falha de ambos os caminhos num único feedback (`openAllDone` / `openAllPartial`).

## [1.13.0] — 2026-04-24

### Added

- **Campo "Alias SSH" opcional em Configurações → Servidores, usado pelo botão "Abrir editor remoto" pra casar com blocos `Host` do `~/.ssh/config`.** Antes, o botão remoto gerava a URL `vscode://vscode-remote/ssh-remote+<server.host><cwd>` usando o IP literal do servidor (ex: `ssh-remote+10.153.54.226/...`). O VS Code Remote-SSH tratava esse target como hostname bruto e só tentava as chaves default (`~/.ssh/id_rsa`, `id_ed25519`, etc). Em setups onde a chave mora num caminho custom (`ssh -i /path/chave`) ou User/Port diferem do default, o usuário tinha um bloco no `~/.ssh/config` apenas sob um alias (ex: `Host google-dev → HostName 10.153.54.226 → User datascience → IdentityFile ~/.ssh/datascience`) — mas a URL com IP **não casava com o alias**, o VS Code não achava User/IdentityFile e devolvia *"Could not establish connection ... permission denied (publickey)"*. Fix: `frontend/src/components/settings/ServersTab.jsx` ganhou um campo de texto "Alias SSH (opcional)" full-width abaixo do API Key, com placeholder `ex: google-dev` e hint explicando que ele é lido do `~/.ssh/config` do usuário. Novo helper puro `buildRemoteEditorUrl(server, cwd)` em `frontend/src/utils/host.js` monta a URL usando `server.sshAlias?.trim() || server.host` como target; codifica o cwd por segmento via `split('/').map(encodeURIComponent).join('/')` pra preservar `/` e escapar espaços/hash/query caso apareçam. Os 3 callsites (`TerminalMosaic.jsx`, `Sidebar.jsx`, `GroupSelector.jsx`) deixaram a URL inline antiga e passaram a chamar o helper; se o helper retornar `null` (raro — `server` sem host nem alias), o handler faz `throw new Error(t('errors.remote_editor_no_target'))` em vez de abrir URL quebrada. Schema do endpoint PUT `/api/servers` (`frontend/src/app/api/servers/route.js` função `normalize()`) ganhou `sshAlias: String(s.sshAlias ?? '').trim()` — servers existentes em `data/servers.json` sem o campo sobrevivem: normalização devolve `''` e o fallback pro `server.host` mantém o comportamento anterior. 3 chaves i18n novas por locale (pt-BR/en/es): `settings.servers.sshAliasLabel`, `settings.servers.sshAliasPlaceholder`, `settings.servers.sshAliasHint`; mais `errors.remote_editor_no_target` pra cobrir o guard do helper. Bonus do encoding: paths com espaço (raros em Linux, comuns se algum dia o Pulse suportar hosts Windows/macOS no futuro) passam a não quebrar a URL.

### Fixed

- **Botão "Abrir editor" detecta corretamente se o server é a mesma máquina do browser mesmo quando os hostnames diferem, usando probe de `localhost:<porta>/api/sessions`.** Antes, `frontend/src/utils/host.js` exportava `isLocalHost()` que só comparava `window.location.hostname` contra `{localhost, 127.0.0.1, ::1}`; os 3 callsites dos botões (`TerminalMosaic.jsx:138`, `Sidebar.jsx:74`, `GroupSelector.jsx:133`) guardavam o resultado num state global do componente, aplicando-o igual a todas as sessões. Resultado no cenário comum "browser em `localhost:3000` + server cadastrado com IP LAN `192.168.0.130`": o botão sempre gerava `vscode://vscode-remote/ssh-remote+192.168.0.130/...` — que tentava `ssh` de volta pra própria máquina — quando o caminho correto era chamar `/open-editor` do server (mesma máquina) e spawnar `code <cwd>` localmente. Comparar string bruta também não serve no cenário inverso: notebook do usuário em `192.168.0.130:3000` acessando o server `192.168.0.130` do desktop da casa — os hostnames batem, mas são duas máquinas físicas diferentes. A única detecção confiável sem instalar nada no lado do browser é **provar que a *mesma instância* do server responde pelo loopback do browser**: se o notebook não tem um pulse-client rodando, `http://localhost:<porta>/api/sessions` falha com connection refused; se tem, responde 401 (api-key errada) ou 200 (api-key bate → mesmo server). Fix em duas camadas: (1) `frontend/src/utils/host.js` `isServerLocalToBrowser(server)` ficou apenas com a heurística pura ambos-loopback (removida a comparação bruta de string que dava falso positivo) — passa a ser usada só como shortcut; (2) `frontend/src/providers/ServersProvider.jsx` ganhou um effect que, pra cada server na lista, faz `fetch(${scheme}://localhost:${port}/api/sessions, { headers: { X-API-Key: apiKey }, signal: AbortSignal.timeout(1500) })` — resposta `ok=true` significa "mesma instância, mesma máquina", mantido num `cacheState.localReachable: Map<serverId, boolean>` module-level espelhado num state pra disparar re-render. Nova função exportada `isServerLocal(server)` combina: shortcut de loopback + consulta ao cache do probe. Os 3 componentes trocaram `isServerLocalToBrowser` por `isServerLocal` e passaram a consumir `useServers()` (destrcuturando `localReachable` só pra dependência de re-render). Probe re-avalia quando a lista de servers muda (novo/editado/removido → effect re-roda) e no focus do tab (via `useRefetchOnFocus` que já chamava `load()`). Falhas de probe (timeout, CORS, connection refused, 401) são silenciosas — o server fica `false` no cache e cai no caminho remoto. CORS já estava permissivo (`allow_origins=["*"]`, `allow_headers=["*"]` em `client/src/service.py:25-31`), então o fetch funciona sem config adicional. Trade-off: primeiro render pós-hydration mostra ícone "remoto" até o probe completar (~1500ms worst case) pra servers não-loopback — pequeno jitter aceitável. Imports de `isLocalHost` removidos dos 3 componentes (a função permanece exportada em `host.js` pra `NotificationsProvider`).

## [1.12.0] — 2026-04-24

### Added

- **Speed-dial FAB no canto superior direito de cada terminal pane substitui o botão flutuante "Capture" e centraliza 4 ações por-sessão num arco que se abre.** Antes, o canto sup. dir. de cada pane tinha um único botão "Capture" (flutuante, retangular, com label "Copy"). Conforme novas ações por-sessão foram surgindo (Prompts no header do pane via v1.11.0; Notify e Keyboard na sidebar), elas iam sendo distribuídas em locais diferentes — Prompts virava ícone no `PaneToolbar` (header do `MosaicWindow`), Notify e Keyboard ficavam ocultos numa linha de ações por sessão na sidebar que só abria em hover. Resultado: descobribilidade ruim (Notify/Keyboard quase invisíveis) e header do pane crescendo sem fim. Novo componente `frontend/src/components/PaneActionsFab.jsx` (~180 linhas, controlled, props-driven) renderiza uma engrenagem 36px circular no mesmo lugar do antigo Capture. Click → engrenagem gira 45° e vira X, e 4 botões 32px se abrem em arco indo de 9h até 6h em torno do gear (raio 64px, ângulos 180°/210°/240°/270°, posições calculadas via `x = R*cos(rad)`, `y = -R*sin(rad)` em coordenadas CSS). Animação 100% CSS: stagger de 40ms entre botões (0/40/80/120ms), transição 180ms `cubic-bezier(0.34, 1.56, 0.64, 1)` (overshoot leve pra dar bounce), `transform: translate(...) scale(...)` + `opacity` no eixo aberto/fechado, fechamento usa stagger reverso. Os 4 botões: **Capture** (`FileText`, abre `TerminalCaptureModal` igual antes), **Prompts** (`MessageSquareText`, abre `PromptSelectorModal` igual antes), **Notify** (`Bell`/`BellOff` refletindo `session.notify_on_idle`, toggle + browser permission flow replicado verbatim de `Sidebar.jsx:324-348` — fluxo idêntico de `requestBrowserPermission`/toast granted/toast denied/toast insecureContext), **Keyboard** (`Keyboard`, abre `ComposeModal` igual antes; vira `Loader` durante request em vôo). Tooltip à esquerda de cada botão (custom span com fade `group-hover`, tokens `hsl(var(--foreground)/0.85)` + `hsl(var(--background))` pra legibilidade em qualquer tema). Single-FAB-open invariante via state `openFabSessionId` (string|null) hoisted ao `TerminalMosaic` parent — abrir uma FAB num pane fecha automaticamente qualquer outra que esteja aberta. ESC fecha, click fora fecha (listener de `mousedown` no `document` quando aberta, com check de containment via `containerRef.contains(e.target)` — é o `contains` que protege gear/satélites de re-fechar a FAB, não o `stopPropagation` dos handlers; comentário inline no source documenta). Acessibilidade: cada botão tem `title` + `aria-label`, `disabled` propaga corretamente, ESC + Tab funcionam por ser `<button>` real. Todos os tooltips reusam chaves i18n existentes (`toolbar.capture`, `toolbar.prompts`, `sidebar.notifyOn`, `sidebar.notifyOff`, `sidebar.compose`); única chave nova adicionada: `terminal.actions.menu` (tooltip do gear) nas 3 línguas. FAB renderizada nos dois caminhos de `TerminalMosaic.jsx` — desktop (dentro do `renderTile` do `<Mosaic>`) e mobile (dentro do `mobileOpenIds.map`, só sobre o pane ativo).

### Changed

- **Botão "Capture" flutuante removido — substituído pela engrenagem da FAB nova.** O retângulo `📄 Capture` que aparecia desde a v1.10.4 saiu; mesma posição (`top-2 right-4`) é ocupada agora pelo gear circular. Ação continua disponível como primeiro botão dentro do arco. Helper local `CaptureFloatingButton` deletado de `TerminalMosaic.jsx`; chave i18n órfã `toolbar.captureLabel` ("Copy" / "Copiar") removida dos 3 locales (era o label visível só do antigo retângulo, gear não tem label).

- **Botão "Prompts" removido do header do pane (PaneToolbar) — vive só na FAB agora.** O ícone `💬` que a v1.11.0 colocou na toolbar do `MosaicWindow` (entre split-vertical e open-editor) saiu. Header do pane ficou mais limpo (split-h, split-v, editor, maximize, close). Ação migrada pra dentro da FAB (segundo botão do arco). `MessageSquareText` removido do import de `lucide-react` em `TerminalMosaic.jsx`.

- **Botão "Keyboard" (compose) removido da linha per-session da Sidebar desktop — vive na FAB agora.** A linha de ações por-sessão que aparece em hover sobre cada item da sidebar perdeu o ícone `⌨` (com seu spinner durante request). Notify (`Bell`/`BellOff`) ficou — é a única ação per-session que continua duplicada (sidebar + FAB), pra preservar acesso rápido sem precisar focar um pane. Mobile bottom bar (`Sidebar.jsx:676-687`, no branch colapsado do mobile) **manteve** o botão Keyboard pra continuar acessível ao polegar sem ter que abrir a FAB do pane ativo — coexistência intencional.

### Fixed

- **"Open VS Code" / "Open editor" do FAB voltou a funcionar quando `pulse-client.service` subiu antes do login gráfico (boot com linger habilitado).** Antes, em VMs/desktops onde o serviço sob `systemctl --user` arrancava no boot via lingering — ANTES do user logar no desktop e da PAM popular o user manager com `DISPLAY`/`XAUTHORITY`/`DBUS_SESSION_BUS_ADDRESS`/etc — o `ExecStartPre`'s `systemctl --user import-environment` rodava num user manager vazio, e o serviço Python herdava env sem variáveis gráficas. Quando o user logava depois e clicava "Open editor" pelo Pulse, o `subprocess.Popen` subia o VS Code com fallback `DISPLAY=:0` (errado em multi-seat / sem X11) ou simplesmente sem DBUS/XAUTHORITY (VS Code abria janela invisível ou silenciosamente falhava). Workaround: reiniciar o `pulse-client.service` depois de logar no desktop pra re-disparar o `import-environment`. Fix em `client/src/routes/terminal.py`: novo helper `_import_from_user_manager(env)` (linhas ~272-300) chama `systemctl --user show-environment` no momento do click e re-importa as 7 chaves gráficas (`DISPLAY`, `WAYLAND_DISPLAY`, `XAUTHORITY`, `DBUS_SESSION_BUS_ADDRESS`, `XDG_RUNTIME_DIR`, `XDG_SESSION_TYPE`, `XDG_CURRENT_DESKTOP`) **só** se a chave ainda não estiver em `env` — chaves já presentes (vindas do override do settings ou do env do próprio Python) continuam tendo prioridade. `open_editor` chama o helper antes do bloco de detecção manual de `DISPLAY`/`WAYLAND_DISPLAY` que já existia (resolução de socket de Wayland + fallback X11), então user manager populado vence o fallback hardcoded. `subprocess.run` do helper usa `timeout=2.0` + `check=False` (não-bloqueante: se `systemctl` não responde rápido ou retorna erro, segue silencioso pro fallback antigo) e tolera `FileNotFoundError` (sistemas sem systemd, ex.: WSL1 / containers). Sem regressão em sessões SSH puras (sem desktop) — `systemctl --user show-environment` retorna sem as chaves gráficas, helper não faz nada, o fallback X11 `:0` continua sendo tentado. stdout/stderr do `Popen` do editor seguem em `DEVNULL` (mantido após investigação de debug).

## [1.11.1] — 2026-04-24

### Fixed

- **Scroll do mouse pra cima durante stream de TUI apps (Claude Code, htop, vim, codex, gemini-cli) não vira mais "teleprompter".** Sintoma: durante streaming de resposta do Claude Code num pane, rolar um pouco pra cima com o wheel deixava o topo do viewport congelado num offset antigo, enquanto uma faixa de baixo virava FIFO — linhas novas entrando por baixo, antigas saindo por cima — à medida que o app continuava repintando a região ao redor do cursor (cursor positioning absoluto + clear line, padrão de renderização de apps TUI). Não era reconexão WebSocket nem re-replay do `capture-pane`: o scrollback que "congelava" acima era o snapshot do momento do scroll, e a região rolando embaixo era o buffer crescendo com o cursor continuando a escrever onde estava. Comportamento esperado em xterm.js default (preserva scroll do user), mas visualmente confuso porque terminais desktop (iTerm2, gnome-terminal, Terminal.app) tradicionalmente auto-cancelam o scroll ao chegar novo output. Fix em `frontend/src/components/TerminalPane.jsx`: o `ws.onmessage` chama `terminal.scrollToBottom()` via callback do `terminal.write()` a cada chunk de tipo `output` — cancela o scroll manual do user em toda escrita de TUI ou shell. Trade-off aceito (opção A discutida com user): não é possível rolar pra cima enquanto há output chegando — cada chunk pula de volta pro fim. Pra ler scrollback antigo, esperar o stream acabar.

## [1.11.0] — 2026-04-24

### Added

- **Botão de atalho "Prompts salvos" no toolbar de cada terminal (desktop).** Antes, para enviar um prompt salvo a um terminal, era preciso abrir a página `/prompts` e escolher a sessão destino num sub-modal — quebra o fluxo quando já existe um pane ativo e quer-se só despejar rapidamente um prompt nele. Novo botão `MessageSquareText` (lucide-react) no `PaneToolbar` em `frontend/src/components/TerminalMosaic.jsx`, posicionado entre split-vertical e open-editor. Click abre um modal seletor (`frontend/src/components/prompts/PromptSelectorModal.jsx`) com lista filtrável de prompts (global + projeto ativo) e **2 botões por card**: **Send** (`sendEnter=false`, insere texto sem Enter para o user revisar) e **Send + Enter** (`sendEnter=true`, insere e executa). Ambos chamam `sendTextToSession(sessionId, prompt.body, sendEnter)` contra o pane contextual — o `sessionId` vem naturalmente do pane onde o user clicou, o toolbar já é contextual por-pane. Click no corpo do card (fora dos dois botões) intencionalmente **não** dispara envio — só os botões explícitos, para evitar disparo acidental durante busca/navegação. Modal inclui **CRUD completo**: botão "Novo" abre editor inline, ícones edit/delete em cada card, com sub-modais aninhados sem colisão (o padrão `fixed inset-0 z-50` portal-like do projeto empilha naturalmente). Escape e backdrop click fecham o modal (bloqueados durante request em voo). Os botões Send/Send+Enter ganham spinner + disabled state durante o `sendTextToSession` (CLAUDE.md global: feedback obrigatório em API call, pro user saber que algo aconteceu). Desktop-only automático — o `PaneToolbar` inteiro não monta no branch mobile (após `if (isMobile) return …` em `TerminalMosaic.jsx`), sem checagem adicional necessária. **Para evitar duplicar código com a página `/prompts`**, extraída uma nova abstração `PromptsManager` (`frontend/src/components/prompts/PromptsManager.jsx`) que encapsula listing + search + seções global/project + sub-modais de editor/delete/send-to-session e aceita prop `mode: 'page' | 'selector'` mais `onSendPrompt(prompt, sendEnter)` (usado só em `'selector'`). Em `'page'` mantém o sub-modal "send to which session" atual com seus 2 botões por sessão; em `'selector'` a escolha de sessão é implícita (vem do pane) e os 2 botões ficam direto em cada card. Página `/prompts` (`frontend/src/app/(main)/prompts/page.js`) refatorada para shell mínimo que monta `<PromptsManager mode="page" sessions={sessions} currentProjectId={activeProjectId} />` — visual e comportamento preservados idênticos. Adicionadas 3 chaves i18n nas 3 línguas (pt-BR/en/es): `toolbar.prompts` (tooltip do botão), `prompts.selectorTitle` (título do modal seletor), `prompts.sentToTerminal` (toast de sucesso).

### Changed

- **Modal "New Terminal" ficou mais largo, com layout responsivo, e perdeu o flash de erro vermelho durante digitação de path.** Container do modal passou de `max-w-md` (448px) para `max-w-3xl` (768px) em desktop — inalterado em mobile, onde o viewport limita. Em viewport ≥ md (768px+), os campos "Nome" e "Grupo" agora dividem a mesma linha via `grid grid-cols-1 md:grid-cols-2`, liberando espaço vertical para a listagem de pastas. A listagem de pastas do `CwdBrowser` cresceu de `max-h-48` (192px) para `max-h-80` (320px) — ~10-11 entries visíveis de uma vez sem scroll. Removida a barra vermelha "Path not found" (`setError` + div `bg-destructive/10`): enquanto o user digita um path parcial (`/h`, `/ho`, `/hom`), o browser mantém a listagem da pasta válida atual visível em vez de piscar com erro transitório + layout shift; no `.catch` do `navigate()` só `unreachable`/`timeout` continuam sendo sinalizados via `onServerOffline` (tooltip no botão "Browse"), todo o resto é silenciado. Para eliminar o jiggle vertical que `loading=true`/`loading=false` causava a cada keystroke (listagem sumia → spinner 40px tall → listagem voltava), a listagem agora fica **sempre visível** durante navegação debounced; o spinner virou um `Loader size=12` inline pequeninho ao lado do breadcrumb do path. `loading` inicial é `true` (antes era `false`) para evitar flash de "empty" no primeiro render antes da request de home resolver — a mensagem de "empty" só aparece quando `loading=false && entries.length === 0`. Lista de "recent paths" segue capped em 100 pelo backend (`RECENT_CWDS_MAX` em `recent-cwds/route.js`) com `max-h-40 overflow-y-auto` — seguro mesmo com histórico cheio.

- **Apagar todo o texto do campo "Start path" agora navega para `/` (root) em vez de voltar para `$HOME`.** Antes, campo vazio era interpretado como "default" no client Python (`list_directory_request` em `client/src/resources/fs.py` faz `os.path.expanduser("~")` quando `path is None or not path.strip()`) — então limpar o input via backspace voltava pra home, contra-intuitivo pra quem queria ir explicitamente pra raiz. Fix no `CwdBrowser` de `NewTerminalModal.jsx`: `target = initialPath || '/'` força empty/falsy virar `"/"` literal antes da request, backend lista a raiz. Adicionalmente, quando `initialPath===''` mas `target==='/'`, o effect chama `onPick('/')` imediatamente — sincroniza o input de volta pra `"/"`, evitando divergência visual (input vazio + browser mostrando root). Efeito colateral intencional: abrir o modal sem um caminho recente selecionado agora mostra `"/"` em vez de `$HOME` — consistência com "campo vazio = raiz"; navegar pra home fica a um clique `cd ~` via browser ou digitando `/home/<user>`.

### Fixed

- **Novos terminais criados pelo Pulse agora carregam o `.bashrc` / `.zshrc` do usuário automaticamente.** Antes, `tmux new-session` era invocado sem argumento de shell após o nome da sessão, então o tmux caía no `default-shell` resolvido a partir de `$SHELL` — e, mesmo quando `$SHELL` estava presente (nem sempre, sob `PassEnvironment` do systemd), o shell iniciado não disparava o loading do `.bashrc` (guarda `[[ $- != *i* ]] && return` ou shell iniciado como login lendo só `.bash_profile`/`.profile`). Resultado: `NVM`, hooks do conda, PATH custom, aliases — nada disponível no terminal novo, user tinha que rodar `source ~/.bashrc` manualmente em cada sessão. Fix em `client/src/tools/tmux.py` no `create_session()`: anexa `$SHELL -l` (fallback `/bin/bash -l`) ao comando `tmux new-session`. `bash -l` lê `.bash_profile` → `.profile` que no Ubuntu/Debian default faz source do `.bashrc`; `zsh -l` lê `.zprofile` + `.zshrc` (cobre macOS, zsh default desde Catalina); `fish -l` também suportado. Fallback `/bin/bash` cobre o caso raro em que `$SHELL` está genuinamente vazio (systemd bare env).

- **Modal "New Terminal": clicar num "caminho recente" agora também sincroniza o browser de pastas para começar daquele caminho.** Antes, click num recent só preenchia o input de texto (`cwd` no `NewTerminalModal`), mas o `CwdBrowser` (componente interno de navegação) continuava com seu `path` local apontando para home/raiz default — clicar numa pasta ali navegava relativa ao home, ignorando o recent recém-escolhido. Fluxo "seleciono um recent e continuo navegando a partir dele" ficava quebrado: o user precisava digitar o path na mão ou navegar do zero até chegar lá. Fix em `frontend/src/components/NewTerminalModal.jsx`: `CwdBrowser` passa a aceitar prop `initialPath` e ganha um `useEffect([initialPath])` que chama `navigate(initialPath)` quando o parent muda o valor — omite `path`/`navigate` das deps de propósito, para sincronizar só no fluxo parent→child sem entrar em loop com a navegação do próprio user (guarda `initialPath !== path` blinda o caso edge de digitação manual batendo com `path` corrente). Parent (`NewTerminalModal`) agora passa `initialPath={cwd}` ao browser, e o `onClick` dos items de "recent paths" faz `{ setCwd(p); setBrowserOpen(true); }` para garantir que o painel do browser esteja aberto e já mostrando o novo path. Preservado: effect `[serverId]` que reseta browser na troca de servidor continua intacto (parent seta `cwd=''` na troca, `initialPath=''` é falsy, a sync effect skipa, o effect de `[serverId]` faz seu trabalho de `navigate(null)`); digitar o path manualmente continua funcionando — o effect de sync é debounced em 250ms para evitar spam de API e `path_not_found` transitórios a cada tecla (se o user digita `/media/file` um caractere por vez, só uma request é feita, depois que o input estabiliza); submit flow intocado.

## [1.10.7] — 2026-04-24

### Fixed

- **`install.sh` ainda mostrava "Add ~/.local/bin to your PATH manually" depois da v1.10.6 quando o `.bashrc` já tinha qualquer menção a `.local/bin` — incluindo a linha que o próprio `uv` installer adiciona.** Caso real: em VM nova, o `ensure_uv()` (linha 128 do `install.sh`) faz `curl -LsSf https://astral.sh/uv/install.sh | sh`, e o instalador do uv adiciona `. "$HOME/.local/bin/env"` ao `~/.bashrc` (e `~/.zshrc`). Esse `env` script do uv NÃO faz `export PATH="$HOME/.local/bin:..."` — ele só seta vars relacionadas ao uv. Mas o nosso check final fazia `grep -q '\.local/bin' ~/.bashrc` (greedy demais), encontrava a linha do uv e concluía erroneamente "tudo certo, PATH já configurado", pulava o append e mostrava "Add manually". Resultado: `pulse: command not found` mesmo em sessão nova até o usuário editar o `.bashrc` à mão. Fix em `install/install.sh`: (a) **grep refinado** — agora usa `grep -qE '^[[:space:]]*export[[:space:]]+PATH=.*\.local/bin'` que só conta como "já configurado" se houver um `export PATH=...` real apontando para `~/.local/bin` (ignora `. file/.local/bin/env`, comentários, aliases, qualquer outra menção); (b) **mensagem útil quando o rc já tem export real mas a sessão atual não pegou** — em vez de pular silencioso, mostra `! ~/.local/bin already in ~/.bashrc but not in your current shell. Run: source ~/.bashrc`, cobre casos de re-install ou de o rc ter sido atualizado por outro tool depois do login atual; (c) **detecção do shell de login mais robusta** — fallback para `getent passwd "$USER" | cut -d: -f7` quando `$SHELL` está vazio (sudo, cron, alguns ambientes não-interactive); (d) **teste de gravabilidade no arquivo** — antes era em `dirname "$rc_file"`, agora `[ -w "$rc_file" ] || ([ ! -e "$rc_file" ] && [ -w "$(dirname …) ])`, mais correto se o `~` é gravável mas o `.bashrc` específico não é (raro, mas determinístico).

## [1.10.6] — 2026-04-24

### Fixed

- **`pulse: command not found` logo após instalar em conta nova (caso real: VM GCP Compute Engine com usuário sem `~/.local/bin` pré-existente).** O `install.sh` copia o launcher para `~/.local/bin/pulse` (via `BIN_ROOT="$HOME/.local/bin"`) e tem uma rotina no fim que detecta se esse diretório está no `$PATH` do user e, se não estiver, adiciona `export PATH=...` ao `~/.bashrc`/`~/.zshrc` + mostra `✓ Added ~/.local/bin to PATH in ~/.bashrc. Restart your shell or run: source ~/.bashrc`. Acontece que o `ensure_uv()` no início do mesmo script faz `PATH="$HOME/.local/bin:$PATH"; export PATH` para conseguir invocar `uv` durante a instalação — isso **contamina o `$PATH` da própria sessão do install**. Quando a checagem final rodava (`case ":$PATH:" in *":$BIN_ROOT:"*) return 0 ;; esac`), via `~/.local/bin` no PATH (do próprio script), retornava silenciosamente, **e nem a linha era escrita no rc nem a mensagem aparecia**. Resultado: o usuário via "Pulse 1.10.x installed" + lista de comandos, abria `pulse status` e levava `bash: pulse: command not found`, sem nenhuma pista do que houve. No Ubuntu o `~/.profile` adiciona `~/.local/bin` ao PATH automaticamente, mas só se o diretório existir **no momento do login** — em VM nova onde o diretório foi criado agora pelo install, a sessão SSH atual já passou. Fix em `install/install.sh`: snapshot `PULSE_ORIGINAL_PATH="$PATH"` no topo de `main()` (antes de qualquer função que mexe no PATH — `ensure_uv`/`ensure_node`/etc), e a checagem final passou a usar `case ":${PULSE_ORIGINAL_PATH:-$PATH}:"` em vez do `$PATH` ao vivo. Agora em VMs novas o `.bashrc` é atualizado e o usuário vê a mensagem `✓ Added ~/.local/bin to PATH...`. Em sistemas onde `~/.local/bin` já estava configurado legitimamente (via `~/.profile`/`~/.bashrc` antigos), o snapshot vê e o check segue retornando cedo sem alterar nada — sem regressão.

## [1.10.5] — 2026-04-24

### Fixed

- **Installer agora se recusa a continuar quando a porta escolhida (client ou dashboard) já está em uso.** Antes, em VMs onde algo já escutava em `:3000` ou `:7845` (caso real: GCP Compute Engine com Jupyter/Notebook na 3000), o `install.sh` aceitava o default sem checar — a instalação completava com sucesso, os systemd services entravam em crashloop com `Error: listen EADDRINUSE: address already in use 0.0.0.0:3000`, `pulse status` mostrava "failed", e o usuário não tinha pista nenhuma do que aconteceu sem abrir `pulse logs dashboard`. Fix em `install/install.sh`: novos helpers `_port_in_use` (tenta `ss` → `lsof` → `fuser` → `python3` socket bind, com warn-and-skip se nada estiver disponível — não bloqueia install por falta de tool) e `_pids_on_port` (best-effort para mostrar PID + comando do processo conflitante via `ps -o pid=,user=,etime=,args=`). O `prompt_port_loop` ganhou 3º arg `host` e passou a chamar `_port_in_use` após `is_valid_port` — se a porta estiver ocupada, mostra o processo e re-pergunta (não oferece kill, diferente do `pulse_check_port` em `install/lib/common.sh:124` que é runtime e mata; aqui é install e seria hostil matar processo alheio sem contexto). Validação final non-interactive (`prompt_network`) ganhou `_assert_port_free` com retry 5×250ms — necessário para o upgrade path, onde `stop_services_if_running` para os próprios units mas o socket pode demorar um instante para liberar (TIME_WAIT, shutdown lento do uvicorn/Next). Se conflito persistir, `die` com mensagem que mostra o PID, sugere parar o processo OU re-rodar com `PULSE_CLIENT_PORT=<other>`/`PULSE_DASHBOARD_PORT=<other>`, e lembra que os arquivos já foram instalados (re-rodar é seguro, install é idempotente). Cobre ambos os caminhos: prompt interativo (re-loop) e env-var/non-interactive (`die`).

## [1.10.4] — 2026-04-24

### Added

- **Browser de pastas no modal "New Terminal" + histórico de paths recentes por server.** O `NewTerminalModal` (`frontend/src/components/NewTerminalModal.jsx`) ganhou um campo "Start path" + botão de pasta que abre um painel inline (`<CwdBrowser>`) navegando o FS do server selecionado. Listagem só de pastas, ordenada alfabeticamente case-insensitive, cap de 1000 itens com flag `truncated` para diretórios anormalmente grandes (ex: `node_modules`). Toggle "Show hidden" controla se pastas começando com `.` aparecem (default off, persiste em `localStorage.rt:browserShowHidden`). Click numa pasta navega para dentro dela; setinha "↑" sobe para o parent. Default da primeira abertura é `$HOME` do user do client. Endpoint novo no client Python (`client/src/routes/fs.py` + `client/src/resources/fs.py`): `GET /api/fs/list?path=<absolute>` sob `Depends(require_api_key)`, valida path absoluto + ausência de null bytes, canonicaliza via `realpath`, distingue 4 erros (`fs_path_invalid`/`_not_found`/`_denied`/`_not_directory`) i18n nas 3 línguas. Cada terminal criado com `cwd` não-nulo registra o path em `data/recent-cwds.json` via nova rota local `app/api/recent-cwds/route.js` (GET + POST + DELETE), persistida pelo `storage.js` — segue o driver ativo (file/mongo/s3). Schema `{servers: {<id>: {paths: [{path, last_used_at}]}}}`, cap configurável `RECENT_CWDS_MAX = 100` (alterar = editar arquivo + rebuild), eviction LRU pelo `last_used_at` quando estoura. Sort do dropdown via `Intl.Collator('en', {sensitivity:'base', numeric:true})` para ordem alfabética estável independente de locale do host. Lista "Recent paths" no modal renderiza inline (não dropdown) abaixo do campo "Start path", scrollável até `max-h-40`, com cada item clicável preenchendo o campo + botão `X` à direita para remover daquele server (delete instantâneo, otimista, com refetch on failure). Modal expandido para `max-w-md` para acomodar paths longos. Recents segmentados por server: trocar o select do server reseta o campo, fecha o browser e recarrega a lista de recentes daquele server específico. Hook em `PUT /api/servers` limpa entries órfãs em `recent-cwds.json` quando um server é removido (defesa contra acúmulo). Server offline ao abrir o browser: ícone de pasta fica desabilitado com tooltip `serverOffline`, campo continua editável e recents continuam funcionando (são locais). Race-protection via `reqIdRef` no `<CwdBrowser>` evita responses stale sobrescreverem state quando o user clica rápido entre pastas. Adicionado a `DATA_REL_PATHS` (`frontend/src/lib/storage.js`) para entrar no sync local↔cloud. i18n completo em pt-BR/en/es sob `modal.newTerminal.{cwdLabel,cwdPlaceholder,browseTooltip,recentLabel,recentEmpty,recentRemoveTooltip,browser.*}` e `errors.fs_path_*`.

## [1.10.3] — 2026-04-23

### Changed

- **Login agora dispara um check fresco de versão (bypassa cache server-side de 1h).** Antes da v1.10.3, depois de publicar uma release, o usuário precisava esperar até ~1h para o modal aparecer mesmo após logoff/login — o cache em memória do `/api/update-status` (TTL 1h, projetado para ficar bem abaixo do orçamento de 60 req/h não-autenticadas do GitHub) servia o `latestVersion` antigo independente da transição `/login → /` no browser. Agora a rota aceita `?force=1` (`frontend/src/app/api/update-status/route.js`) que ignora o cache positivo e o cache negativo de 5min — mas continua respeitando o `rateLimitResetAt` (forçar quando o GitHub disse "espera" só compraria outro 403). O `UpdateNotifierProvider` (`frontend/src/providers/UpdateNotifierProvider.jsx`) ganhou um `useRef` que rastreia o `pathname` anterior; quando detecta a transição `/login → outra rota`, passa `force: true` para o `runUpdateCheck()`. Demais ticks (o `setInterval` de 1h e qualquer foco/mudança de servers) seguem **sem** force, para preservar o orçamento. O dismiss de 24h via `localStorage.rt:updateDismiss` continua sendo respeitado mesmo com force — ele controla "deve abrir o modal?", separado de "qual a `latestVersion`?". Cobre os fluxos: primeiro login do dia, logoff/login manual, e relogin após token expirar (24h).

## [1.10.2] — 2026-04-23

### Fixed

- **Botão flutuante de Notes (FAB) e o `NotesManager` não aparecem mais na tela de `/login`.** Antes apareciam pré-autenticação porque o `InnerLayout.js` (root layout, monta tudo em todas as rotas) renderizava `<NotesFab />` e `<NotesManager />` incondicionalmente — visualmente confuso (FAB em cima do form de senha) e sem utilidade nenhuma já que o `NotesProvider` não tem dados pra exibir antes do user logar. Fix: novo sub-componente local `NotesUI` no próprio `InnerLayout.js` consulta `usePathname()` e devolve `null` quando `pathname === '/login'`. O `NotesProvider` continua montado em todas as rotas (custo zero, mantém a árvore de providers consistente entre transições) — apenas a UI flutuante é gateada. Mesma estratégia já usada implicitamente pelo `UpdateNotifierProvider` (que early-returna em `/login` no seu `useEffect`).

## [1.10.1] — 2026-04-23

### Fixed

- **Versão reportada pelo client congelava em upgrade — modal de update introduzido em v1.10.0 ficava preso para sempre.** O `seed_client_env()` do installer (`install/install.sh`) preserva o `client.env` durante upgrades para não perder `API_KEY`/`API_HOST`/`API_PORT` do usuário, mas até v1.10.0 a linha `VERSION=` também era mantida intacta — então o serviço Python continuava lendo a versão pré-upgrade mesmo depois de `pulse upgrade`. Resultado: o modal de "nova versão disponível" continuava abrindo logo após o usuário atualizar, porque `/api/version` reportava a versão antiga (ex: `1.4.14 → 1.10.0` mesmo já estando em 1.10.0). Fix em duas camadas: **(a)** `client/src/envs/load.py` agora prioriza `$INSTALL_ROOT/VERSION` (o arquivo que o installer já reescrevia a cada upgrade como single source of truth para `pulse version` / `pulse check-updates`) sobre o `.env` — o serviço Python passa a ler a versão fresca diretamente do arquivo que o installer garantidamente atualiza. Em dev (sem install) o arquivo não existe e o load cai no fallback do `.env` como antes. **(b)** `install/install.sh` foi ajustado para também reescrever a linha `VERSION=` no `client.env` preservado durante upgrade — defesa em profundidade que mantém o `client.env` honesto e evita confundir quem inspeciona o arquivo manualmente (`grep VERSION client.env`).

### Added

- **Versão visível na página de login.** Rodapé do `/login` agora mostra `Pulse v{version}` lendo do novo endpoint público `GET /api/local-version` (`frontend/src/app/api/local-version/route.js`), que por sua vez resolve o single source of truth `$INSTALL_ROOT/VERSION` (via `PULSE_FRONTEND_ROOT/..` — mesma convenção de `jsonStore.js`/`storage.js` para sobreviver a worker spawn no systemd). Cache de 1min em memória para múltiplos refreshes baratos. Em dev sem install, o arquivo não existe → o footer simplesmente não renderiza. Adicionado a `PUBLIC_API` no middleware (sem auth, mesmo padrão de `/api/auth/*`). Útil para diagnosticar rapidamente "qual versão estou rodando aqui?" antes de logar — especialmente quando o usuário gerencia vários hosts.

### Changed

- **Hardening do `UpdateNotifierProvider` e do cache do `/api/update-status` apontados em code review.** Quatro pequenos fixes defensivos: (1) `update-status/route.js` ganhou in-flight dedup (`let inFlight`) — N requests concorrentes em cold cache agora compartilham 1 fetch ao GitHub em vez de cada uma disparar a sua, fechando uma janela do orçamento de 60 req/h; (2) o `useEffect` do provider deps mudou de referência do array `servers` (que troca em todo focus refetch do `ServersProvider`) para um hash dos ids ordenados — evita disparar `runUpdateCheck` desnecessariamente em cada visibility-change e poupar `N` HTTPs por server cadastrado; (3) `readDismiss`/`writeDismiss` ganharam guard `typeof window === 'undefined'` para tolerar SSR caso alguém venha a importar essas helpers em outro lugar; (4) `UpdateAvailableModal` agora fecha com `Escape` (event listener no `document`, cleanup no unmount). E `_read_install_version()` em `client/src/envs/load.py` agora loga `WARNING` em `OSError` em vez de engolir silenciosamente — torna visível um possível problema de permissão no `$INSTALL_ROOT/VERSION`.

## [1.10.0] — 2026-04-23

### Added

- **Notificação proativa de nova versão no dashboard.** O frontend agora alerta automaticamente quando há release nova do Pulse no GitHub, sem o usuário precisar rodar `pulse check-updates` à mão. A cada 1h o `UpdateNotifierProvider` (`frontend/src/providers/UpdateNotifierProvider.jsx`) consulta a rota Next.js server-side `GET /api/update-status` (cache em memória de 1h, exponential backoff de 3 tentativas com delays `[0, 1s, 2s]`, respeito ao `X-RateLimit-Reset` do GitHub e cache negativo de 5min para não martelar após falha) que devolve a `tag_name` da última release de `kevinzezel/pulse`. Em paralelo, via `Promise.allSettled`, busca a versão atual de cada server cadastrado pelo novo endpoint autenticado `GET /api/version` no client Python (`client/src/routes/version.py`). Se algum server estiver desatualizado, abre um modal único listando-os (server `current → latest`) com o comando `pulse upgrade` em destaque + botão de copiar, link para as release notes do GitHub e botão "Remind me in 24h". Servers offline somem da lista; servers em versão pré-feature (404 no endpoint) aparecem como "Unknown — old version" para forçar a primeira atualização. O dismiss persiste em `localStorage.rt:updateDismiss` por 24h, mas é invalidado imediatamente se sair release ainda mais nova durante o silêncio. i18n completo em pt-BR/en/es sob a chave `update.modal.*`.
- **Três guias técnicos novos em `docs/`:** `SELF-HOSTING.md` (CLI `pulse`, arquivos de config em `~/.config/pulse/`, behind a reverse proxy, networking defaults pra Linux/macOS/WSL2), `STORAGE.md` (drivers Local/MongoDB/S3 detalhados, setup R2/MinIO/B2/GCS/Spaces, sync local↔cloud, behavior notes sobre hot-reload, fail-fast, optimistic locks e legacy migration de v1.5.x) e `MULTI-SERVER.md` (install client-only/dashboard-only, registro no dashboard, arquitetura típica). Pasta `docs/superpowers/` intacta. Conteúdo extraído do README pra deixar o pitch enxuto sem perder profundidade.

### Changed

- **README reescrito pra atrair contribuidores.** De 416 → 205 linhas. Tagline pain-point first ("Stop babysitting your AI coding agents") substitui o "Your AI coding cockpit"; blockquote "Who is this for?" logo após o pitch elimina ambiguidade em 5s; features reordenadas por força (idle alerts → mobile → multi-server → multi-projeto → context → jump-to-code → polish); as seções de self-hosting, storage e multi-server (~200 linhas) viraram links pra `docs/`. Quatro diferenciais técnicos do código que estavam silenciados no texto antigo agora aparecem na vitrine: as 5 regras anti-spam do `notification_watcher` com link pro `NOTIFICATIONS.md`, o ED3 fix do `xterm.js` que mantém o scrollback do Claude Code vivo após `/compact` (workaround pra anthropics/claude-code#16310 — diferencial real e raro), o recover-on-restart com snapshot de sessões pós-reboot e o capture-as-text per-pane que funciona até em apps alt-screen. Pin de versão atualizado de `v1.3.2` (desatualizado) pra `v1.9.2`. Themes/i18n e cloud sync agrupados em "Polish" com link pro `docs/STORAGE.md` em vez do bloco gigante anterior.

## [1.9.2] — 2026-04-23

### Fixed

- **Notification idle heartbeat agora sobrevive a movimentação de terminal entre grupos.** Antes, mover um terminal de um grupo (ex: "Sem grupo") pra outro (ex: "Teste") via popover na sidebar causava unmount do `<TerminalPane>` (clearInterval do heartbeat de viewing). Após o usuário trocar pro grupo destino e clicar no terminal pra abri-lo no mosaico, o `<TerminalPane>` remontava e o `IntersectionObserver` era recriado — mas podia disparar callback inicial com `entry.isIntersecting=false` se o `slotRef.current` ainda tinha `getBoundingClientRect()` zero (o `cached.container` foi anexado via `appendChild` síncrono mas o flex layout/`fitAddon.fit()` ficaram 1 frame atrás). Como o IO só dispara de novo quando atravessa o threshold de 0.1 e a transição "altura 0 → altura cheia" não cruzava esse limite, `intersectingRef.current` ficava preso em `false` para sempre. Heartbeat parava de mandar `{type: 'viewing'}`, backend perdia `last_viewing_ts`, Rule 5 (`now - last_viewing_ts < VIEWING_GRACE_SECONDS=15`) deixava de suprimir → notificação disparava mesmo com o terminal visível em tela. Fix em duas camadas: **(a)** `frontend/src/components/TerminalPane.jsx` — `intersectingRef` agora inicializa em `false` (em vez do antigo `true` otimista) e o effect do IO faz bootstrap síncrono via `slot.getBoundingClientRect()` no mount; o `sendHeartbeat` também reconcilia a cada 10s lendo o rect direto se o ref está false (recupera de qualquer lock-in residual sem custo perceptível). **(b)** `client/src/routes/terminal.py` — endpoint `PATCH /sessions/{id}/group` agora também toca `sessions[session_id]["last_viewing_ts"] = time.time()` junto com a mutação de grupo, dando 15s de grace defensivo no backend pra qualquer timing edge case que reapareça no futuro.

### Added

- **Documentação `NOTIFICATIONS.md` na raiz do repo.** Documento técnico completo do sistema de notificações idle do Pulse: visão geral, fluxo de dados ponta-a-ponta (frontend → WS → backend → broadcast/Telegram), as 5 regras do `notification_watcher` com paths e linhas, as 4 condições do heartbeat de viewing, ciclo de vida do `terminalCache` module-level, configuração via `data/settings.json`, casos extremos & gotchas (mover entre grupos, race do IO no remount, múltiplas abas, WS substituído, compose drafts, etc.), tabela de constantes com referências, e checklists para futuras alterações. Inclui também um checklist de verificação manual pra rodar antes de qualquer commit que mexa nesse sistema.

## [1.9.1] — 2026-04-23

### Fixed

- **install (Windows): erros do instalador agora ficam visíveis mesmo quando a janela do PowerShell fecha sozinha.** O `install.ps1` passou a (a) capturar tudo num arquivo `%TEMP%\pulse-install-<timestamp>.log` via `Start-Transcript` e (b) abrir uma `MessageBox` nativa do Windows (WPF) sempre que aborta com erro fatal — popup que sobrevive ao console fechando logo após `exit 1`. Antes, em ambientes onde a janela termina ao sair (clique-direito em `.ps1` "Run with PowerShell", atalhos com `powershell -Command "..."`, perfis do Windows Terminal configurados pra fechar), o usuário só conseguia ler a mensagem se filmasse a tela e pausasse no frame certo. Os dois `exit 1` "soltos" no main (`Test-Wsl2` e `Test-WslSystemd`) foram convertidos pra `Write-ErrExit` para herdar o mesmo tratamento — antes esses caminhos saíam sem fechar transcript nem disparar MessageBox, justamente os casos mais frequentes de falha. Fallback final é `Read-Host` quando WPF não está disponível (PowerShell Core no Linux/macOS, Windows Server Core).
- **install (Windows): rejeita corretamente `docker-desktop`/`rancher-desktop` quando elas são a única "distro" WSL instalada.** A função `Get-DefaultDistro` já rejeitava container-engine VMs no caminho do default explícito (`*` em `wsl -l -v`), mas no caminho de fallback (`Invoke-Wsl -l -q` quando nenhuma distro está marcada como default) ela aceitava qualquer item — incluindo `docker-desktop`. O fluxo seguia até bater em `Test-WslSystemd`, que falhava com mensagem genérica de "systemd não está rodando" (porque `docker-desktop` não roda systemd) em vez de orientar o usuário a instalar uma distro Linux real. Agora o fallback aplica a mesma rejeição e aborta com mensagem específica: `"The only WSL distro installed is 'docker-desktop' ... Run: wsl --install -d Ubuntu"`. Cenário típico onde isso aparecia: máquina com Docker Desktop instalado mas sem nenhuma distro Ubuntu/Debian/etc.

## [1.9.0] — 2026-04-23

### Added

- **Visão por aba isolada via `localStorage` com auto tab-claim.** Cada aba do navegador agora tem seu próprio mosaico, grupo selecionado e fluxo selecionado por projeto — abrir 2 abas no Chrome (mesmo no mesmo projeto+grupo) significa duas visões totalmente independentes. Implementado via `frontend/src/lib/tabSession.js`: na primeira carga de uma aba sem `sessionStorage["rt:tab-uuid"]`, a aba consulta as outras abas via `BroadcastChannel("rt:tab-coord")` por 150 ms perguntando quais UUIDs já estão "claimed", então adota o primeiro UUID livre da lista persistida em `localStorage["rt:tab-profiles"]` (LRU, máximo 10 perfis) ou gera um novo via `crypto.randomUUID()`. F5 mantém a visão (UUID em `sessionStorage`); fechar a aba libera o UUID pra adoção futura. No dia seguinte (browser reaberto), abrir N abas readota até N dos perfis existentes — cada aba volta com layout/grupo/fluxo da última vez que aquele UUID foi usado. Estado granular nas chaves `rt:tab::<uuid>::layout::<projectId>::<groupKey>` e `rt:tab::<uuid>::view::<projectId>::{group,flow}`. Quando o pool estoura 10 perfis, o `lastSeenTs` mais antigo é evictado e todas suas chaves são apagadas do `localStorage`.
- **Endpoint one-shot `GET /api/migrate-state`.** Lê `data/layouts.json` + `data/view-state.json`, retorna o conteúdo, e os apaga (driver `file`: `fs.unlink`; outros drivers: sobrescreve com objeto vazio via `writeStore`). O frontend chama uma vez na primeira carga após o upgrade (detectado por ausência do flag `localStorage["rt:migrated-from-server"]`) e popula as chaves locais do UUID recém-criado, então marca o flag para nunca mais chamar. Idempotente: chamadas subsequentes em qualquer aba retornam `{layouts: null, view_state: null}` porque os arquivos já foram esvaziados.

### Changed

- **Removida a persistência global de mosaico e view-state no servidor.** Antes: `frontend/data/layouts.json` (árvore react-mosaic chaveada por `(projectId, groupId)`) e `frontend/data/view-state.json` (grupo + fluxo selecionados por projeto) eram salvos via `PUT /api/layouts` e `PUT /api/view-state`, com debounce de 500 ms / 400 ms e refetch on focus no `ViewStateProvider`. Toda aba do mesmo browser via o mesmo estado, e mudar em uma aba sobrescrevia a outra após F5. Agora: tudo vive em `localStorage` no escopo do UUID da aba (ver acima); `ViewStateProvider` dropou o refetch on focus (não faz sentido com storage local — o estado é a fonte da verdade). Os endpoints `/api/layouts` e `/api/view-state` foram **removidos**, junto com `getLayouts`/`setLayouts`/`getViewState`/`setViewState` do `frontend/src/services/api.js`. `data/layouts.json` e `data/view-state.json` foram tirados de `DATA_REL_PATHS` em `frontend/src/lib/storage.js` — não são mais sincronizados pelos botões de cloud↔local em Settings → Storage.

### Migração

- Rodando `1.9.0` pela primeira vez, a primeira aba a abrir absorve o estado existente do servidor pra suas chaves locais e marca a migração como concluída. Após isso, os arquivos `data/layouts.json` e `data/view-state.json` são apagados automaticamente do disco (driver `file`) ou esvaziados (drivers `mongo`/`s3`). Caso o navegador esteja com versão antiga do bundle JS cacheada quando o servidor já está em 1.9.0, qualquer `PUT /api/layouts` ou `/api/view-state` retornará 404 — basta hard-refresh (`Ctrl+Shift+R`) na aba afetada para carregar o novo cliente.

### Fixed (durante validação interna antes do release)

- **Mosaico do dashboard sumia ao logar de novo após logout (ou após expiração da sessão de 24 h).** Bug introduzido pela própria mudança de v1.9.0 (estado em `localStorage` em vez de servidor) — só apareceu no fluxo de logout/login. Cenário reproduzível: 2 terminais num grupo, logout (`window.location.href = '/login'` faz reload completo), login → mosaico aparece vazio e a chave `rt:tab::<uuid>::layout::<projectId>::<groupId>` é removida do `localStorage` instantaneamente. Causa raiz tem três ingredientes que se compõem na transição `/login → /`:
  - **(1)** O `ServersProvider` mantém `loading=false, servers=[]` durante toda a estadia em `/login` (foi o último estado setado antes do reload). Quando `router.replace('/')` dispara o navigate, Page.js mounta no mesmo render commit em que o pathname muda — antes do `useEffect` do `ServersProvider` rodar `load()`.
  - **(2)** Page.js mounta, lê `serversLoading=false, servers=[]`, e seu `useEffect` de fetch dispara `fetchSessions`/`fetchGroups`. Ambos caíam no short-circuit `if (servers.length === 0)` que chamava `setHydratedSessions(true)` / `setHydratedGroups(true)` com listas vazias — semântica errada: o flag implicava "fetch real concluída" mas era estado fabricado.
  - **(3)** Quando o `ServersProvider.load()` finalmente termina (`setServers([srv1])` + `setLoaded(true)` + `setLoading(false)` batched), o React processa todos os updates pendentes em um único render. Resultado: `hydrated=true`, `hydratedLayouts=true` (do `bootTabSession`), `hydratedSessions=true` (legado do short-circuit), `hydratedGroups=true` (idem), `sessions=[]`/`groups=[]` (ainda do short-circuit, fetch real só vai rodar no próximo render). `projectDataReady` vira `true` por um instante. O `useEffect` de validação em `page.js` roda com `sessions=[]`: `validateTree(tree, validIds={})` retorna `null` para qualquer tile (todos "órfãos"), `mosaicLayouts[key]` vira `null`, e o `flushLayoutsToStorage` traduz `null` em `removeKey()` — apagando a chave do `localStorage` para sempre.
  
  F5 não disparava porque o cookie de auth permanecia válido e a transição era um reload "limpo" com `loading=true` desde o início (Page.js's fetch effect early-returnava em `serversLoading`).
  
  Fix em duas camadas: **(a)** o `ServersProvider` agora expõe um flag `loaded` (separado de `loading`) que vira `true` apenas após o primeiro `load()` real concluir com sucesso — `projectDataReady` em Page.js inclui esse flag como defesa adicional; **(b)** o short-circuit de `fetchSessions`/`fetchGroups` (quando `servers.length === 0`) **não seta** mais `hydratedSessions/Groups=true`. A semântica passou a ser estrita: `hydrated*=true` significa "fetch real bem-sucedida com servers populados". Sem servers, o flag fica `false`, gate fica `false`, validação não roda. Os outros effects que checavam `hydratedSessions` (snapshot save, restore sessions, compose drafts cleanup) já tinham early-return em `servers.length === 0` antes do check, então a mudança não regrediu nada.

## [1.8.0] — 2026-04-23

### Added

- **Idle alert agora respeita "estou vendo o terminal" (regra "tô olhando").** Cada `<TerminalPane>` no frontend manda um heartbeat `{type: 'viewing'}` a cada 10 s pelo WebSocket existente do terminal **se e somente se** as quatro condições forem verdadeiras: `document.visibilityState === 'visible'`, `document.hasFocus()`, o terminal está na viewport (via `IntersectionObserver` com threshold 0.1), e houve `mousemove`/`keydown`/`pointerdown`/`wheel`/`touchstart` na página nos últimos 30 s. O backend grava `last_viewing_ts` na sessão e o `notification_watcher` usa uma nova **Rule 5** (`now - last_viewing_ts < VIEWING_GRACE_SECONDS = 15s`) que suprime o alerta quando você está vendo. Sai da aba / minimiza / scrolla o terminal pra fora da viewport / vai pegar café (mouse parado por 30 s+) → para de mandar heartbeat → 15 s depois o backend "esquece" e os alertas voltam a poder disparar normalmente. Resolve dois sintomas comuns: (1) alerta dispara ao logar e abrir um terminal porque o `resize`/SIGWINCH do attach inicial mudou a tela do tmux capturada, resetando o cronômetro de idle; (2) alerta dispara enquanto você navega TUI de agente (Claude Code / Cursor / Gemini CLI) com setas pra escolher uma opção — o handler de input já ignora escape sequences pro contador `bytes_since_enter`, então a Regra 2 não suprimia. Com Rule 5, ambos os casos somem porque você está olhando.
- **Verificação de porta com kill assistido nos `start.sh`.** Antes de spawnar o uvicorn (cliente) ou o `next start`/`next dev` (frontend), os scripts agora checam se a porta-alvo está em uso e, se estiver, listam os PIDs/comandos que a estão segurando e perguntam interativamente `Kill <service> on port <N> and continue? [Y/n]` (default Y, Enter confirma). Aceito → manda `SIGTERM` em todos os PIDs (com fallback `fuser -k -TERM`), espera até 5 s pelo socket liberar, escala pra `SIGKILL` se necessário, e prossegue. Recusado → aborta com mensagem clara. A detecção usa `bash`'s built-in `/dev/tcp` (zero dependências externas) que mirroreia exatamente o que o uvicorn/next tentam no bind — fonte da verdade, não fica refém de `lsof`/`ss`/`fuser` que podem lagar durante teardown e reportar porta livre quando o socket ainda está bound. PID enumeration usa `lsof`, `ss` ou `fuser` (o que estiver disponível) só para mostrar quem é o dono. O `start.sh` raiz roda os dois checks **sequencialmente antes** de backgroundar os filhos — backgroundar o prompt enterraria a pergunta no output do outro filho concorrendo pelo mesmo `/dev/tty`. Função reutilizável `pulse_check_port` exportada em `install/lib/common.sh`, sourcing automático em todos os start.sh.

### Changed

- **`TIMEOUT_MIN` do idle subiu de 5 → 15 segundos.** O range válido agora é 15-3600s. Por que: a Rule 5 ("tô olhando") usa um grace de 15 s para absorver gap entre heartbeats e re-mounts do react-mosaic; o `TIMEOUT_MIN` precisava ser ≥ grace para a interação fazer sentido. Migração automática lazy: `load_settings` (`client/src/resources/settings.py`) detecta se o valor salvo no `data/settings.json` está abaixo do novo mínimo, faz clamp em memória e **persiste imediatamente** no disco com `save_settings()` (com log `idle_timeout_seconds drifted (5 → 15); persisting clamp`), então o JSON fica em sincronia com o que o sistema usa de fato — sem valor "fantasma" no disco. Frontend (`NotificationsTab.jsx` + i18n hints `notes.toolbar.timeoutHint` em pt-BR/en/es) também atualizado: `clampTimeout` e `<input min={15}>` rejeitam digitar abaixo de 15.
- **`broadcast()` dos eventos de notificação agora envia em paralelo** (`asyncio.gather(..., return_exceptions=True)` em vez de loop serial com `await`). Um cliente WebSocket lento não atrasa mais o envio para os outros — útil quando você tem várias abas abertas e a do celular está com WiFi ruim, a do desktop não fica esperando.

### Fixed

- **`send_telegram_message` não bloqueia mais o event loop.** Estava sendo chamado direto de dentro do `notification_watcher` (asyncio task) sem `asyncio.to_thread`, e a função usa `urllib.request.urlopen` com timeout de 10 s. Resultado: se o Telegram tava lento ou inalcançável, **todo o event loop do Python congelava por até 10 s** — todos os WebSockets de terminal travavam (o output do tmux ficava empilhado), o WebSocket de notificação não conseguia broadcastar pra outras sessões, e o próprio watcher não pollava as outras sessões. Fix: `await asyncio.to_thread(send_telegram_message, ...)`. Compare com `capture_pane` na mesma `notifications.py:178` que já estava corretamente em `asyncio.to_thread`.
- **Compose draft sem Enter não dispara mais alerta idle falso.** O endpoint `POST /sessions/{id}/send-text` chamava `send_text_to_session` direto pro tmux sem tocar o estado da sessão (`bytes_since_enter`/`last_input_ts`/`last_enter_ts`), enquanto o handler do WebSocket de input atualizava esses campos a cada keystroke. Resultado: você usa o compose pra pré-popular um comando longo (ex: `git commit -m "..."`) sem mandar Enter, deixa lá pra revisar; o `idle_timeout` passa; a Regra 2 do watcher (`bytes_since_enter == 0`) não suprime; alerta dispara. Fix: o handler do `send-text` agora espelha exatamente a lógica do handler do WS de input (incrementa contador se `send_enter=False`, zera + grava `last_enter_ts` se `True`, sempre atualiza `last_input_ts`).
- **Timeout do `tmux capture-pane` não é mais silencioso.** Antes, `subprocess.TimeoutExpired` era capturado junto com `FileNotFoundError` num único `except` que retornava `None` sem nenhum log. Se o servidor tmux ficava lento crônico, o user simplesmente parava de receber alertas e não tinha pista nenhuma do porquê. Agora, `TimeoutExpired` é tratado num `except` separado com `logger.warning(f"capture_pane timeout for {session_id}")` — diagnóstico claro no log do client.

## [1.7.5] — 2026-04-23

### Fixed

- **Floating note body now behaves like a plain textarea — cursor stays where you click, selection works, scroll is preserved.** `NoteBody.jsx` previously toggled between a read-only `<div>` (whitespace-pre-wrap, with a custom `[ ]`/`[x]` markdown parser that rendered task-style checkboxes as clickable HTML inputs) and a `<textarea>` for editing. Each toggle re-mounted the textarea with `selectionStart=0` and `scrollTop=0`, so re-clicking a long note to continue writing always reset the scroll to the top — and clicking a word in the middle of the visible text put the caret at position 0 instead of where you clicked, breaking selections and mid-text edits. Root cause: the toggle existed *only* to support the clickable-checkbox rendering on the read-only side, and the two elements (`<div>` and `<textarea>`) are separate DOM nodes that can't share scroll/selection state. Fix: drop the toggle, render the textarea unconditionally. The `<div>` view-mode, the parser, the `editing` state, the focus `useEffect`, and the `toggleCheckbox` helper are all gone (~40 lines removed, ~15 lines remain). You can still type `[ ]`/`[x]` in a note — they're just literal text now, no longer rendered as interactive checkboxes. Trade-off was discussed and accepted explicitly.

## [1.7.4] — 2026-04-23

### Fixed

- **Idle notifications duplicated when running two Pulse instances on the same host.** When the user kept the official (installer) and the dev (`./start.sh`) instances running side-by-side on different ports, every idle event produced two Telegram messages instead of one. Root cause: the "this terminal should notify" flag was a tmux server option (`@notify_on_idle`), and every `tmux` call in the codebase runs without `-L`/`-S` — so both client processes talk to the *same* tmux daemon and read the *same* flag. Whichever frontend the user toggled the bell on, both backends would adopt the session on their next 5 s `notification_watcher` tick and dispatch independently. The existing in-memory `last_notified_hash` dedup is process-local, so it never desynchronized them. The fix namespaces the option per instance: `client/src/tools/tmux.py` now derives an `INSTANCE_ID` from the SHA-256 of the absolute path of the `client/` directory (8 hex chars — stable across restarts of the same install, distinct between installs) and writes/reads `@notify_on_idle__<INSTANCE_ID>` instead of the bare `@notify_on_idle`. A new `migrate_notify_on_idle_legacy(session_id)` helper, called inside `recover_sessions()` and `sync_sessions_request()` in `client/src/resources/terminal.py`, copies any pre-existing legacy flag into the current instance's namespace and removes the legacy option — so the first instance to boot after upgrade adopts the previously-toggled sessions, and subsequent instances stop noisy-adopting them. Trade-off accepted: on the *other* instances' UIs the bell appears off for those legacy sessions until the user re-enables it there explicitly. Going forward, toggling the bell on a given UI only affects that instance's dispatcher; both instances notify only when the user explicitly enables the bell on both — which is the expected behavior.

## [1.7.3] — 2026-04-23

### Fixed

- **Idle notification no longer re-fires for the same on-screen state.** Agent TUIs (Claude Code, Cursor) return to a visually identical input prompt after each user response — the watcher would hit the idle threshold, alert, the user would reply, the agent would answer and park back at the same prompt, the watcher would alert *again* for what looks like the same thing. The watcher now caches the MD5 of the raw captured pane at the moment it sends each alert and, on subsequent idle triggers in the same session, silences the dispatch if the current capture hash matches the previously-notified one. A safety TTL of 30 minutes (`NOTIFIED_HASH_TTL_SECONDS`) re-arms the channel even if the tela stays bit-identical, so a genuinely-stuck terminal still gets a reminder. The cache is in-memory and tied to the session's `_state` entry — disabling the bell (`reset_session_state`) clears it; a client restart also clears it (at the cost of one potentially-duplicate alert post-restart, which is acceptable).
- **Idle notification fired during mid-composition (typing without Enter).** The previous timestamp-based heuristic tried to detect "user is mid-composing" by comparing `last_input_ts > last_enter_ts`, but that relation can collapse in edge cases — pastes with embedded `\r`/`\n` set both timestamps to the same moment, and TUIs that echo each keystroke into the pane advance `last_output_ts` in the next 5 s watcher tick *after* the keystroke, leaving `last_output_ts > last_input_ts` and defeating the "last input came after last output" guard. End result: user types part of a command, pauses to think, and the idle alert fires for a terminal that has text pending in the buffer. The rewrite replaces the two timestamp comparisons with an **explicit byte counter** — `sessions[sid]["bytes_since_enter"]` — maintained by the WebSocket input handler in `client/src/resources/terminal.py`: every keystroke increments it; every `data` containing `\r` or `\n` resets it to the length of the tail after the last newline (so a paste like `cmd\nmore` leaves 4 bytes pending — "more"). Escape sequences (`data.startswith("\x1b")` — arrow keys, mouse/touch scroll events like `\x1b[<64;...M` from mobile, function keys) are **ignored** (they don't alter the visible buffer). Ctrl-C (`\x03`) and Ctrl-D (`\x04`) **zero the counter** (they abort or EOF the pending line in the shell). The watcher's new Rule 2 is a single check: `if bytes_since_enter > 0: skip`. Semantically: any un-submitted text in the buffer suppresses the alert entirely until the user presses Enter, Ctrl-C, or Ctrl-D. Removes the two old timestamp rules and simplifies the idle-gate condition from four rules down to three (has-seen-output, buffer-empty, timeout-elapsed — plus the existing hash dedup). Known trade-off unchanged: `sleep 60` with Enter still alerts early because `last_output_ts` is advanced by the echo of the prompt character; that's bug #3 from v1.7.0, out of scope for this fix.
- **Notification title kept the old project/group/terminal name after rename or group change.** The title of idle alerts is composed from cached values in the client's in-memory `sessions[sid]` dict. When the user renames a project or group via the dashboard, `propagateScopeName` fires `PATCH /api/sessions/{id}/scope-names` for every matching session on every server — but errors were silenced by bare `catch {}`, so a server offline at the exact moment of the rename meant the label drifted permanently on that server. Similarly `sync_sessions_request` short-circuits on known sessions (`if sid in sessions: continue`), so even a client restart wouldn't rehydrate a stale cache. Three fixes, all working together:
  1. **Watcher reconciles per tick.** `client/src/resources/notifications.py` now re-reads the tmux options `@project_name`, `@group_name`, and `@custom_name` on every monitored session every 5 s, alongside the existing `@notify_on_idle` reconciliation. Any mutation to a tmux option — whether from the frontend, another client, or manual `tmux set-option` — lands in the next alert's title within one tick. Cost is ~4 subprocess calls per monitored session per 5 s, well below the noise floor.
  2. **Retry with exponential backoff in `propagateScopeName`.** `frontend/src/services/api.js` now retries `updateSessionScopeNames` up to 3 times per session (1 s / 2 s / 4 s) before giving up, and logs a `console.warn` on final failure. Survives the most common cause of silent drift: a momentary server-flap during the rename HTTP round-trip. `propagateScopeName` itself stays fire-and-forget — the retry happens inside the per-session promise, not blocking the UI.
  3. **`deleteGroup` cleans up orphans.** When the user deletes a group, the frontend now calls `assignSessionGroup(compositeId, null, null)` for every session that had `group_id === groupId`, on every configured server, *before* removing the group from the local store. Clears `@group_id` / `@group_name` tmux options on the orphaned terminals so their next idle alert drops the group segment from the title (shows `project › terminal` instead of `project › Deleted Group Name › terminal`).

## [1.7.2] — 2026-04-23

### Fixed

- **Linux systemd dashboard service now finds `npx` when node is installed via nvm/volta/fnm.** The `pulse.service` unit hardcoded `PATH=%h/.local/bin:/usr/local/bin:/usr/bin:/bin`, which excludes every per-user node version manager. On machines where node was installed *only* via nvm (the default on Ubuntu/Debian dev setups), `systemctl --user start pulse.service` died on boot with `/bin/sh: 1: exec: npx: not found` and restarted five times before hitting `StartLimitBurst` and giving up — leaving `pulse-client.service` running (which uses an absolute-path venv uvicorn) but the dashboard unreachable. The fix mirrors the pattern already used by the macOS launchd template for Homebrew node: the `ExecStart=` shell now probes `$HOME/.nvm/versions/node/<latest>/bin` (picking the highest version via `sort -V`), `$HOME/.volta/bin`, and `$HOME/.local/share/fnm/aliases/default/bin`, prepending any that exist to `$PATH` before `exec npx next start …`. System node in `/usr/bin` still works through the original `Environment=PATH` fallback. Users hitting this on an already-installed Pulse can either re-run the installer (which re-copies the updated template) or patch `~/.config/systemd/user/pulse.service` by hand and `systemctl --user daemon-reload && systemctl --user restart pulse.service`.

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

[Unreleased]: https://github.com/kevinzezel/pulse/compare/v4.5.0...HEAD
[4.5.0]: https://github.com/kevinzezel/pulse/releases/tag/v4.5.0
[4.4.0-pre]: https://github.com/kevinzezel/pulse/releases/tag/v4.4.0-pre
[4.3.2-pre]: https://github.com/kevinzezel/pulse/releases/tag/v4.3.2-pre
[4.3.1-pre]: https://github.com/kevinzezel/pulse/releases/tag/v4.3.1-pre
[4.3.0-pre]: https://github.com/kevinzezel/pulse/releases/tag/v4.3.0-pre
[4.2.9-pre]: https://github.com/kevinzezel/pulse/releases/tag/v4.2.9-pre
[4.2.8-pre]: https://github.com/kevinzezel/pulse/releases/tag/v4.2.8-pre
[4.2.7-pre]: https://github.com/kevinzezel/pulse/releases/tag/v4.2.7-pre
[4.2.6-pre]: https://github.com/kevinzezel/pulse/releases/tag/v4.2.6-pre
[4.2.5-pre]: https://github.com/kevinzezel/pulse/releases/tag/v4.2.5-pre
[4.2.3-pre]: https://github.com/kevinzezel/pulse/releases/tag/v4.2.3-pre
[4.2.2-pre]: https://github.com/kevinzezel/pulse/releases/tag/v4.2.2-pre
[4.2.1-pre]: https://github.com/kevinzezel/pulse/releases/tag/v4.2.1-pre
[4.2.0-pre]: https://github.com/kevinzezel/pulse/releases/tag/v4.2.0-pre
[4.1.0-pre]: https://github.com/kevinzezel/pulse/releases/tag/v4.1.0-pre
[4.0.3-pre]: https://github.com/kevinzezel/pulse/releases/tag/v4.0.3-pre
[4.0.2-pre]: https://github.com/kevinzezel/pulse/releases/tag/v4.0.2-pre
[4.0.1-pre]: https://github.com/kevinzezel/pulse/releases/tag/v4.0.1-pre
[4.0.0-pre]: https://github.com/kevinzezel/pulse/releases/tag/v4.0.0-pre
[3.3.2-pre]: https://github.com/kevinzezel/pulse/releases/tag/v3.3.2-pre
[3.3.1]: https://github.com/kevinzezel/pulse/releases/tag/v3.3.1
[3.3.0]: https://github.com/kevinzezel/pulse/releases/tag/v3.3.0
[3.2.10-pre]: https://github.com/kevinzezel/pulse/releases/tag/v3.2.10-pre
[3.2.9-pre]: https://github.com/kevinzezel/pulse/releases/tag/v3.2.9-pre
[3.2.8-pre]: https://github.com/kevinzezel/pulse/releases/tag/v3.2.8-pre
[3.2.7-pre]: https://github.com/kevinzezel/pulse/releases/tag/v3.2.7-pre
[3.2.6-pre]: https://github.com/kevinzezel/pulse/releases/tag/v3.2.6-pre
[3.2.5-pre]: https://github.com/kevinzezel/pulse/releases/tag/v3.2.5-pre
[3.2.4-pre]: https://github.com/kevinzezel/pulse/releases/tag/v3.2.4-pre
[3.2.3-pre]: https://github.com/kevinzezel/pulse/releases/tag/v3.2.3-pre
[3.2.2-pre]: https://github.com/kevinzezel/pulse/releases/tag/v3.2.2-pre
[3.2.1]: https://github.com/kevinzezel/pulse/releases/tag/v3.2.1
[3.2.0]: https://github.com/kevinzezel/pulse/releases/tag/v3.2.0
[2.11.1-pre]: https://github.com/kevinzezel/pulse/releases/tag/v2.11.1-pre
[2.11.0-pre]: https://github.com/kevinzezel/pulse/releases/tag/v2.11.0-pre
[2.10.1]: https://github.com/kevinzezel/pulse/releases/tag/v2.10.1
[2.10.0]: https://github.com/kevinzezel/pulse/releases/tag/v2.10.0
[2.9.2-pre]: https://github.com/kevinzezel/pulse/releases/tag/v2.9.2-pre
[2.9.1]: https://github.com/kevinzezel/pulse/releases/tag/v2.9.1
[2.9.0]: https://github.com/kevinzezel/pulse/releases/tag/v2.9.0
[2.8.0]: https://github.com/kevinzezel/pulse/releases/tag/v2.8.0
[2.7.2-pre]: https://github.com/kevinzezel/pulse/releases/tag/v2.7.2-pre
[2.7.1-pre]: https://github.com/kevinzezel/pulse/releases/tag/v2.7.1-pre
[2.6.0]: https://github.com/kevinzezel/pulse/releases/tag/v2.6.0
[2.5.12]: https://github.com/kevinzezel/pulse/releases/tag/v2.5.12
[2.5.11-pre]: https://github.com/kevinzezel/pulse/releases/tag/v2.5.11-pre
[2.5.10-pre]: https://github.com/kevinzezel/pulse/releases/tag/v2.5.10-pre
[2.5.9-pre]: https://github.com/kevinzezel/pulse/releases/tag/v2.5.9-pre
[2.5.8-pre]: https://github.com/kevinzezel/pulse/releases/tag/v2.5.8-pre
[2.5.7]: https://github.com/kevinzezel/pulse/releases/tag/v2.5.7
[2.5.6-pre]: https://github.com/kevinzezel/pulse/releases/tag/v2.5.6-pre
[2.5.5-pre]: https://github.com/kevinzezel/pulse/releases/tag/v2.5.5-pre
[2.5.4]: https://github.com/kevinzezel/pulse/releases/tag/v2.5.4
[2.5.3]: https://github.com/kevinzezel/pulse/releases/tag/v2.5.3
[2.5.2]: https://github.com/kevinzezel/pulse/releases/tag/v2.5.2
[2.5.1]: https://github.com/kevinzezel/pulse/releases/tag/v2.5.1
[2.5.0]: https://github.com/kevinzezel/pulse/releases/tag/v2.5.0
[2.4.1]: https://github.com/kevinzezel/pulse/releases/tag/v2.4.1
[2.4.0]: https://github.com/kevinzezel/pulse/releases/tag/v2.4.0
[2.3.0]: https://github.com/kevinzezel/pulse/releases/tag/v2.3.0
[2.2.0]: https://github.com/kevinzezel/pulse/releases/tag/v2.2.0
[2.1.1]: https://github.com/kevinzezel/pulse/releases/tag/v2.1.1
[2.1.0]: https://github.com/kevinzezel/pulse/releases/tag/v2.1.0
[2.0.2]: https://github.com/kevinzezel/pulse/releases/tag/v2.0.2
[2.0.1]: https://github.com/kevinzezel/pulse/releases/tag/v2.0.1
[1.13.7]: https://github.com/kevinzezel/pulse/releases/tag/v1.13.7
[1.13.6]: https://github.com/kevinzezel/pulse/releases/tag/v1.13.6
[1.13.5]: https://github.com/kevinzezel/pulse/releases/tag/v1.13.5
[1.13.4]: https://github.com/kevinzezel/pulse/releases/tag/v1.13.4
[1.13.3]: https://github.com/kevinzezel/pulse/releases/tag/v1.13.3
[1.13.2]: https://github.com/kevinzezel/pulse/releases/tag/v1.13.2
[1.13.1]: https://github.com/kevinzezel/pulse/releases/tag/v1.13.1
[1.13.0]: https://github.com/kevinzezel/pulse/releases/tag/v1.13.0
[1.12.0]: https://github.com/kevinzezel/pulse/releases/tag/v1.12.0
[1.11.1]: https://github.com/kevinzezel/pulse/releases/tag/v1.11.1
[1.11.0]: https://github.com/kevinzezel/pulse/releases/tag/v1.11.0
[1.10.7]: https://github.com/kevinzezel/pulse/releases/tag/v1.10.7
[1.10.6]: https://github.com/kevinzezel/pulse/releases/tag/v1.10.6
[1.10.5]: https://github.com/kevinzezel/pulse/releases/tag/v1.10.5
[1.10.4]: https://github.com/kevinzezel/pulse/releases/tag/v1.10.4
[1.10.3]: https://github.com/kevinzezel/pulse/releases/tag/v1.10.3
[1.10.2]: https://github.com/kevinzezel/pulse/releases/tag/v1.10.2
[1.10.1]: https://github.com/kevinzezel/pulse/releases/tag/v1.10.1
[1.10.0]: https://github.com/kevinzezel/pulse/releases/tag/v1.10.0
[1.9.2]: https://github.com/kevinzezel/pulse/releases/tag/v1.9.2
[1.9.1]: https://github.com/kevinzezel/pulse/releases/tag/v1.9.1
[1.9.0]: https://github.com/kevinzezel/pulse/releases/tag/v1.9.0
[1.8.0]: https://github.com/kevinzezel/pulse/releases/tag/v1.8.0
[1.7.5]: https://github.com/kevinzezel/pulse/releases/tag/v1.7.5
[1.7.4]: https://github.com/kevinzezel/pulse/releases/tag/v1.7.4
[1.7.3]: https://github.com/kevinzezel/pulse/releases/tag/v1.7.3
[1.7.2]: https://github.com/kevinzezel/pulse/releases/tag/v1.7.2
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

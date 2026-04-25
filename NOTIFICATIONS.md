# Pulse idle notification system

Technical documentation of the "terminal idle" alert — how it works end-to-end between frontend and client (Python).

## Overview

Pulse monitors every PTY with `notify_on_idle=True` and fires an alert when it crosses `idle_timeout_seconds` without visible changes on the display. Alerts are delivered through two configurable channels: the browser WebSocket (rendered as toast + native push) and Telegram (a message with a snippet of the output).

The trickiest part is **anti-spam**: several rules suppress alerts in specific scenarios (mid-composition, hash dedup, "I'm watching"), because without them the system would devolve into constant spam when you're using interactive agents like Claude Code, Cursor, or Gemini CLI.

## Components

| Component | Where | Function |
|---|---|---|
| `notification_watcher` | `client/src/resources/notifications.py` | Single asyncio task that runs every 5s, renders the PTY display via pyte, applies the 5 rules, and decides whether to notify |
| `notification_broadcast` | `client/src/resources/notification_broadcast.py` | Set of WebSockets connected to `/ws/notifications` — parallel fan-out via `asyncio.gather` |
| Viewing heartbeat | `frontend/src/components/TerminalPane.jsx` + `frontend/src/providers/NotificationsProvider.jsx` | Every `<TerminalPane>` sends `{type: 'viewing', session_id}` every 10s through the multi-client notifications WS while the local policy considers the pane visible |
| Browser dedup | `frontend/src/providers/NotificationsProvider.jsx` | Uses `event_id` + `BroadcastChannel`/`localStorage` to avoid duplicated toast/sound/native notification across tabs of the same browser |
| `_state[sid]` (watcher) | `client/src/resources/notifications.py` | Watcher in-memory state (hash, last_output_ts, notified flag, last_notified_hash) |
| `sessions[sid]` (terminal) | `client/src/resources/terminal.py` | Canonical session dict (group, project, last_viewing_ts, bytes_since_enter, etc.) |

## Data flow

```
Frontend                         Backend (client)                 Channels
────────                         ────────────────                 ────────
TerminalPane (visible)           sessions[sid].last_viewing_ts
  ├─ every 10s, if local    ─→   updated via /ws/notifications
  │  policy approves, sends      (fallback also accepted on the
  │  {type:'viewing', sid}       terminal-exclusive WS)
  ▼
                                 notification_watcher (5s loop)
                                 ├─ snapshot of sessions
                                 ├─ render display via pyte
                                 │  (PTYSession.scrollback → pyte.Screen)
                                 ├─ md5 of the rendered text
                                 ├─ apply Rules 1-5
                                 │  (Rule 5 reads last_viewing_ts)
                                 ├─ if all pass:
                                 │  ├─ broadcast({type:'idle',...})  ──→ browser (WS)
                                 │  └─ send_telegram_message(...)    ──→ Telegram
                                 └─ marks state.notified=True
```

## The 5 watcher rules (in order)

Implemented in `client/src/resources/notifications.py`. For every monitored session, the watcher renders the PTY scrollback through pyte (`screen.display`), MD5s the resulting lines, and runs the rules in order:

### Pre-checks (before the rules)

- **Hash of the pyte display** — `_render_pane_via_pyte()` does `screen.reset()` + `stream.feed(scrollback)` and returns `"\n".join(screen.display).rstrip()`. No ANSI, no cursor, no redraw noise — only the canonical visual state the user would see. (The previous version, with tmux capture-pane, needed regexes to strip decorative borders because tmux redraws borders on every resize/wrap. Pyte renders only the characters the program actually placed on the grid.)
- **Fresh state**: creates baseline `{hash, last_output_ts:0, …}` and continues. Important: `last_output_ts=0` means "never observed a real change"; a dormant session that was just armed with `notify_on_idle=True` **cannot** false-alert.
- **Hash changed**: usually updates `last_output_ts=now`, resets `notified=False`, and continues. Exception: if the session had already notified and the change happened shortly after a resize (`RESIZE_GRACE_SECONDS = 5`), the watcher only updates the hash baseline and keeps `notified=True` — covers TUI apps (vim/htop) reformatting columns after SIGWINCH.
- **Already alerted in this streak** (`notified=True`): continues. Guarantees 1 alert per idle sequence.

### Rule 1 — Requires real output observed

```python
if last_output <= 0:
    continue
```

A "fresh" session (no hash change since the watcher started observing) can never alert. Covers the case "I just enabled `notify_on_idle` on a terminal that's been parked for 1h" — without this check, it would alert immediately.

### Rule 2 — Permanent ack if mid-composition

```python
if sess.get("bytes_since_enter", 0) > 0:
    state["notified"] = True
    continue
```

`bytes_since_enter` is maintained by the WS input handler in `resources/terminal.py`:
- Zeroed on `\r` or `\n` (Enter pressed).
- Zeroed on `Ctrl+C` (`\x03`) or `Ctrl+D` (`\x04`).
- Does not count escape sequences (`\x1b[...`) — arrow keys, F-keys, mouse events.
- Incremented on any other byte.

Scenario: you type `git commit -m "long message`, pause to think before closing the quote and hitting Enter. Without Rule 2, `idle_timeout` would elapse and you'd get an alert about a terminal that's actively in compose. With Rule 2, any pending character in the buffer **marks this state as ack'd** — you're engaged with this screen and already know about it. Only re-evaluates if the hash changes (= the agent did something new).

There's also the `POST /sessions/{id}/send-text` endpoint in `routes/terminal.py` that mirrors the same logic (compose drafts) — without it, a pre-populated draft without Enter would false-alert (fixed in v1.8.0).

### Rule 3 — Idle timeout not yet reached

```python
idle_seconds = now - last_output
if idle_seconds < idle_timeout:
    continue
```

`idle_timeout` comes from `get_idle_timeout()` in `resources/settings.py`. Valid range: 15-3600s (default 30s). Absolute minimum: 15s — anything below is clamped at runtime during `load_settings()` and persisted back into the JSON.

Why 15s minimum? Because that's `VIEWING_GRACE_SECONDS` for Rule 5 — if the timeout were lower than the grace window, the interaction would degenerate (the heartbeat could never suppress).

### Rule 4 — Eternal hash dedup

```python
if state["last_notified_hash"] == h:
    state["notified"] = True
    continue
```

No TTL: if we've ever alerted on exactly this hash (and the display returned to it after some change), don't re-alert. The way out of this "lock" is the agent changing the display (= a new idle phase for real), not the passage of time. Scenario: agent stopped at "`Continue?`"; you reply; agent works for 5s and parks back at the same visual prompt with a new message → **does not** fire a duplicate alert. If the agent makes any intermediate display change, the old `last_notified_hash` no longer matches and the next idle phase is evaluated normally.

### Rule 5 — Permanent ack if "I'm watching"

```python
last_viewing = sess.get("last_viewing_ts", 0)
if last_viewing > 0 and (now - last_viewing) < VIEWING_GRACE_SECONDS:
    state["notified"] = True
    continue
```

`VIEWING_GRACE_SECONDS = 15`. If the frontend sent a heartbeat in the last 15s, considers the user as watching the terminal **and marks this state as ack'd** — `notified=True`. When the user steps away, the session **stays suppressed** until the agent does something (= hash changes). Semantics: "you saw this state, you know about it, no need for a reminder while it's the same". If the agent really left the prompt and came back to the same one, Rule 4 covers via `last_notified_hash` (but in that case the alert had already fired or been ack'd before).

## Viewing heartbeat (frontend)

Implemented in `frontend/src/components/TerminalPane.jsx` (heartbeat + IntersectionObserver). The primary path goes through `NotificationsProvider.sendViewing()` on `/ws/notifications`, which accepts multiple clients. The terminal-exclusive WS still accepts `{type:'viewing'}` as a fallback.

### Local presence policies

Browsers don't expose "the user is physically looking at this monitor". Pulse can only combine the available signals: tab visibility, window focus, viewport intersection, and recent input activity.

- **Strict (default)**: `document.visibilityState === 'visible'`, `document.hasFocus()`, terminal in viewport, and activity in the last 30s.
- **Multi-monitor**: `document.visibilityState === 'visible'` and terminal in viewport. Useful when the dashboard sits open on another monitor while focus is in your editor.

The mode is a per-browser preference in `localStorage.rt:notify-presence-policy`, configurable in Settings → Notifications.

`lastUserActivityTs` is updated by global listeners on `mousemove`, `keydown`, `pointerdown`, `wheel`, `touchstart`. It's **module-level**, shared by every `<TerminalPane>` on the page — that means activity anywhere in the app (including sidebar, modal) counts as "user active".

`intersectingRef` is updated by an `IntersectionObserver` (threshold 0.1) observing the `<div ref={slotRef}>` where xterm renders.

### Synchronous IntersectionObserver bootstrap

Since v1.9.2, `intersectingRef` initializes as `false` (instead of the old optimistic `true`) and the effect reads `slot.getBoundingClientRect()` synchronously on mount to decide the initial value. This fixes a race that appeared when `<TerminalPane>` re-mounted after moving a terminal between groups:

- Old: `useRef(true)` → IO could fire its initial callback with `isIntersecting=false` if the slot had a zero rect (flex layout not consolidated yet), and stay stuck because the transition "zero rect → full rect" doesn't cross the 0.1 threshold.
- New: `useRef(false)` + `getBoundingClientRect()` on mount → if the slot already has height, considers it visible immediately; if not, waits for IO to fire normally.

Additionally, `sendHeartbeat()` reconciles every 10s — if `intersectingRef.current === false` but the slot has `rect > 0`, recovers the state. Cost: one `getBoundingClientRect` per 10s cycle when the ref is false. Trivial.

## terminalCache (module-level on the frontend)

`frontend/src/components/TerminalPane.jsx`:
```js
const terminalCache = new Map();
```

Key: `session.id` (composite `serverId::backendId`, stable across the entire session lifetime).

Value: `{ terminal, fitAddon, ws, container, onDataDisposable, resizeObserver, removeTouchHandlers }`.

**Why it exists**: `react-mosaic` re-mounts tiles aggressively (any reorganization of the tree unmounts and re-mounts the React tile). Without the cache, every layout change would close the WebSocket and recreate the xterm — losing scrollback, connection, and PTY state. The cache keeps the xterm instance + WS alive and re-attaches the container DOM in the new slot when `<TerminalPane>` re-mounts.

**Lifecycle implications**:
- WS survives remount → `bytes_since_enter`, `last_input_ts`, `last_enter_ts` all preserved (they're written by the WS input handler).
- Heartbeat **does not** survive unmount: the `setInterval` lives in `useEffect`, cleanup runs on unmount. On remount, a new interval is created.
- xterm and onData disposable: preserved.

**Invalidation points**:
- `destroyTerminal(id)` — closes the WS + disposes xterm + removes from the cache. Called on kill, session-ended, reconnect.
- `destroyAllTerminals()` — clears the entire Map. Called by the "Wifi" button in the sidebar (force reconnect).
- `destroyTerminalsByServerId(serverId)` — clears only terminals belonging to a specific server. Called when a server's connection fields change (host/port/apiKey).

## Configuration

### `data/settings.json` (on the client)

```json
{
  "telegram": { "bot_token": "...", "chat_id": "..." },
  "notifications": {
    "idle_timeout_seconds": 30,
    "channels": ["browser", "telegram"]
  },
  "editor": { "binary_override": "" }
}
```

- `idle_timeout_seconds`: range 15-3600. Auto-clamped on load (and persisted back).
- `channels`: subset of `["browser", "telegram"]`. Empty = no channels.
- Atomic write via `os.replace()` in `resources/settings.py`.

### `notify_on_idle` per-session

Lives in `sessions[session_id]["notify_on_idle"]` on the client (in-memory; lost on restart). Mutated by the `PATCH /sessions/{id}/notify` endpoint in `routes/terminal.py`, which also calls `reset_session_state(sid)` to clear both `_state[sid]` and `_pyte_screens[sid]` in the watcher.

(Before the PTY-direct rewrite, this flag lived in a tmux user option `@notify_on_idle__<INSTANCE_ID>` so it could survive a client restart. Without server-side persistence today, the frontend re-sends the flag via `/sessions/restore` when reopening sessions after a restart.)

### `last_viewing_ts` (in-memory, no persistence)

Lives in `sessions[session_id]["last_viewing_ts"]` on the client. Not persisted to disk — lost on every client restart. Not a problem: if the user is watching, the frontend repopulates it within ≤10s.

Since v1.9.2, also touched by `PATCH /sessions/{id}/group` (defense-in-depth — see gotcha #1 below).

## Edge cases & gotchas

### 1. Moving a terminal between groups

**Symptom fixed in v1.9.2:** moving a terminal from "No group" to "Test" caused a notification even with the terminal visible on screen after the move.

**Mechanism:** `frontend/src/app/(main)/page.js` filters sessions by the active `selectedGroupId`. When `s.group_id` changes, the terminal leaves `sessionsInSelectedGroup` for the current screen → `<TerminalPane>` unmounts → cleanup runs `clearInterval(id)` on the heartbeat. When the user switches to the destination group and clicks the terminal to open it, `<TerminalPane>` re-mounts, but `IntersectionObserver` could get stuck at `isIntersecting=false` (flex layout not consolidated at the mount commit).

**2-layer mitigation:**
- Frontend: synchronous bootstrap via `getBoundingClientRect()` on mount + reconciliation in `sendHeartbeat`.
- Backend: `assign_group` touches `last_viewing_ts = time.time()` on move, granting 15s of defensive grace.

### 2. IntersectionObserver remount race (general)

Any scenario where `<TerminalPane>` unmounts/remounts with the slot momentarily having no height (drag-resizing splits in react-mosaic, switching mosaic tabs, dynamic layouts) risks IO firing its initial callback with `false` and getting stuck. The reconciliation via `getBoundingClientRect` in `sendHeartbeat` (see above) covers it — but it's worth remembering this is an architectural fragility of `IntersectionObserver` in general, not specific to Pulse.

### 3. Multiple tabs in the same browser

Each tab is independent (per-tab UUID via `rt:tab-uuid` in sessionStorage — v1.9.0). Every `<TerminalPane>` in any tab that satisfies the local policy sends a heartbeat. **Natural backend dedup**: `last_viewing_ts` only stores the most recent timestamp, so any tab suppressing is enough.

For the inverse path (browser alert), the watcher includes `event_id` in the idle event. The frontend records that id in memory + `localStorage` and propagates via `BroadcastChannel`, preventing several tabs of the same browser from playing/showing the same notification.

### 4. WS replaced (code 4000)

The backend allows only 1 terminal WS per session (`_active_ws[session_id]` in `client/src/resources/terminal.py`). A new connection closes the old one with code 4000 "Replaced by new connection". Before, this also dropped the desktop's presence when a phone opened the same session. Now the primary heartbeat uses `/ws/notifications`, which is multi-client, so the old tab can keep proving presence even if the interactive terminal stream got replaced.

### 5. Compose drafts via `/send-text`

`POST /sessions/{id}/send-text` mirrors the input handler logic in `routes/terminal.py` over `bytes_since_enter`. Without it, a pre-populated draft without Enter (e.g. `git commit -m "..."` you want to review before sending) would false-alert. Fixed in v1.8.0.

### 6. Telegram blocking the event loop

`send_telegram_message` uses synchronous `urllib.request.urlopen` with a 10s timeout. If Telegram is slow, the Python event loop would freeze — every WebSocket would stall. Fixed in v1.8.0 by wrapping the call in `asyncio.to_thread`.

### 7. Capture without an external subprocess

With direct PTY, the watcher no longer depends on `tmux capture-pane` (which was a synchronous subprocess with a 3s timeout). The scrollback lives in a `bytearray` in memory inside `PTYSession`, and pyte renders in a CPU thread (~5ms per typical session). Eliminates the entire bug class around timeouts, slow forks, and tmux server flaps.

### 8. Watcher snapshot is a shallow copy

`monitored_snapshot = {sid: dict(sessions[sid])}` does a **shallow copy**. Sufficient because the fields read (`last_viewing_ts`, `last_resize_ts`, `bytes_since_enter`, etc.) are primitives. If you ever need to read a mutable sub-dict, you'll need `copy.deepcopy` — not the case today.

## Reference constants (with paths)

| Constant | Value | Where |
|---|---|---|
| `WATCHER_INTERVAL_SECONDS` | `5` | `client/src/resources/notifications.py` |
| `SNIPPET_MAX_LINES` | `20` | `client/src/resources/notifications.py` |
| `SNIPPET_MAX_CHARS` | `3500` | `client/src/resources/notifications.py` |
| `RESIZE_GRACE_SECONDS` | `5` | `client/src/resources/notifications.py` |
| `VIEWING_GRACE_SECONDS` | `15` | `client/src/resources/notifications.py` |
| `SCROLLBACK_BYTES` | `524288` | `client/src/tools/pty.py` |
| `TIMEOUT_MIN` | `15` | `client/src/resources/settings.py` |
| `TIMEOUT_MAX` | `3600` | `client/src/resources/settings.py` |
| `DEFAULT_TIMEOUT` | `30` | `client/src/resources/settings.py` |
| `VIEWING_HEARTBEAT_MS` | `10000` | `frontend/src/components/TerminalPane.jsx` |
| `USER_ACTIVITY_THRESHOLD_MS` | `30000` | `frontend/src/components/TerminalPane.jsx` |
| `rt:notify-presence-policy` | `strict`/`visible` | `frontend/src/providers/NotificationsProvider.jsx` |
| `EVENT_DEDUPE_TTL_MS` | `600000` | `frontend/src/providers/NotificationsProvider.jsx` |

## For future changes (checklist)

### Adding a new condition to the heartbeat (frontend)

1. Add the condition in `sendHeartbeat` in `TerminalPane.jsx` before `sendViewing`.
2. Consider whether the condition needs cleanup (e.g. a new global listener).
3. Update the "Local presence policies" section of this doc.

### Adding a new rule to the watcher (backend)

1. Place the new rule in `notifications.py` in the right order (rules that **only suppress** can come after rules that **reject outright**).
2. Decide: should it set `state["notified"] = True` (alert consumed) or not (alert just deferred)?
3. Document the rule here under "The 5 watcher rules" (updating to "The 6 rules", etc.).

### Changing `VIEWING_GRACE_SECONDS`

- Constraint: `VIEWING_GRACE_SECONDS >= VIEWING_HEARTBEAT_MS / 1000` (10s) with slack. Otherwise, network jitter between two consecutive heartbeats can make the watcher "forget" momentarily.
- Constraint: `TIMEOUT_MIN >= VIEWING_GRACE_SECONDS`. Both are currently 15s. If you raise the grace, raise `TIMEOUT_MIN` to match.

### Adding a new notification channel (e.g. Discord, Slack)

1. Add it to `VALID_CHANNELS` in `client/src/resources/settings.py`.
2. Implement `tools/<channel>.py` with `send_<channel>_message(creds, msg)`.
3. Add a branch in the watcher in `notifications.py`.
4. Update UI in `frontend/src/components/settings/NotificationsTab.jsx`.
5. Update i18n (`pt-BR.json`, `en.json`, `es.json`).

### Moving the heartbeat out of `<TerminalPane>`

Tempting: move the `setInterval` to a global hook that iterates `terminalCache` and sends `viewing` on every open WS, decoupling it from the React lifecycle.

**Careful**: `IntersectionObserver` needs a mounted DOM node to work. Without `<TerminalPane>` mounted, you can't tell if the terminal is "in the viewport". The "I'm watching" condition would degrade to "WS open + window focused + recent activity" — semantically different from today.

Current decision: keep detection inside the component (it depends on the mounted DOM), but send presence through the multi-client notifications WS so it doesn't depend on the terminal-exclusive WS.

## Verification checklist when changing the system

1. Reproduce the original bug scenario (terminal visible in "No group", move it to "Test", open it there, wait for idle): **MUST NOT NOTIFY**.
2. Reproduce "default watching": terminal visible, wait for idle: **MUST NOT NOTIFY**.
3. Reproduce multi-monitor: in `Multi-monitor` mode, Pulse visible on another monitor without focus, wait for idle: **MUST NOT NOTIFY**.
4. Reproduce "stepped away": minimize / switch tab / leave for another group, wait for idle: **MUST NOTIFY**.
5. Reproduce phone + desktop: open the same session on the phone while the desktop is visible, wait for idle: the desktop **MUST NOT** lose suppression because of code 4000.
6. Reproduce resize after alert: let a session alert, don't open/interact, resize / open on the phone: **MUST NOT NOTIFY AGAIN** just because of redraw/wrap.
7. Reproduce multiple tabs: two tabs of the same browser connected, generate 1 idle alert: **MUST PLAY/SHOW ONCE**.
8. Reproduce mid-composition: type a partial command without Enter, wait for idle: **MUST NOT NOTIFY**.
9. Reproduce dedup: agent alerts, you reply, agent returns to the same prompt: **MUST NOT NOTIFY AGAIN, EVER** (eternal hash dedup; only re-alerts if the agent moves to a different visual state).
10. Reproduce fresh enable: arm `notify_on_idle` on a dormant session: **MUST NOT NOTIFY until the next real PTY output**.

If any of these break, come back to this doc, identify which rule failed, and fix it.

import asyncio
import hashlib
import logging
import time

logger = logging.getLogger(__name__)

WATCHER_INTERVAL_SECONDS = 5
CAPTURE_LINES = 100
SNIPPET_MAX_LINES = 20
SNIPPET_MAX_CHARS = 3500

# Watcher state keyed by session id. Owned exclusively by notification_watcher()
# which runs as a single asyncio task, so no lock is required.
#
# Schema:
#   {
#     "hash":            <md5 digest of last observed capture-pane output>,
#     "last_output_ts":  <unix time of last hash change; 0 means "no output seen
#                         since state was created, so never alert">,
#     "notified":        <bool; latched True after one alert per idle streak,
#                         reset on the next hash change>,
#   }
_state = {}


def reset_session_state(session_id):
    _state.pop(session_id, None)


def _hash_content(content):
    return hashlib.md5(content.encode("utf-8", errors="replace")).digest()


def _html_escape(text):
    return (
        text.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
    )


def _format_pane_snippet(content):
    lines = [ln.rstrip() for ln in content.rstrip("\n").split("\n")]
    while lines and not lines[-1]:
        lines.pop()
    lines = lines[-SNIPPET_MAX_LINES:]
    text = "\n".join(lines)
    if len(text) > SNIPPET_MAX_CHARS:
        text = "…\n" + text[-SNIPPET_MAX_CHARS:]
    return text


def _compose_context(sess):
    parts = []
    project_name = sess.get("project_name")
    group_name = sess.get("group_name")
    name = sess.get("name") or sess.get("id")
    if project_name:
        parts.append(project_name)
    if group_name:
        parts.append(group_name)
    if name:
        parts.append(name)
    return " › ".join(parts) if parts else (name or "")


async def notification_watcher():
    from resources.terminal import sessions, _sessions_lock
    from resources.settings import get_telegram_raw, get_idle_timeout, get_channels
    from resources.notification_broadcast import broadcast
    from tools.tmux import capture_pane, get_notify_on_idle
    from tools.telegram import send_telegram_message

    logger.info("Notification watcher started")

    while True:
        try:
            await asyncio.sleep(WATCHER_INTERVAL_SECONDS)

            with _sessions_lock:
                candidate_ids = [sid for sid, s in sessions.items() if s.get("notify_on_idle")]
                monitored_snapshot = {sid: dict(sessions[sid]) for sid in candidate_ids}

            # Reconcile cached notify_on_idle with tmux @notify_on_idle (source
            # of truth). If another client instance sharing the same tmux
            # server flipped the toggle — or the user ran `tmux set-option -u`
            # manually — our cached dict is stale and would keep firing
            # alerts. Re-read per tick and drop stale-True entries, also
            # patching the cache so the sidebar sees reality on the next
            # GET /api/sessions.
            monitored_ids = []
            for sid in candidate_ids:
                if await asyncio.to_thread(get_notify_on_idle, sid):
                    monitored_ids.append(sid)
                else:
                    with _sessions_lock:
                        if sid in sessions:
                            sessions[sid]["notify_on_idle"] = False
                    monitored_snapshot.pop(sid, None)

            for sid in list(_state):
                if sid not in monitored_ids:
                    del _state[sid]

            if not monitored_ids:
                continue

            idle_timeout = get_idle_timeout()
            bot_token, chat_id = get_telegram_raw()
            channels = set(get_channels())
            now = time.time()

            for sid in monitored_ids:
                sess = monitored_snapshot.get(sid)
                if not sess:
                    continue

                # capture-pane is a blocking subprocess; offloaded to a worker
                # thread so N monitored sessions don't serialize on the event
                # loop.
                content = await asyncio.to_thread(capture_pane, sid, CAPTURE_LINES)
                if content is None:
                    continue

                h = _hash_content(content)
                state = _state.get(sid)

                if state is None:
                    # Fresh baseline. last_output_ts stays 0 until a *real*
                    # hash change is observed, so a dormant session that was
                    # just armed with notify_on_idle=True cannot false-alert
                    # before any output ever happens.
                    _state[sid] = {"hash": h, "last_output_ts": 0, "notified": False}
                    continue

                if h != state["hash"]:
                    state["hash"] = h
                    state["last_output_ts"] = now
                    state["notified"] = False
                    continue

                if state["notified"]:
                    continue

                last_output = state["last_output_ts"]

                # Rule 1: need at least one real hash change since the watcher
                # started observing this session. Covers the "just-enabled on a
                # silent session" case.
                if last_output <= 0:
                    continue

                # Rule 2: user is not mid-composition (typed without Enter).
                last_input = sess.get("last_input_ts", 0)
                last_enter = sess.get("last_enter_ts", 0)
                if last_input > last_enter:
                    continue

                # Rule 3: last input was before last output — i.e. the terminal
                # produced something AFTER the user's last keystroke (or the
                # user hasn't typed at all since enabling). Without this, a
                # user typing shortly after new output would look idle until
                # they press Enter.
                if last_input >= last_output:
                    continue

                # Rule 4: timeout elapsed since last output.
                idle_seconds = now - last_output
                if idle_seconds < idle_timeout:
                    continue

                name = sess.get("name", sid)
                context = _compose_context(sess)
                snippet = _format_pane_snippet(content)

                if "browser" in channels:
                    event = {
                        "type": "idle",
                        "session_id": sid,
                        "name": name,
                        "project_name": sess.get("project_name"),
                        "group_name": sess.get("group_name"),
                        "project_id": sess.get("project_id"),
                        "group_id": sess.get("group_id"),
                        "snippet": snippet,
                        "idle_seconds": int(idle_seconds),
                        "timestamp": int(now),
                    }
                    try:
                        await broadcast(event)
                    except Exception as exc:
                        logger.warning(f"Broadcast failed for {sid}: {exc}")

                if "telegram" in channels and bot_token and chat_id:
                    msg = (
                        f"⏸️ <b>{_html_escape(context)}</b> "
                        f"has been idle for {int(idle_seconds)}s"
                    )
                    if snippet:
                        msg += f"\n<pre>{_html_escape(snippet)}</pre>"
                    try:
                        ok, detail = send_telegram_message(bot_token, chat_id, msg)
                        if ok:
                            logger.info(f"Idle notification sent for {sid} after {int(idle_seconds)}s")
                        else:
                            logger.warning(f"Telegram notification failed for {sid}: {detail}")
                    except Exception as exc:
                        logger.warning(f"Telegram notification exception for {sid}: {exc}")

                state["notified"] = True
        except asyncio.CancelledError:
            logger.info("Notification watcher cancelled")
            break
        except Exception as exc:
            logger.error(f"Notification watcher error: {exc}")

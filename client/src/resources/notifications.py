import asyncio
import hashlib
import logging
import time

logger = logging.getLogger(__name__)

WATCHER_INTERVAL_SECONDS = 5
CAPTURE_LINES = 100
INPUT_IGNORE_WINDOW_SECONDS = 2.0
SNIPPET_MAX_LINES = 20
SNIPPET_MAX_CHARS = 3500

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


async def notification_watcher():
    from resources.terminal import sessions, _sessions_lock
    from resources.settings import get_telegram_raw, get_idle_timeout, get_channels
    from resources.notification_broadcast import broadcast
    from tools.tmux import capture_pane
    from tools.telegram import send_telegram_message

    logger.info("Notification watcher started")

    while True:
        try:
            await asyncio.sleep(WATCHER_INTERVAL_SECONDS)

            with _sessions_lock:
                monitored_snapshot = {
                    sid: dict(s) for sid, s in sessions.items() if s.get("notify_on_idle")
                }
            monitored_ids = list(monitored_snapshot.keys())

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

                content = capture_pane(sid, lines=CAPTURE_LINES)
                if content is None:
                    continue

                h = _hash_content(content)
                state = _state.get(sid)

                if state is None:
                    _state[sid] = {"hash": h, "last_activity_ts": now, "notified": False}
                    continue

                if h != state["hash"]:
                    state["hash"] = h
                    last_input = sess.get("last_input_ts", 0)
                    if last_input and (now - last_input) < INPUT_IGNORE_WINDOW_SECONDS:
                        continue
                    state["last_activity_ts"] = now
                    state["notified"] = False
                    continue

                if state["notified"]:
                    continue

                idle_seconds = now - state["last_activity_ts"]
                if idle_seconds < idle_timeout:
                    continue

                last_input = sess.get("last_input_ts", 0)
                last_enter = sess.get("last_enter_ts", 0)
                if last_input > last_enter:
                    continue

                name = sess.get("name", sid)
                snippet = _format_pane_snippet(content)

                if "browser" in channels:
                    event = {
                        "type": "idle",
                        "session_id": sid,
                        "name": name,
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
                        f"⏸️ <b>{_html_escape(name)}</b> "
                        f"(<code>{_html_escape(sid)}</code>) "
                        f"está aguardando há {int(idle_seconds)}s"
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

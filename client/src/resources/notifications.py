import asyncio
import hashlib
import logging
import re
import time

logger = logging.getLogger(__name__)

WATCHER_INTERVAL_SECONDS = 5
CAPTURE_LINES = 100
SNIPPET_MAX_LINES = 20
SNIPPET_MAX_CHARS = 3500
# Janela após a qual re-notificamos mesmo que a tela capturada seja bit-idêntica
# à já alertada. Evita spam do tipo "agente esperando input" que volta pro mesmo
# estado visual após cada resposta do user, mas ainda dá um lembrete se ficar
# parado na mesma tela por muito tempo.
NOTIFIED_HASH_TTL_SECONDS = 1800
# Janela de "tô olhando": se o frontend mandou heartbeat 'viewing' nos últimos
# N segundos, suprime alerta — o user está vendo o terminal, não precisa notif.
# Maior que o intervalo de heartbeat (10s) com folga pra absorver jitter de rede
# e re-mounts do react-mosaic durante drag/resize de painéis.
VIEWING_GRACE_SECONDS = 15
# Lines that are ONLY box-drawing border chars (plus surrounding whitespace)
# — the bare separator bars around agent input boxes.
_BORDER_ONLY_LINE_RE = re.compile(r"^\s*[─━═▀▄█]{2,}\s*$")
# Lines that START with a long run of border chars but also contain a
# label (e.g. Claude Code's `──────── fix-sessions-json-empty-install ─`).
# Visually in the Telegram <pre>, the many ─ before/after the label wrap
# into several "wall of dash" rows. We strip the border decoration and
# keep just the text inside.
_BORDER_DECORATED_LINE_RE = re.compile(r"^\s*[─━═▀▄█]{10,}")
# Any run of border chars (to replace with a single space when stripping).
_BORDER_RUN_RE = re.compile(r"[─━═▀▄█]+")


def _clean_snippet_line(line):
    """Drop or de-decorate a line for the notification snippet.

    Returns None if the line is pure borders and should be dropped.
    Returns the stripped text when the line has a border-decorated label
    (keeps the label, loses the bars). Returns the line unchanged otherwise.
    """
    if _BORDER_ONLY_LINE_RE.match(line):
        return None
    if _BORDER_DECORATED_LINE_RE.match(line):
        return _BORDER_RUN_RE.sub(" ", line).strip()
    return line

# Watcher state keyed by session id. Owned exclusively by notification_watcher()
# which runs as a single asyncio task, so no lock is required.
#
# Schema:
#   {
#     "hash":               <md5 digest of last observed capture-pane output>,
#     "last_output_ts":     <unix time of last hash change; 0 means "no output
#                            seen since state was created, so never alert">,
#     "notified":           <bool; latched True after one alert per idle streak,
#                            reset on the next hash change>,
#     "last_notified_hash": <md5 digest of the last capture we actually sent an
#                            alert for; used by Rule 4 to dedup repeated
#                            notifications when an agent parks at the same
#                            input prompt after each user response>,
#     "last_notified_ts":   <unix time of the last alert sent; paired with
#                            NOTIFIED_HASH_TTL_SECONDS to force a re-notify
#                            even on bit-identical captures after the TTL>,
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
    cleaned = []
    for ln in lines:
        out = _clean_snippet_line(ln)
        if out is None:
            continue
        cleaned.append(out)
    cleaned = cleaned[-SNIPPET_MAX_LINES:]
    text = "\n".join(cleaned)
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
    from tools.tmux import (
        capture_pane, get_notify_on_idle,
        get_project_name, get_group_name, get_custom_name,
    )
    from tools.telegram import send_telegram_message

    logger.info("Notification watcher started")

    while True:
        try:
            await asyncio.sleep(WATCHER_INTERVAL_SECONDS)

            with _sessions_lock:
                candidate_ids = [sid for sid, s in sessions.items() if s.get("notify_on_idle")]
                monitored_snapshot = {sid: dict(sessions[sid]) for sid in candidate_ids}

            # Reconcile cached notify_on_idle + scope names with the tmux
            # options (source of truth). If another client flipped the toggle,
            # or the frontend renamed a project/group but the PATCH failed on
            # this server (fire-and-forget), our cached dict is stale and the
            # notification shows the old label. Re-read per tick: cost is
            # ~4 subprocess calls per monitored session per 5s — trivial.
            monitored_ids = []
            for sid in candidate_ids:
                if not await asyncio.to_thread(get_notify_on_idle, sid):
                    with _sessions_lock:
                        if sid in sessions:
                            sessions[sid]["notify_on_idle"] = False
                    monitored_snapshot.pop(sid, None)
                    continue
                project_name = await asyncio.to_thread(get_project_name, sid)
                group_name = await asyncio.to_thread(get_group_name, sid)
                custom_name = await asyncio.to_thread(get_custom_name, sid)
                with _sessions_lock:
                    if sid in sessions:
                        sessions[sid]["project_name"] = project_name
                        sessions[sid]["group_name"] = group_name
                        if custom_name:
                            sessions[sid]["name"] = custom_name
                        monitored_snapshot[sid] = dict(sessions[sid])
                monitored_ids.append(sid)

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
                    _state[sid] = {
                        "hash": h,
                        "last_output_ts": 0,
                        "notified": False,
                        "last_notified_hash": None,
                        "last_notified_ts": 0,
                    }
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

                # Rule 2: user is not mid-composition. Based on an explicit
                # byte counter maintained by the WebSocket input handler
                # (zeroed on \r/\n, incremented on every other keystroke).
                # Replaces the previous timestamp-based heuristic
                # (last_input > last_enter) which had edge cases in TUIs
                # (pastes with embedded Enter, echo contaminating baseline).
                # Semântica: qualquer texto parcial no buffer suprime o alerta
                # até o usuário pressionar Enter (ou abandonar a sessão).
                if sess.get("bytes_since_enter", 0) > 0:
                    continue

                # Rule 3: timeout elapsed since last output.
                idle_seconds = now - last_output
                if idle_seconds < idle_timeout:
                    continue

                # Rule 4: dedup por hash do capture. Agentes (Claude Code,
                # Cursor) voltam pro mesmo estado visual após cada resposta
                # do user — sem isso, cada pergunta sucessiva gera um alerta
                # idêntico. Re-notificamos se passou NOTIFIED_HASH_TTL_SECONDS
                # desde o último envio com esse mesmo hash.
                if (state["last_notified_hash"] == h
                        and (now - state["last_notified_ts"]) < NOTIFIED_HASH_TTL_SECONDS):
                    state["notified"] = True
                    continue

                # Rule 5: usuário está vendo este terminal AGORA? Se o frontend
                # mandou heartbeat 'viewing' nos últimos VIEWING_GRACE_SECONDS,
                # suprime alerta — não marca notified=True, então quando o user
                # sair de cena, a próxima rodada já avalia normal.
                last_viewing = sess.get("last_viewing_ts", 0)
                if last_viewing > 0 and (now - last_viewing) < VIEWING_GRACE_SECONDS:
                    logger.debug(
                        "Idle notification suppressed for %s: viewing heartbeat %.1fs ago",
                        sid,
                        now - last_viewing,
                    )
                    continue

                name = sess.get("name", sid)
                context = _compose_context(sess)
                snippet = _format_pane_snippet(content)
                event_id = f"{sid}:{int(last_output)}:{h.hex()}"

                if "browser" in channels:
                    event = {
                        "type": "idle",
                        "event_id": event_id,
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
                        ok, detail = await asyncio.to_thread(send_telegram_message, bot_token, chat_id, msg)
                        if ok:
                            logger.info(f"Idle notification sent for {sid} after {int(idle_seconds)}s")
                        else:
                            logger.warning(f"Telegram notification failed for {sid}: {detail}")
                    except Exception as exc:
                        logger.warning(f"Telegram notification exception for {sid}: {exc}")

                last_viewing_age = int(now - last_viewing) if last_viewing > 0 else None
                logger.info(
                    "Idle notification emitted for %s after %ss (channels=%s, last_viewing_age=%s)",
                    sid,
                    int(idle_seconds),
                    ",".join(sorted(channels)) or "-",
                    last_viewing_age if last_viewing_age is not None else "-",
                )
                state["last_notified_hash"] = h
                state["last_notified_ts"] = now
                state["notified"] = True
        except asyncio.CancelledError:
            logger.info("Notification watcher cancelled")
            break
        except Exception as exc:
            logger.error(f"Notification watcher error: {exc}")

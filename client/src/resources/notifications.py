import asyncio
import hashlib
import logging
import threading
import time

import pyte

from tools.pty import get_pty

logger = logging.getLogger(__name__)

WATCHER_INTERVAL_SECONDS = 5
SNIPPET_MAX_LINES = 20
SNIPPET_MAX_CHARS = 3500
# Janela curta após resize: o pyte rerenderiza com a nova geometria e o hash
# muda mesmo sem mudança de conteúdo lógico (linhas se requebram em outras
# colunas). 5s cobre o reflow do TUI (vim/htop/Claude Code) sem segurar
# notificação real por muito tempo. Era 20s no tempo do tmux (que somava o
# jitter do redraw cosmético do multiplexer); sem tmux, o ruído some.
RESIZE_GRACE_SECONDS = 5
# Janela de "tô olhando": se o frontend mandou heartbeat 'viewing' nos últimos
# N segundos, considera o user vendo o terminal. Maior que o intervalo de
# heartbeat (10s) com folga pra absorver jitter de rede e re-mounts do
# react-mosaic durante drag/resize de painéis.
VIEWING_GRACE_SECONDS = 15


# Watcher state keyed by session id. Owned exclusively by notification_watcher()
# which runs as a single asyncio task, so no lock is required.
#
# Schema:
#   {
#     "hash":               <md5 digest of last observed pyte display>,
#     "last_output_ts":     <unix time of last hash change; 0 means "no output
#                            seen since state was created, so never alert">,
#     "notified":           <bool; latched True after the alert for this hash
#                            was either sent OR ack-ed by user (viewing/typing).
#                            Reset on the next hash change>,
#     "last_notified_hash": <md5 digest of the last hash we sent an alert for.
#                            Used by Rule 4 to dedupe repeated notifications
#                            when an agent parks at the same prompt after each
#                            user response — eternal dedup, no TTL>,
#   }
_state = {}
_state_lock = threading.Lock()

# Pyte screens cached per-session. Pyte mantém estado mutável e NÃO é
# thread-safe, mas só o watcher (single asyncio task) toca esse dict — feed
# via asyncio.to_thread roda sequencialmente dentro do mesmo tick. Sem lock.
_pyte_screens = {}


def reset_session_state(session_id):
    with _state_lock:
        _state.pop(session_id, None)
        _pyte_screens.pop(session_id, None)


def _hash_content(content):
    return hashlib.md5(content.encode("utf-8", errors="replace")).digest()


def _html_escape(text):
    return (
        text.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
    )


def _render_pane_via_pyte(pty_session):
    """Renderiza o estado visual do PTY usando pyte (terminal emulator).

    Faz full re-feed do scrollback a cada chamada — pyte processa em C-extension
    rapidamente (<5ms para ~512KB típicos). Devolve as linhas do display, sem
    ANSI/cursor/cores: só o texto que o usuário veria.

    Reusa o screen cache quando geometria não muda; recria em resize.
    """
    sid = pty_session.id
    cols, rows = pty_session.cols, pty_session.rows
    with _state_lock:
        cached = _pyte_screens.get(sid)
        if cached is None or cached[0].columns != cols or cached[0].lines != rows:
            screen = pyte.Screen(cols, rows)
            stream = pyte.ByteStream(screen)
            _pyte_screens[sid] = (screen, stream)
        else:
            screen, stream = cached
            screen.reset()
        raw = pty_session.get_scrollback_bytes()
        if raw:
            stream.feed(raw)
        return "\n".join(screen.display).rstrip()


def _history_line_to_str(line):
    # Pyte representa cada linha do histórico como StaticDefaultDict[col -> Char],
    # contendo só as colunas que receberam glyph (resto é vazio). values()
    # preserva ordem de inserção e o pyte sempre escreve da esquerda pra
    # direita, então join direto reconstrói o texto. Sem pad à direita —
    # rstrip já vem implícito por não haver espaços trailing armazenados.
    return "".join(ch.data for ch in line.values())


def _render_full_history_via_pyte(pty_session, max_lines):
    """Renderiza display + scrollback do PTY via pyte.HistoryScreen.

    Diferente de _render_pane_via_pyte (só viewport via pyte.Screen), este
    mantém um buffer de história e devolve history.top + display, truncado
    pelas últimas `max_lines` linhas. Espelha `tmux capture-pane -p -S -<N>`.

    Não reusa cache: cada captura é one-shot, o feed completo do scrollback
    custa ~5ms para os 512KB máximos do PTYSession.
    """
    cols, rows = pty_session.cols, pty_session.rows
    # 512KB de scrollback ≈ 6500 linhas a 80 col cheias; sobre-aloca pra
    # absorver picos de linhas curtas (prompts, output denso).
    history = max(max_lines, 12000)
    screen = pyte.HistoryScreen(cols, rows, history=history, ratio=0.5)
    stream = pyte.ByteStream(screen)
    raw = pty_session.get_scrollback_bytes()
    if raw:
        stream.feed(raw)
    top_lines = [_history_line_to_str(line).rstrip() for line in screen.history.top]
    visible_lines = [line.rstrip() for line in screen.display]
    all_lines = top_lines + visible_lines
    while all_lines and not all_lines[-1]:
        all_lines.pop()
    if max_lines and len(all_lines) > max_lines:
        all_lines = all_lines[-max_lines:]
    return "\n".join(all_lines)


def _format_pane_snippet(content):
    lines = [ln.rstrip() for ln in content.rstrip("\n").split("\n")]
    while lines and not lines[-1]:
        lines.pop()
    cleaned = lines[-SNIPPET_MAX_LINES:]
    text = "\n".join(cleaned)
    if len(text) > SNIPPET_MAX_CHARS:
        text = "…\n" + text[-SNIPPET_MAX_CHARS:]
    return text


def _compose_context(sess):
    # Sempre monta "{projeto} › {grupo} › {terminal}" — partes nunca omitidas.
    # O frontend grava labels legíveis na criação/move (default project name e
    # "No group" traduzido); os fallbacks abaixo cobrem só sessões legadas que
    # foram criadas antes deste contrato. Telegram não conhece idioma do
    # destinatário, então o fallback fica em inglês.
    project_name = sess.get("project_name") or "Default"
    group_name = sess.get("group_name") or "No group"
    name = sess.get("name") or sess.get("id") or ""
    return f"{project_name} › {group_name} › {name}"


async def notification_watcher():
    from resources.terminal import sessions, _sessions_lock
    from resources.settings import get_telegram_raw, get_idle_timeout, get_channels
    from resources.notification_broadcast import broadcast
    from tools.telegram import send_telegram_message

    logger.info("Notification watcher started")

    while True:
        try:
            await asyncio.sleep(WATCHER_INTERVAL_SECONDS)

            with _sessions_lock:
                monitored_ids = [sid for sid, s in sessions.items() if s.get("notify_on_idle")]
                monitored_snapshot = {sid: dict(sessions[sid]) for sid in monitored_ids}

            # Cleanup state/screens de sessões que saíram do monitoramento
            # (perderam notify_on_idle ou foram removidas).
            with _state_lock:
                for sid in list(_state):
                    if sid not in monitored_ids:
                        del _state[sid]
                for sid in list(_pyte_screens):
                    if sid not in monitored_ids:
                        del _pyte_screens[sid]

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

                pty_session = get_pty(sid)
                if pty_session is None or not pty_session.is_alive():
                    continue

                # Pyte feed é CPU-bound; offloaded a thread para não serializar
                # N sessões no event loop.
                content = await asyncio.to_thread(_render_pane_via_pyte, pty_session)
                if not content:
                    continue

                h = _hash_content(content)
                with _state_lock:
                    state = _state.get(sid)

                if state is None:
                    # Fresh baseline. last_output_ts stays 0 until a *real*
                    # hash change is observed, so a dormant session that was
                    # just armed with notify_on_idle=True cannot false-alert
                    # before any output ever happens.
                    with _state_lock:
                        _state[sid] = {
                            "hash": h,
                            "last_output_ts": 0,
                            "notified": False,
                            "last_notified_hash": None,
                        }
                    continue

                if h != state["hash"]:
                    state["hash"] = h
                    last_resize = sess.get("last_resize_ts", 0)
                    if (state["notified"] and last_resize > 0
                            and (now - last_resize) < RESIZE_GRACE_SECONDS):
                        logger.debug(
                            "Idle notification streak kept for %s: hash changed %.1fs after resize",
                            sid,
                            now - last_resize,
                        )
                        continue
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

                # Rule 2: user está digitando = engajou com o terminal nesse
                # estado. Considera ack permanente: marca notified=True. Só
                # re-avalia se o hash mudar (= agente fez algo novo). Apagar
                # tudo via Ctrl-C/D zera bytes_since_enter, mas notified
                # continua True — alinha com "user já sabe deste estado".
                if sess.get("bytes_since_enter", 0) > 0:
                    if not state["notified"]:
                        logger.debug("Idle ack via input for %s (mid-composition)", sid)
                    state["notified"] = True
                    continue

                # Rule 3: timeout elapsed since last output.
                idle_seconds = now - last_output
                if idle_seconds < idle_timeout:
                    continue

                # Rule 4: dedup eterno por hash. Agentes (Claude Code, Cursor)
                # voltam pro mesmo estado visual após cada resposta do user —
                # se já alertamos exatamente esse hash, não re-alerta. Sem TTL:
                # a saída desse "lock" é o agente mudar o display (nova fase
                # de idle), não passagem de tempo.
                if state["last_notified_hash"] == h:
                    state["notified"] = True
                    continue

                # Rule 5: user está vendo este terminal AGORA = ack permanente
                # deste estado. Marca notified=True; só re-avalia se o hash
                # mudar. Sair de cena sem o hash ter mudado = continua
                # suprimido (user já viu, sabe que tá parado aqui).
                last_viewing = sess.get("last_viewing_ts", 0)
                if last_viewing > 0 and (now - last_viewing) < VIEWING_GRACE_SECONDS:
                    if not state["notified"]:
                        logger.debug("Idle ack via viewing for %s", sid)
                    state["notified"] = True
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
                state["notified"] = True
        except asyncio.CancelledError:
            logger.info("Notification watcher cancelled")
            break
        except Exception as exc:
            logger.error(f"Notification watcher error: {exc}")

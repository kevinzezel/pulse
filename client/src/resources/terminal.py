import os
import asyncio
import json
import logging
import threading
import time
from datetime import datetime, timezone

from fastapi import WebSocket, WebSocketDisconnect

from envs.load import API_KEY
from tools.pty import (
    PTYSession,
    LISTENER_QUEUE_MAX,
    get_pty,
    get_main_loop,
    register_pty_if_absent,
    unregister_pty,
    list_pty_ids,
    count_ptys,
)

DEFAULT_PROJECT_ID = "proj-default"
from system.log import AppException

logger = logging.getLogger(__name__)

SESSION_PREFIX = "term"
SESSION_ENDED_CLOSE_CODE = 1000
SESSION_ENDED_CLOSE_REASON = "Session ended"
CLIENT_RESTART_CLOSE_CODE = 1012
CLIENT_RESTART_CLOSE_REASON = "Client restarting"

sessions = {}
_active_ws = {}
_counter = 0
_sessions_lock = threading.Lock()
_ws_locks: dict[str, asyncio.Lock] = {}
_ws_locks_lock = threading.Lock()
_client_shutting_down = threading.Event()


def mark_client_shutting_down():
    _client_shutting_down.set()


def is_client_shutting_down():
    return _client_shutting_down.is_set()


def _terminal_close_details():
    if is_client_shutting_down():
        return CLIENT_RESTART_CLOSE_CODE, CLIENT_RESTART_CLOSE_REASON
    return SESSION_ENDED_CLOSE_CODE, SESSION_ENDED_CLOSE_REASON


async def close_active_websockets_for_shutdown():
    mark_client_shutting_down()
    active = list(_active_ws.items())
    for sid, ws in active:
        try:
            await ws.close(code=CLIENT_RESTART_CLOSE_CODE, reason=CLIENT_RESTART_CLOSE_REASON)
        except Exception:
            pass
        logger.info("Closed WebSocket during client shutdown: %s", sid)
    # Encerra todas as PTYs registradas. PTY mode (post-v3.0) não persiste
    # cross-restart — recover_sessions é no-op — então deixar os processos
    # vivos só polui o cgroup do systemd (vide "Unit process X (bash) remains
    # running after unit stopped" nos logs pré-fix). PTYSession.close() é
    # idempotente: remove_reader → SIGHUP no pgroup → close fd → wait curto.
    for sid in list_pty_ids():
        pty = unregister_pty(sid)
        if pty is None:
            continue
        try:
            pty.close()
        except Exception:
            logger.warning("close_active_websockets_for_shutdown: PTY close failed for %s", sid, exc_info=True)
    with _sessions_lock:
        sessions.clear()


def _ws_lock(session_id):
    with _ws_locks_lock:
        lock = _ws_locks.get(session_id)
        if lock is None:
            lock = asyncio.Lock()
            _ws_locks[session_id] = lock
        return lock


def _drop_ws_lock(session_id):
    with _ws_locks_lock:
        _ws_locks.pop(session_id, None)


def _close_active_ws_soon(session_id, code, reason):
    ws = _active_ws.get(session_id)
    if ws is None:
        return
    loop = get_main_loop()
    if loop is None:
        return
    try:
        asyncio.run_coroutine_threadsafe(ws.close(code=code, reason=reason), loop)
    except RuntimeError:
        pass


def _next_id():
    global _counter
    with _sessions_lock:
        _counter += 1
        return f"{SESSION_PREFIX}-{_counter}"


def _bump_counter_from_id(sid):
    global _counter
    try:
        num = int(sid.split('-')[1])
        if num > _counter:
            _counter = num
    except (IndexError, ValueError):
        pass


def recover_sessions():
    # No-op com PTY direto: sem persistência cross-restart, sessões nascem
    # vazias quando o client sobe. O frontend mantém snapshot client-side dos
    # metadados (page.js getSessionsSnapshot) e chama /sessions/restore
    # automaticamente após reconectar — esse caminho recria as PTYs com mesmo
    # nome/grupo/projeto/cwd. Histórico do shell é perdido (esperado).
    logger.info("recover_sessions: PTY mode — starting with empty session table")


def create_session_request(payload):
    session_id = None
    pty_session = None
    name = None
    while True:
        session_id = _next_id()
        name = payload.get("name") or session_id
        cwd = payload.get("cwd")
        # Default new terminals to $HOME regardless of where the client process runs
        # (systemd/launchd spawn us under INSTALL_ROOT, which would otherwise leak
        # into every new session via inherited CWD).
        if not isinstance(cwd, str) or not cwd:
            cwd = os.path.expanduser("~")

        pty_session = PTYSession(session_id, start_directory=cwd)
        try:
            pty_session.start()
        except Exception:
            pty_session.close()
            raise
        if register_pty_if_absent(session_id, pty_session):
            break
        pty_session.close()
        logger.warning("create_session_request: generated colliding session id %s; retrying", session_id)

    group_id = payload.get("group_id")
    group_name = payload.get("group_name") or None
    project_id = payload.get("project_id") or DEFAULT_PROJECT_ID
    project_name = payload.get("project_name") or None

    now = datetime.now(timezone.utc).isoformat()
    with _sessions_lock:
        sessions[session_id] = {
            "id": session_id,
            "name": name,
            "created_at": now,
            "group_id": group_id,
            "group_name": group_name,
            "project_id": project_id,
            "project_name": project_name,
            "notify_on_idle": False,
            "bytes_since_enter": 0,
            "last_viewing_ts": 0,
            "last_resize_ts": 0,
            "cwd_at_start": cwd,
        }
        snapshot = dict(sessions[session_id])

    return {
        "status_code": 201,
        "content": {
            "detail_key": "success.session_created",
            "session": snapshot,
        }
    }


def restore_sessions_request(payload):
    items = payload.get("sessions") or []
    restored = []
    skipped = []
    failed = []

    for item in items:
        sid = item.get("id") if isinstance(item, dict) else None
        if not sid or not isinstance(sid, str) or not sid.startswith(f"{SESSION_PREFIX}-"):
            failed.append({"id": sid, "reason": "invalid_id"})
            continue
        if get_pty(sid) is not None:
            _bump_counter_from_id(sid)
            skipped.append({"id": sid, "reason": "already_exists"})
            continue
        try:
            cwd = item.get("cwd") if isinstance(item.get("cwd"), str) else None
            if not cwd:
                cwd = os.path.expanduser("~")
            pty_session = PTYSession(sid, start_directory=cwd)
            pty_session.start()
            if not register_pty_if_absent(sid, pty_session):
                pty_session.close()
                _bump_counter_from_id(sid)
                skipped.append({"id": sid, "reason": "already_exists"})
                continue
            name = item.get("name") or sid
            group_id = item.get("group_id")
            group_name = item.get("group_name") or None
            project_id = item.get("project_id") or DEFAULT_PROJECT_ID
            project_name = item.get("project_name") or None
            notify = bool(item.get("notify_on_idle"))
            created_at = item.get("created_at") or datetime.now(timezone.utc).isoformat()
            with _sessions_lock:
                sessions[sid] = {
                    "id": sid,
                    "name": name,
                    "created_at": created_at,
                    "group_id": group_id or None,
                    "group_name": group_name,
                    "project_id": project_id,
                    "project_name": project_name,
                    "notify_on_idle": notify,
                    "bytes_since_enter": 0,
                    "last_viewing_ts": 0,
                    "last_resize_ts": 0,
                    "cwd_at_start": cwd,
                }
                _bump_counter_from_id(sid)
                restored.append(dict(sessions[sid]))
        except Exception as exc:
            logger.warning(f"Failed to restore {sid}: {exc}")
            failed.append({"id": sid, "reason": "pty_error"})

    return {
        "status_code": 200,
        "content": {
            "detail_key": "success.sessions_restored",
            "detail_params": {"count": len(restored)},
            "restored": restored,
            "skipped": skipped,
            "failed": failed,
        },
    }


def list_sessions_request():
    with _sessions_lock:
        snapshot = [dict(s) for s in sessions.values()]
    for s in snapshot:
        pty = get_pty(s["id"])
        s["cwd"] = pty.get_cwd() if pty is not None else None
    return {
        "status_code": 200,
        "content": {
            "detail_key": "status.ok",
            "sessions": snapshot,
        }
    }


def rename_session_request(session_id, payload):
    name = payload["name"].strip()
    if not name:
        raise AppException(key="errors.empty_name", status_code=400)

    with _sessions_lock:
        if session_id not in sessions:
            raise AppException(key="errors.session_not_found", status_code=404)
        sessions[session_id]["name"] = name
        snapshot = dict(sessions[session_id])

    return {
        "status_code": 200,
        "content": {
            "detail_key": "success.session_renamed",
            "session": snapshot,
        }
    }


def clone_session_request(source_session_id):
    with _sessions_lock:
        if source_session_id not in sessions:
            raise AppException(key="errors.session_not_found", status_code=404)
        source_name = sessions[source_session_id]["name"]
        source_group_id = sessions[source_session_id].get("group_id")
        source_group_name = sessions[source_session_id].get("group_name")
        source_project_id = sessions[source_session_id].get("project_id") or DEFAULT_PROJECT_ID
        source_project_name = sessions[source_session_id].get("project_name")
        source_cwd_at_start = sessions[source_session_id].get("cwd_at_start")

    src_pty = get_pty(source_session_id)
    cwd = src_pty.get_cwd() if src_pty is not None else None
    if not cwd:
        cwd = source_cwd_at_start
    if not cwd:
        cwd = os.path.expanduser("~")

    while True:
        session_id = _next_id()
        name = f"{source_name} (clone)"
        pty_session = PTYSession(session_id, start_directory=cwd)
        try:
            pty_session.start()
        except Exception:
            pty_session.close()
            raise
        if register_pty_if_absent(session_id, pty_session):
            break
        pty_session.close()
        logger.warning("clone_session_request: generated colliding session id %s; retrying", session_id)

    now = datetime.now(timezone.utc).isoformat()
    with _sessions_lock:
        sessions[session_id] = {
            "id": session_id,
            "name": name,
            "created_at": now,
            "group_id": source_group_id,
            "group_name": source_group_name,
            "project_id": source_project_id,
            "project_name": source_project_name,
            "notify_on_idle": False,
            "bytes_since_enter": 0,
            "last_viewing_ts": 0,
            "last_resize_ts": 0,
            "cwd_at_start": cwd,
        }
        snapshot = dict(sessions[session_id])

    return {
        "status_code": 201,
        "content": {
            "detail_key": "success.session_cloned",
            "session": snapshot,
        }
    }


def set_session_scope_names_request(session_id, project_name=None, group_name=None):
    """Update the cached human-readable project/group labels for a session.

    Only the fields explicitly provided (not None) are updated; passing an
    empty string clears the field. Used by the frontend to propagate
    project/group renames down to the client without changing the IDs.
    """
    with _sessions_lock:
        if session_id not in sessions:
            raise AppException(key="errors.session_not_found", status_code=404)
        if project_name is not None:
            sessions[session_id]["project_name"] = project_name or None
        if group_name is not None:
            sessions[session_id]["group_name"] = group_name or None
        snapshot = dict(sessions[session_id])

    return {
        "status_code": 200,
        "content": {
            "detail_key": "success.session_scope_names_updated",
            "session": snapshot,
        },
    }


def set_session_notify_request(session_id, notify_on_idle):
    value = bool(notify_on_idle)
    with _sessions_lock:
        if session_id not in sessions:
            raise AppException(key="errors.session_not_found", status_code=404)
        sessions[session_id]["notify_on_idle"] = value
        snapshot = dict(sessions[session_id])

    from resources.notifications import reset_session_state
    reset_session_state(session_id)

    return {
        "status_code": 200,
        "content": {
            "detail_key": "success.session_notify_updated",
            "session": snapshot,
        },
    }


def record_session_viewing(session_id):
    with _sessions_lock:
        s = sessions.get(session_id)
        if s is None:
            return False
        s["last_viewing_ts"] = time.time()
        return True


def record_session_resize(session_id):
    with _sessions_lock:
        s = sessions.get(session_id)
        if s is None:
            return False
        s["last_resize_ts"] = time.time()
        return True


def kill_session_request(session_id):
    with _sessions_lock:
        if session_id not in sessions:
            raise AppException(key="errors.session_not_found", status_code=404)
        del sessions[session_id]

    _close_active_ws_soon(session_id, SESSION_ENDED_CLOSE_CODE, SESSION_ENDED_CLOSE_REASON)
    _drop_ws_lock(session_id)
    pty_session = unregister_pty(session_id)
    if pty_session is not None:
        pty_session.close()

    return {
        "status_code": 200,
        "content": {
            "detail_key": "success.session_closed"
        }
    }


def _drop_session(session_id):
    """Remove sessão completamente: dict + registry + lock + close da PTY.

    Usado pelo monitor de PTYs órfãs e pelo handler do WS quando o shell morre
    (EOF na leitura do PTY). Idempotente.
    """
    with _sessions_lock:
        sessions.pop(session_id, None)
    _drop_ws_lock(session_id)
    pty_session = unregister_pty(session_id)
    if pty_session is not None:
        pty_session.close()


async def reap_dead_ptys():
    """Tarefa de fundo: detecta shells que morreram com WS fechado.

    Quando o usuário fecha o frontend e depois faz Ctrl-D no shell em algum
    momento, ninguém estaria escutando — só o próximo `attach` perceberia
    via fd retornando b"". Esse loop garante limpeza periódica + propaga
    close 1000 ao WS se ainda houver um conectado.
    """
    INTERVAL = 30
    logger.info("PTY reaper started (interval=%ss)", INTERVAL)
    while True:
        try:
            await asyncio.sleep(INTERVAL)
            for sid in list_pty_ids():
                pty_session = get_pty(sid)
                if pty_session is None:
                    continue
                if pty_session.is_alive():
                    continue
                logger.info("PTY reaper: %s is dead, cleaning up", sid)
                ws = _active_ws.get(sid)
                if ws is not None:
                    try:
                        code, reason = _terminal_close_details()
                        await ws.close(code=code, reason=reason)
                    except Exception:
                        pass
                if not is_client_shutting_down():
                    _drop_session(sid)
        except asyncio.CancelledError:
            logger.info("PTY reaper cancelled")
            break
        except Exception as exc:
            logger.error(f"PTY reaper error: {exc}")


async def websocket_terminal(websocket: WebSocket, session_id: str):
    import hmac

    offered = websocket.scope.get("subprotocols", []) or []
    picked = next(
        (sp for sp in offered
         if sp.startswith("apikey.")
         and hmac.compare_digest(sp[len("apikey."):], API_KEY)),
        None,
    )
    if picked is None:
        await websocket.close(code=4401)
        return
    await websocket.accept(subprotocol=picked)

    with _sessions_lock:
        if session_id not in sessions:
            await websocket.close(code=4004, reason="Session not found")
            return
    pty_session = get_pty(session_id)
    if pty_session is None or not pty_session.is_alive():
        _drop_session(session_id)
        await websocket.close(code=4004, reason="Session not found")
        return

    async with _ws_lock(session_id):
        prev = _active_ws.pop(session_id, None)
        if prev is not None and prev is not websocket:
            try:
                await prev.close(code=4000, reason="Replaced by new connection")
            except Exception:
                pass
        _active_ws[session_id] = websocket

    # Bounded para que um terminal vomitando + WS lento não cresça a fila
    # indefinidamente. Em overflow o reader permanente do PTYSession faz
    # drop oldest; o scrollback (fonte da verdade) continua íntegro.
    output_queue: asyncio.Queue = asyncio.Queue(maxsize=LISTENER_QUEUE_MAX)
    send_task = None

    try:
        # Replay byte-perfect do scrollback acumulado: cores, cursor positioning
        # e ANSI inteiro são preservados (xterm.js processa direto).
        scrollback = pty_session.get_scrollback_bytes()
        if scrollback:
            await websocket.send_json({
                "type": "output",
                "data": scrollback.decode("utf-8", errors="replace"),
            })

        # O reader do master_fd vive dentro do PTYSession (instalado em
        # start()) e drena continuamente para o scrollback, independente de WS.
        # Aqui só registramos a fila para receber o output em tempo real.
        pty_session.attach_listener(output_queue)

        async def send_output():
            try:
                while True:
                    data = await output_queue.get()
                    if data is None:
                        # Shell morreu (EOF no PTY). WS fecha 1000 e a sessão
                        # é removida — frontend já trata "Session ended".
                        try:
                            code, reason = _terminal_close_details()
                            await websocket.close(code=code, reason=reason)
                        except Exception:
                            pass
                        if not is_client_shutting_down():
                            _drop_session(session_id)
                        break
                    await websocket.send_json({
                        "type": "output",
                        "data": data.decode("utf-8", errors="replace")
                    })
            except Exception:
                pass

        send_task = asyncio.create_task(send_output())

        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            msg_type = msg.get("type")
            if msg_type == "input":
                data = msg["data"]
                pty_session.write(data.encode("utf-8"))
                now_ts = time.time()
                pressed_enter = "\r" in data or "\n" in data
                # Escape sequences (arrow keys, mouse events, function keys,
                # touch scroll em mobile que manda `\x1b[<64;...M`) passam
                # pelo PTY mas NÃO alteram o buffer de composição visível.
                is_escape_seq = data.startswith("\x1b")
                # Ctrl-C (abort) / Ctrl-D (EOF) esvaziam a linha pendente
                # no shell — refletir isso no contador.
                clears_buffer = "\x03" in data or "\x04" in data
                with _sessions_lock:
                    s = sessions.get(session_id)
                    if s is not None:
                        s["last_input_ts"] = now_ts
                        if pressed_enter:
                            # Qualquer byte após o último \r ou \n é buffer
                            # novo (paste "cmd\nmore" → "more" fica pendente).
                            idx = max(data.rfind("\r"), data.rfind("\n"))
                            s["bytes_since_enter"] = len(data) - idx - 1
                            s["last_enter_ts"] = now_ts
                        elif clears_buffer:
                            s["bytes_since_enter"] = 0
                        elif is_escape_seq:
                            pass
                        else:
                            s["bytes_since_enter"] = s.get("bytes_since_enter", 0) + len(data)
            elif msg_type == "viewing":
                # Heartbeat de presença: o frontend manda enquanto o usuário
                # está vendo este terminal (aba visível, janela em foco,
                # terminal na viewport, mouse/teclado ativos). Suprime alerta
                # idle no watcher (Rule 5) durante a janela de grace.
                record_session_viewing(session_id)
            elif msg_type == "ping":
                # Probe de saúde do WS: o frontend dispara ping no
                # visibilitychange e num heartbeat de 30s pra detectar zumbis
                # (TCP morto sem FIN, comum no mobile após tab freezing e no
                # desktop após suspend/Wi-Fi flap). Sem isto, o `readyState`
                # mente "OPEN" e a reconexão automática nunca dispara.
                await websocket.send_json({"type": "pong"})
            elif msg_type == "resize":
                record_session_resize(session_id)
                pty_session.resize(msg["rows"], msg["cols"])
    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected: {session_id}")
    except RuntimeError as e:
        # Starlette >= 1.0 raises RuntimeError("WebSocket is not connected...")
        # when another task (send_output) closes the socket while we're awaiting
        # receive_text. That's a clean disconnect from our POV, not an error.
        if 'not connected' in str(e).lower():
            logger.info(f"WebSocket closed by server while receiving: {session_id}")
        else:
            logger.error(f"WebSocket error for {session_id}: {type(e).__name__}: {e}", exc_info=True)
    except Exception as e:
        logger.error(f"WebSocket error for {session_id}: {type(e).__name__}: {e}", exc_info=True)
    finally:
        async with _ws_lock(session_id):
            if _active_ws.get(session_id) is websocket:
                del _active_ws[session_id]
        # Desregistra a fila do PTYSession; o reader permanente continua
        # rodando e populando o scrollback até a sessão ser fechada.
        pty_session.detach_listener(output_queue)
        if send_task is not None:
            send_task.cancel()
        # Não fechar fd nem matar process — eles são da PTYSession e ela
        # continua viva entre conexões WS (esse é o ponto: frontend pode
        # reconectar sem perder estado).


def terminal_stats():
    with _sessions_lock:
        session_count = len(sessions)
    return {
        "sessions": session_count,
        "active_ws": len(_active_ws),
        "ptys": count_ptys(),
    }

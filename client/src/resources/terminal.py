import os
import asyncio
import json
import logging
import shlex
import signal
import subprocess
import threading
import time
from datetime import datetime, timezone

from fastapi import WebSocket, WebSocketDisconnect

from envs.load import API_KEY
from tools.tmux import (
    create_session, kill_session, list_sessions,
    attach_session, set_pty_size, session_exists,
    get_pane_cwd, set_custom_name, get_custom_name,
    get_group_id, set_group_id,
    get_project_id, set_project_id,
    get_group_name, set_group_name,
    get_project_name, set_project_name,
    get_notify_on_idle, set_notify_on_idle, migrate_notify_on_idle_legacy,
    ensure_tmux_config,
)

DEFAULT_PROJECT_ID = "proj-default"
from system.log import AppException

logger = logging.getLogger(__name__)

SESSION_PREFIX = "term"

sessions = {}
_active_ws = {}
_counter = 0
_sessions_lock = threading.Lock()
_ws_locks: dict[str, asyncio.Lock] = {}


def _ws_lock(session_id):
    lock = _ws_locks.get(session_id)
    if lock is None:
        lock = asyncio.Lock()
        _ws_locks[session_id] = lock
    return lock


def _next_id():
    global _counter
    with _sessions_lock:
        _counter += 1
        return f"{SESSION_PREFIX}-{_counter}"


def recover_sessions():
    global _counter
    ensure_tmux_config()
    tmux_sessions = list_sessions()
    with _sessions_lock:
        for s in tmux_sessions:
            sid = s["id"]
            if not sid.startswith(f"{SESSION_PREFIX}-"):
                continue
            try:
                created_at = datetime.fromtimestamp(int(s["created_ts"]), tz=timezone.utc).isoformat()
            except (ValueError, OSError):
                created_at = datetime.now(timezone.utc).isoformat()
            subprocess.run(['tmux', 'set-option', '-t', sid, 'status', 'off'], capture_output=True)
            migrate_notify_on_idle_legacy(sid)
            custom_name = get_custom_name(sid)
            raw_group_id = get_group_id(sid)
            raw_project_id = get_project_id(sid)
            if not raw_project_id:
                set_project_id(sid, DEFAULT_PROJECT_ID)
                raw_project_id = DEFAULT_PROJECT_ID
            sessions[sid] = {
                "id": sid,
                "name": custom_name or sid,
                "created_at": created_at,
                "group_id": raw_group_id or None,
                "group_name": get_group_name(sid),
                "project_id": raw_project_id,
                "project_name": get_project_name(sid),
                "notify_on_idle": get_notify_on_idle(sid),
                "bytes_since_enter": 0,
                "last_viewing_ts": 0,
            }
            try:
                num = int(sid.split('-')[1])
                if num > _counter:
                    _counter = num
            except (IndexError, ValueError):
                pass
    logger.info(f"Recovered {len(sessions)} existing tmux sessions")


def sync_sessions_request():
    global _counter
    tmux_sessions = list_sessions()
    tmux_ids = set()
    added = 0
    removed = 0

    with _sessions_lock:
        for s in tmux_sessions:
            sid = s["id"]
            tmux_ids.add(sid)
            if sid in sessions:
                continue
            try:
                created_at = datetime.fromtimestamp(int(s["created_ts"]), tz=timezone.utc).isoformat()
            except (ValueError, OSError):
                created_at = datetime.now(timezone.utc).isoformat()
            subprocess.run(['tmux', 'set-option', '-t', sid, 'status', 'off'], capture_output=True)
            migrate_notify_on_idle_legacy(sid)
            custom_name = get_custom_name(sid)
            raw_group_id = get_group_id(sid)
            raw_project_id = get_project_id(sid)
            if not raw_project_id:
                set_project_id(sid, DEFAULT_PROJECT_ID)
                raw_project_id = DEFAULT_PROJECT_ID
            sessions[sid] = {
                "id": sid,
                "name": custom_name or sid,
                "created_at": created_at,
                "group_id": raw_group_id or None,
                "group_name": get_group_name(sid),
                "project_id": raw_project_id,
                "project_name": get_project_name(sid),
                "notify_on_idle": get_notify_on_idle(sid),
                "bytes_since_enter": 0,
                "last_viewing_ts": 0,
            }
            if sid.startswith(f"{SESSION_PREFIX}-"):
                try:
                    num = int(sid.split('-')[1])
                    if num > _counter:
                        _counter = num
                except (IndexError, ValueError):
                    pass
            added += 1

        for sid in list(sessions):
            if sid not in tmux_ids:
                del sessions[sid]
                removed += 1

        sessions_snapshot = list(sessions.values())

    return {
        "status_code": 200,
        "content": {
            "detail_key": "status.sync_result",
            "detail_params": {"added": added, "removed": removed},
            "sessions": sessions_snapshot,
        }
    }


def create_session_request(payload):
    session_id = _next_id()
    name = payload.get("name") or session_id
    group_id = payload.get("group_id")
    group_name = payload.get("group_name") or None
    project_id = payload.get("project_id") or DEFAULT_PROJECT_ID
    project_name = payload.get("project_name") or None
    cwd = payload.get("cwd")
    # Default new terminals to $HOME regardless of where the client process runs
    # (systemd/launchd spawn us under INSTALL_ROOT, which would otherwise leak
    # into every new session via tmux's CWD inheritance).
    if not isinstance(cwd, str) or not cwd:
        cwd = os.path.expanduser("~")

    create_session(session_id, start_directory=cwd)

    if name != session_id:
        set_custom_name(session_id, name)

    if group_id is not None:
        set_group_id(session_id, group_id)
    if group_name is not None:
        set_group_name(session_id, group_name)

    set_project_id(session_id, project_id)
    if project_name is not None:
        set_project_name(session_id, project_name)

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
    global _counter
    items = payload.get("sessions") or []
    restored = []
    skipped = []
    failed = []

    for item in items:
        sid = item.get("id") if isinstance(item, dict) else None
        if not sid or not isinstance(sid, str) or not sid.startswith(f"{SESSION_PREFIX}-"):
            failed.append({"id": sid, "reason": "invalid_id"})
            continue
        if session_exists(sid):
            skipped.append({"id": sid, "reason": "already_exists"})
            continue
        try:
            cwd = item.get("cwd")
            create_session(sid, start_directory=cwd if isinstance(cwd, str) else None)
            name = item.get("name") or sid
            if name != sid:
                set_custom_name(sid, name)
            group_id = item.get("group_id")
            group_name = item.get("group_name") or None
            if group_id:
                set_group_id(sid, group_id)
            if group_name:
                set_group_name(sid, group_name)
            project_id = item.get("project_id") or DEFAULT_PROJECT_ID
            project_name = item.get("project_name") or None
            set_project_id(sid, project_id)
            if project_name:
                set_project_name(sid, project_name)
            if item.get("notify_on_idle"):
                set_notify_on_idle(sid, True)
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
                    "notify_on_idle": bool(item.get("notify_on_idle")),
                    "bytes_since_enter": 0,
                    "last_viewing_ts": 0,
                }
                try:
                    num = int(sid.split('-')[1])
                    if num > _counter:
                        _counter = num
                except (IndexError, ValueError):
                    pass
                restored.append(dict(sessions[sid]))
        except Exception as exc:
            logger.warning(f"Failed to restore {sid}: {exc}")
            failed.append({"id": sid, "reason": "tmux_error"})

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
        s["cwd"] = get_pane_cwd(s["id"])
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

    set_custom_name(session_id, name)

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
        if not session_exists(source_session_id):
            del sessions[source_session_id]
            raise AppException(key="errors.tmux_session_not_found", status_code=404)
        source_name = sessions[source_session_id]["name"]
        source_group_id = sessions[source_session_id].get("group_id")
        source_group_name = sessions[source_session_id].get("group_name")
        source_project_id = sessions[source_session_id].get("project_id") or DEFAULT_PROJECT_ID
        source_project_name = sessions[source_session_id].get("project_name")

    cwd = get_pane_cwd(source_session_id)

    session_id = _next_id()
    name = f"{source_name} (clone)"

    create_session(session_id)
    set_custom_name(session_id, name)

    if source_group_id:
        set_group_id(session_id, source_group_id)
    if source_group_name:
        set_group_name(session_id, source_group_name)

    set_project_id(session_id, source_project_id)
    if source_project_name:
        set_project_name(session_id, source_project_name)

    if cwd:
        subprocess.run(
            ['tmux', 'send-keys', '-t', session_id, f'cd {shlex.quote(cwd)}', 'Enter'],
            capture_output=True
        )

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
    empty string clears the option. Used by the frontend to propagate
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

    if project_name is not None:
        set_project_name(session_id, project_name)
    if group_name is not None:
        set_group_name(session_id, group_name)

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

    set_notify_on_idle(session_id, value)

    from resources.notifications import reset_session_state
    reset_session_state(session_id)

    return {
        "status_code": 200,
        "content": {
            "detail_key": "success.session_notify_updated",
            "session": snapshot,
        },
    }


def kill_session_request(session_id):
    with _sessions_lock:
        if session_id not in sessions:
            raise AppException(key="errors.session_not_found", status_code=404)
        del sessions[session_id]

    if session_exists(session_id):
        kill_session(session_id)

    return {
        "status_code": 200,
        "content": {
            "detail_key": "success.session_closed"
        }
    }


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
    if not session_exists(session_id):
        with _sessions_lock:
            sessions.pop(session_id, None)
        await websocket.close(code=4004, reason="tmux session not found")
        return

    async with _ws_lock(session_id):
        prev = _active_ws.pop(session_id, None)
        if prev is not None and prev is not websocket:
            try:
                await prev.close(code=4000, reason="Replaced by new connection")
            except Exception:
                pass
        _active_ws[session_id] = websocket

    loop = asyncio.get_event_loop()
    output_queue: asyncio.Queue = asyncio.Queue()
    process = None
    fd = None
    send_task = None
    reader_installed = False

    try:
        process, fd = attach_session(session_id)

        # Inject the pane's scrollback history into the xterm.js buffer before
        # streaming live output. Without this, xterm.js only sees the tmux
        # redraw of the current viewport on attach — anything that scrolled off
        # before the attach is unreachable by wheel/swipe (it lives in tmux's
        # pane history but never enters xterm.js's own scrollback). We capture
        # from -5000 up to -1 so the current viewport is excluded; the tmux
        # attach itself will repaint the viewport on top of what we just sent.
        try:
            hist = subprocess.run(
                ["tmux", "capture-pane", "-t", session_id, "-p", "-e", "-S", "-5000", "-E", "-1"],
                capture_output=True, text=True, check=False, timeout=3.0,
            )
            if hist.returncode == 0 and hist.stdout:
                history_text = hist.stdout.replace("\r\n", "\n").replace("\n", "\r\n")
                await websocket.send_json({
                    "type": "output",
                    "data": history_text,
                })
        except Exception as hist_err:
            logger.warning(f"[attach] history replay failed: {hist_err}")

        def on_pty_read():
            try:
                data = os.read(fd, 65536)
                if not data:
                    output_queue.put_nowait(None)
                    return
                output_queue.put_nowait(data)
            except OSError:
                output_queue.put_nowait(None)

        loop.add_reader(fd, on_pty_read)
        reader_installed = True

        async def send_output():
            try:
                while True:
                    data = await output_queue.get()
                    if data is None:
                        await websocket.close(code=1000, reason="Session ended")
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
                os.write(fd, data.encode("utf-8"))
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
                with _sessions_lock:
                    s = sessions.get(session_id)
                    if s is not None:
                        s["last_viewing_ts"] = time.time()
            elif msg_type == "resize":
                set_pty_size(fd, msg["rows"], msg["cols"])
                try:
                    os.kill(process.pid, signal.SIGWINCH)
                except OSError:
                    pass
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
        if reader_installed and fd is not None:
            try:
                loop.remove_reader(fd)
            except Exception:
                pass
        if send_task is not None:
            send_task.cancel()
        if fd is not None:
            try:
                os.close(fd)
            except OSError:
                pass
        if process is not None:
            if process.poll() is None:
                try:
                    process.terminate()
                except Exception:
                    pass
            loop.run_in_executor(None, process.wait)

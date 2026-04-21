import os
import shutil
import subprocess
import tempfile
import time

from fastapi import APIRouter, Body, WebSocket, WebSocketDisconnect, UploadFile, File, Request
from resources.terminal import create_session_request, list_sessions_request, kill_session_request, rename_session_request, sync_sessions_request, clone_session_request, websocket_terminal, sessions, set_session_notify_request, restore_sessions_request, _sessions_lock
from resources.notification_broadcast import register as register_notification_client, unregister as unregister_notification_client
from tools.tmux import get_pane_cwd, send_text_to_session, set_group_id
from system.log import AppException
from system.i18n import build_i18n_response
from envs.load import API_KEY

MAX_IMAGE_BYTES = 20 * 1024 * 1024
IMAGE_CHUNK_BYTES = 64 * 1024
IMAGE_TMP_MAX_AGE_SECONDS = 24 * 3600

router = APIRouter()
ws_router = APIRouter()


def _cleanup_old_clipboard_images():
    try:
        now = time.time()
        for entry in os.scandir('/tmp'):
            if not entry.name.endswith('.png'):
                continue
            try:
                if entry.is_file() and (now - entry.stat().st_mtime) > IMAGE_TMP_MAX_AGE_SECONDS:
                    os.unlink(entry.path)
            except OSError:
                pass
    except OSError:
        pass


@router.post("/sessions")
def create(
    request: Request,
    name: str = Body(None, max_length=50, embed=True),
    group_id: str | None = Body(None, embed=True),
    project_id: str | None = Body(None, embed=True, max_length=64),
    cwd: str | None = Body(None, embed=True, max_length=1024),
):
    resp = create_session_request({"name": name, "group_id": group_id, "project_id": project_id, "cwd": cwd})
    return build_i18n_response(request, resp["status_code"], resp["content"])


@router.get("/sessions")
def list_all(request: Request):
    resp = list_sessions_request()
    return build_i18n_response(request, resp["status_code"], resp["content"])


@router.post("/sessions/sync")
def sync(request: Request):
    resp = sync_sessions_request()
    return build_i18n_response(request, resp["status_code"], resp["content"])


@router.post("/sessions/restore")
def restore(request: Request, body: dict = Body(...)):
    items = body.get("sessions") if isinstance(body, dict) else None
    resp = restore_sessions_request({"sessions": items if isinstance(items, list) else []})
    return build_i18n_response(request, resp["status_code"], resp["content"])


@router.patch("/sessions/{session_id}")
def rename(request: Request, session_id: str, name: str = Body(..., max_length=50, embed=True)):
    resp = rename_session_request(session_id, {"name": name})
    return build_i18n_response(request, resp["status_code"], resp["content"])


@router.post("/sessions/{session_id}/clone")
def clone(request: Request, session_id: str):
    resp = clone_session_request(session_id)
    return build_i18n_response(request, resp["status_code"], resp["content"])


@router.delete("/sessions/{session_id}")
def kill(request: Request, session_id: str):
    resp = kill_session_request(session_id)
    return build_i18n_response(request, resp["status_code"], resp["content"])


@router.patch("/sessions/{session_id}/group")
def assign_group(
    request: Request,
    session_id: str,
    group_id: str | None = Body(None, embed=True, max_length=64),
):
    with _sessions_lock:
        if session_id not in sessions:
            raise AppException(key="errors.session_not_found", status_code=404)
        sessions[session_id]["group_id"] = group_id
        snapshot = dict(sessions[session_id])
    set_group_id(session_id, group_id)
    return build_i18n_response(request, 200, {
        "detail_key": "success.session_group_assigned",
        "session": snapshot,
    })


@router.patch("/sessions/{session_id}/notify")
def set_notify(
    request: Request,
    session_id: str,
    notify_on_idle: bool = Body(..., embed=True),
):
    resp = set_session_notify_request(session_id, notify_on_idle)
    return build_i18n_response(request, resp["status_code"], resp["content"])


@router.post("/sessions/{session_id}/send-text")
def send_text(
    request: Request,
    session_id: str,
    text: str = Body("", embed=True),
    send_enter: bool = Body(False, embed=True),
):
    with _sessions_lock:
        if session_id not in sessions:
            raise AppException(key="errors.session_not_found", status_code=404)
    send_text_to_session(session_id, text, send_enter)
    return build_i18n_response(request, 200, {"detail_key": "success.text_sent"})


@router.post("/clipboard/image")
async def clipboard_image(request: Request, image: UploadFile = File(...)):
    _cleanup_old_clipboard_images()
    tmp = tempfile.NamedTemporaryFile(suffix='.png', delete=False, dir='/tmp')
    total = 0
    try:
        while True:
            chunk = await image.read(IMAGE_CHUNK_BYTES)
            if not chunk:
                break
            total += len(chunk)
            if total > MAX_IMAGE_BYTES:
                tmp.close()
                try:
                    os.unlink(tmp.name)
                except OSError:
                    pass
                raise AppException(key="errors.image_too_large", status_code=413, params={"max_mb": MAX_IMAGE_BYTES // (1024 * 1024)})
            tmp.write(chunk)
    finally:
        tmp.close()
    return build_i18n_response(request, 200, {
        "detail_key": "success.image_saved",
        "path": tmp.name,
    })


@router.get("/sessions/{session_id}/cwd")
def get_cwd(request: Request, session_id: str):
    with _sessions_lock:
        if session_id not in sessions:
            raise AppException(key="errors.session_not_found", status_code=404)
    cwd = get_pane_cwd(session_id)
    if not cwd:
        raise AppException(key="errors.cwd_unavailable", status_code=500)
    return build_i18n_response(request, 200, {"detail_key": "status.ok", "cwd": cwd})


VSCODE_FALLBACK_BINARIES = (
    "/usr/bin/code",
    "/snap/bin/code",
    "/usr/share/code/code",
    "/opt/visual-studio-code/code",
    "/var/lib/flatpak/exports/bin/com.visualstudio.code",
)


def _resolve_vscode_binary(env):
    path = shutil.which("code", path=env.get("PATH"))
    if path:
        return path
    for candidate in VSCODE_FALLBACK_BINARIES:
        if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
    return None


@router.post("/sessions/{session_id}/open-editor")
def open_editor(request: Request, session_id: str):
    with _sessions_lock:
        if session_id not in sessions:
            raise AppException(key="errors.session_not_found", status_code=404)
    cwd = get_pane_cwd(session_id)
    if not cwd:
        raise AppException(key="errors.cwd_unavailable", status_code=500)

    env = os.environ.copy()
    ipc = env.get("VSCODE_IPC_HOOK_CLI")
    inside_vscode = bool(ipc) and os.path.exists(ipc)

    if not inside_vscode:
        if not env.get("DISPLAY") and not env.get("WAYLAND_DISPLAY"):
            env["DISPLAY"] = ":0"
        if not env.get("XDG_RUNTIME_DIR"):
            env["XDG_RUNTIME_DIR"] = f"/run/user/{os.getuid()}"

    binary = _resolve_vscode_binary(env)
    if not binary:
        raise AppException(key="errors.editor_binary_not_found", status_code=500)

    subprocess.Popen([binary, cwd], env=env, start_new_session=True,
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return build_i18n_response(request, 200, {
        "detail_key": "success.editor_opened",
        "cwd": cwd,
    })


@ws_router.websocket("/ws/notifications")
async def ws_notifications(websocket: WebSocket):
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

    await register_notification_client(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        await unregister_notification_client(websocket)


@ws_router.websocket("/ws/{session_id}")
async def ws_terminal(websocket: WebSocket, session_id: str):
    await websocket_terminal(websocket, session_id)

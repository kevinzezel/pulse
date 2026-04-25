import logging
import json
import os
import shutil
import subprocess
import tempfile
import time

from fastapi import APIRouter, Body, WebSocket, WebSocketDisconnect, UploadFile, File, Request, Query

logger = logging.getLogger(__name__)
from resources.terminal import create_session_request, list_sessions_request, kill_session_request, rename_session_request, clone_session_request, websocket_terminal, sessions, set_session_notify_request, set_session_scope_names_request, restore_sessions_request, record_session_viewing, _sessions_lock
from resources.notification_broadcast import register as register_notification_client, unregister as unregister_notification_client
from resources.notifications import _render_full_history_via_pyte
from tools.pty import get_pty
from system.log import AppException
from system.i18n import build_i18n_response
from envs.load import API_KEY

MAX_IMAGE_BYTES = 20 * 1024 * 1024
IMAGE_CHUNK_BYTES = 64 * 1024
IMAGE_TMP_MAX_AGE_SECONDS = 24 * 3600

router = APIRouter()
ws_router = APIRouter()
NOTIFICATIONS_WS_MAX_MESSAGE_BYTES = 1024
SESSION_ID_MAX_LENGTH = 64


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
    group_name: str | None = Body(None, embed=True, max_length=64),
    project_id: str | None = Body(None, embed=True, max_length=64),
    project_name: str | None = Body(None, embed=True, max_length=64),
    cwd: str | None = Body(None, embed=True, max_length=1024),
):
    resp = create_session_request({
        "name": name,
        "group_id": group_id,
        "group_name": group_name,
        "project_id": project_id,
        "project_name": project_name,
        "cwd": cwd,
    })
    return build_i18n_response(request, resp["status_code"], resp["content"])


@router.get("/sessions")
def list_all(request: Request):
    resp = list_sessions_request()
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
    group_name: str | None = Body(None, embed=True, max_length=64),
):
    with _sessions_lock:
        if session_id not in sessions:
            raise AppException(key="errors.session_not_found", status_code=404)
        sessions[session_id]["group_id"] = group_id
        sessions[session_id]["group_name"] = group_name or None
        # Defense-in-depth contra Rule 5: mover terminal entre grupos no
        # frontend desmonta o <TerminalPane> e interrompe o heartbeat de
        # viewing por uma janela de até alguns segundos (até o user trocar
        # pro novo grupo e o componente remontar). Tocar last_viewing_ts aqui
        # garante grace de 15s no watcher para essa janela, mesmo se algum
        # timing edge case do IntersectionObserver no remount voltar a
        # quebrar no futuro.
        sessions[session_id]["last_viewing_ts"] = time.time()
        snapshot = dict(sessions[session_id])
    return build_i18n_response(request, 200, {
        "detail_key": "success.session_group_assigned",
        "session": snapshot,
    })


@router.patch("/sessions/{session_id}/scope-names")
def update_scope_names(
    request: Request,
    session_id: str,
    project_name: str | None = Body(None, embed=True, max_length=64),
    group_name: str | None = Body(None, embed=True, max_length=64),
):
    resp = set_session_scope_names_request(
        session_id,
        project_name=project_name,
        group_name=group_name,
    )
    return build_i18n_response(request, resp["status_code"], resp["content"])


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
    pty = get_pty(session_id)
    if pty is None:
        raise AppException(key="errors.session_not_found", status_code=404)
    payload = (text or "").encode("utf-8")
    if send_enter:
        payload += b"\r"
    if payload:
        pty.write(payload)
    # Espelha o handler do WS de input: texto enviado via compose também conta
    # como "atividade" para o watcher de idle. Sem isso, um draft pré-populado
    # sem Enter dispara alerta falso.
    now_ts = time.time()
    with _sessions_lock:
        s = sessions.get(session_id)
        if s is not None:
            s["last_input_ts"] = now_ts
            if send_enter:
                s["bytes_since_enter"] = 0
                s["last_enter_ts"] = now_ts
            else:
                s["bytes_since_enter"] = s.get("bytes_since_enter", 0) + len(text or "")
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
    pty = get_pty(session_id)
    cwd = pty.get_cwd() if pty is not None else None
    if not cwd:
        raise AppException(key="errors.cwd_unavailable", status_code=500)
    return build_i18n_response(request, 200, {"detail_key": "status.ok", "cwd": cwd})


CAPTURE_LINES_DEFAULT = 5000
CAPTURE_LINES_MAX = 50000


@router.get("/sessions/{session_id}/capture")
def capture_session(request: Request, session_id: str, lines: int = CAPTURE_LINES_DEFAULT):
    # Returns the pane's text buffer (rendered via pyte) as plain UTF-8. The
    # frontend renders this in a modal with a plain textarea so users can
    # select/search/copy without fighting xterm's own selection engine —
    # especially helpful on mobile and inside alt-screen apps (Claude Code,
    # less, vim) where xterm's text selection is fragile.
    with _sessions_lock:
        if session_id not in sessions:
            raise AppException(key="errors.session_not_found", status_code=404)
    try:
        lines_i = max(1, min(CAPTURE_LINES_MAX, int(lines)))
    except (TypeError, ValueError):
        lines_i = CAPTURE_LINES_DEFAULT
    pty = get_pty(session_id)
    if pty is None:
        raise AppException(key="errors.session_not_found", status_code=404)
    text = _render_full_history_via_pyte(pty, lines_i)
    return build_i18n_response(request, 200, {
        "detail_key": "status.ok",
        "text": text,
        "lines": lines_i,
    })


EDITOR_FALLBACK_BINARIES = (
    # Linux — most common distro installs and Flatpak/Snap.
    "/usr/bin/code",
    "/snap/bin/code",
    "/usr/share/code/code",
    "/opt/visual-studio-code/code",
    "/var/lib/flatpak/exports/bin/com.visualstudio.code",
    # macOS — VSCode, VSCode Insiders, Cursor, VSCodium.
    # Each app ships a CLI wrapper at <App>/Contents/Resources/app/bin/<binary>.
    "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
    "/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code",
    "/Applications/Cursor.app/Contents/Resources/app/bin/cursor",
    "/Applications/Cursor.app/Contents/Resources/app/bin/code",
    "/Applications/VSCodium.app/Contents/Resources/app/bin/codium",
    "/Applications/Windsurf.app/Contents/Resources/app/bin/windsurf",
    # macOS — brew cask symlinks (when the user ran `Shell Command: Install 'code' command in PATH`).
    "/opt/homebrew/bin/code",
    "/usr/local/bin/code",
    "/opt/homebrew/bin/cursor",
    "/usr/local/bin/cursor",
)

# Common PATH names for editor CLIs — checked via shutil.which before the fallback list.
EDITOR_PATH_NAMES = ("code", "cursor", "codium", "code-insiders", "windsurf")

# Editores da família VS Code onde a flag -n significa "nova janela". Vim,
# Neovim, Emacs e afins usam -n com outra semântica (nvim -n = no swapfile),
# então aplicar -n neles quebra a abertura. Só injetamos -n quando o binário
# resolvido casa com esta lista.
_NEW_WINDOW_SAFE_NAMES = (
    "code", "cursor", "codium", "code-insiders", "windsurf",
    "code-oss", "vscodium",
)


def _supports_new_window_flag(binary):
    name = os.path.basename(binary).lower()
    # Remove extensão (.exe no Windows, .cmd, etc.) antes de comparar.
    base = name.rsplit(".", 1)[0] if "." in name else name
    return base in _NEW_WINDOW_SAFE_NAMES

_GUI_ENV_KEYS = (
    "DISPLAY", "WAYLAND_DISPLAY", "XAUTHORITY",
    "DBUS_SESSION_BUS_ADDRESS", "XDG_RUNTIME_DIR",
    "XDG_SESSION_TYPE", "XDG_CURRENT_DESKTOP",
)


def _import_from_user_manager(env):
    # If pulse-client.service started before the graphical session (linger
    # boot), ExecStartPre's `systemctl --user import-environment` had nothing
    # to pull from the user manager and the service inherited a GUI-less env.
    # Once the user logs in, PAM populates the user manager. Re-query it at
    # click time so the spawned editor sees DISPLAY/XAUTHORITY/etc from the
    # currently active graphical session instead of the (wrong) `:0` fallback.
    try:
        out = subprocess.run(
            ["systemctl", "--user", "show-environment"],
            capture_output=True, text=True, timeout=2.0, check=False,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return
    if out.returncode != 0:
        return
    for line in out.stdout.splitlines():
        if "=" not in line:
            continue
        k, v = line.split("=", 1)
        if k in _GUI_ENV_KEYS and v and k not in env:
            env[k] = v


def _resolve_vscode_binary(env):
    # 1. User override from settings wins, if it points to an executable.
    from resources.settings import get_editor_override
    override = get_editor_override()
    if override:
        if os.path.isfile(override) and os.access(override, os.X_OK):
            return override
        # Fall through to auto-detect if the override is broken — the user
        # gets a clear error anyway, and an older stale path shouldn't block
        # a freshly-installed editor.

    # 2. Any known editor CLI on PATH.
    for name in EDITOR_PATH_NAMES:
        path = shutil.which(name, path=env.get("PATH"))
        if path:
            return path

    # 3. Known absolute install paths across distros and macOS.
    for candidate in EDITOR_FALLBACK_BINARIES:
        if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate

    return None


@router.post("/sessions/{session_id}/open-editor")
def open_editor(
    request: Request,
    session_id: str,
    new_window: bool = Query(
        False,
        description=(
            "Se true, chama o binário com -n pra forçar nova janela. "
            "Usado pelo 'abrir todos do grupo' — sem isso, a 2ª+ chamada "
            "é interceptada pelo single-instance lock do VS Code/Cursor e "
            "silenciosamente descartada."
        ),
    ),
):
    with _sessions_lock:
        if session_id not in sessions:
            raise AppException(key="errors.session_not_found", status_code=404)
    pty = get_pty(session_id)
    cwd = pty.get_cwd() if pty is not None else None
    if not cwd:
        raise AppException(key="errors.cwd_unavailable", status_code=500)

    env = os.environ.copy()
    ipc = env.get("VSCODE_IPC_HOOK_CLI")
    inside_vscode = bool(ipc) and os.path.exists(ipc)

    if not inside_vscode:
        _import_from_user_manager(env)
        uid = os.getuid()
        # DISPLAY / WAYLAND_DISPLAY: prefer Wayland when a compositor socket exists,
        # fall back to X11 :0 (the convention for single-seat systems).
        if not env.get("DISPLAY") and not env.get("WAYLAND_DISPLAY"):
            if os.path.exists(f"/run/user/{uid}/wayland-0"):
                env["WAYLAND_DISPLAY"] = "wayland-0"
            else:
                env["DISPLAY"] = ":0"
        if not env.get("XDG_RUNTIME_DIR"):
            env["XDG_RUNTIME_DIR"] = f"/run/user/{uid}"
        # D-Bus user session bus — Electron/VSCode uses it for single-instance IPC,
        # secret-service, shell inhibitors. systemd-user always exposes it at
        # /run/user/<uid>/bus when a graphical session is active.
        if not env.get("DBUS_SESSION_BUS_ADDRESS"):
            dbus_sock = f"/run/user/{uid}/bus"
            if os.path.exists(dbus_sock):
                env["DBUS_SESSION_BUS_ADDRESS"] = f"unix:path={dbus_sock}"
        # XAUTHORITY — X server rejects MIT-MAGIC-COOKIE connections without it.
        # GDM stashes in /run/user/<uid>/gdm/Xauthority; most others use ~/.Xauthority.
        if not env.get("XAUTHORITY"):
            home = os.environ.get("HOME", "")
            for cand in (f"/run/user/{uid}/gdm/Xauthority",
                         f"{home}/.Xauthority" if home else ""):
                if cand and os.path.exists(cand):
                    env["XAUTHORITY"] = cand
                    break

    binary = _resolve_vscode_binary(env)
    if not binary:
        raise AppException(key="errors.editor_binary_not_found", status_code=500)

    # Log the GUI env state so future "button does nothing" reports can be
    # diagnosed from `journalctl --user -u pulse-client.service` without repro.
    logger.info(
        "launching editor: binary=%s cwd=%s new_window=%s DISPLAY=%s WAYLAND_DISPLAY=%s "
        "DBUS=%s XAUTHORITY=%s XDG_RUNTIME_DIR=%s",
        binary, cwd, new_window,
        env.get("DISPLAY") or "-",
        env.get("WAYLAND_DISPLAY") or "-",
        "set" if env.get("DBUS_SESSION_BUS_ADDRESS") else "-",
        "set" if env.get("XAUTHORITY") else "-",
        env.get("XDG_RUNTIME_DIR") or "-",
    )
    if new_window and _supports_new_window_flag(binary):
        cmd = [binary, "-n", cwd]
    else:
        cmd = [binary, cwd]
    subprocess.Popen(cmd, env=env, start_new_session=True,
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
            raw = await websocket.receive_text()
            if len(raw.encode("utf-8", errors="ignore")) > NOTIFICATIONS_WS_MAX_MESSAGE_BYTES:
                await websocket.close(code=1009)
                break
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if not isinstance(msg, dict):
                continue
            if msg.get("type") != "viewing":
                continue
            session_id = msg.get("session_id")
            if not isinstance(session_id, str) or len(session_id) > SESSION_ID_MAX_LENGTH:
                continue
            record_session_viewing(session_id)
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        await unregister_notification_client(websocket)


@ws_router.websocket("/ws/{session_id}")
async def ws_terminal(websocket: WebSocket, session_id: str):
    await websocket_terminal(websocket, session_id)

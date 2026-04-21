from fastapi import APIRouter, Body, Request

import os
import shutil

from resources.settings import (
    get_public_settings,
    get_telegram_raw,
    update_telegram,
    update_notifications,
    update_editor,
)
from routes.terminal import EDITOR_FALLBACK_BINARIES, EDITOR_PATH_NAMES
from tools.telegram import send_telegram_message, get_telegram_updates, extract_latest_chat_id
from system.log import AppException
from system.i18n import build_i18n_response

router = APIRouter()


@router.get("/settings")
def get_settings(request: Request):
    return build_i18n_response(request, 200, {
        "detail_key": "status.ok",
        "settings": get_public_settings(),
    })


@router.put("/settings/telegram")
def put_telegram(
    request: Request,
    bot_token: str | None = Body(None, embed=True),
    chat_id: str | None = Body(None, embed=True),
):
    update_telegram(bot_token, chat_id)
    return build_i18n_response(request, 200, {
        "detail_key": "success.settings_updated",
        "settings": get_public_settings(),
    })


@router.put("/settings/notifications")
def put_notifications(
    request: Request,
    idle_timeout_seconds: int | None = Body(None, embed=True),
    channels: list[str] | None = Body(None, embed=True),
):
    update_notifications(idle_timeout_seconds=idle_timeout_seconds, channels=channels)
    return build_i18n_response(request, 200, {
        "detail_key": "success.settings_updated",
        "settings": get_public_settings(),
    })


@router.put("/settings/editor")
def put_editor(
    request: Request,
    binary_override: str | None = Body(None, embed=True),
):
    # Validate the path if provided — empty string means "clear the override".
    cleaned = (binary_override or "").strip()
    if cleaned:
        if not os.path.isfile(cleaned):
            raise AppException(key="errors.editor_binary_not_found", status_code=400, params={"path": cleaned})
        if not os.access(cleaned, os.X_OK):
            raise AppException(key="errors.editor_binary_not_executable", status_code=400, params={"path": cleaned})
    update_editor(binary_override=cleaned)
    return build_i18n_response(request, 200, {
        "detail_key": "success.settings_updated",
        "settings": get_public_settings(),
    })


@router.post("/settings/editor/resolve")
def resolve_editor(request: Request):
    # Dry-run of _resolve_vscode_binary — tells the user which path would be
    # used right now (override if set, else PATH lookup, else absolute fallbacks)
    # without actually spawning the editor.
    from resources.settings import get_editor_override
    override = get_editor_override()
    resolved = None
    source = None
    if override and os.path.isfile(override) and os.access(override, os.X_OK):
        resolved, source = override, "override"
    else:
        env_path = os.environ.get("PATH", "")
        for name in EDITOR_PATH_NAMES:
            found = shutil.which(name, path=env_path)
            if found:
                resolved, source = found, "path"
                break
        if not resolved:
            for candidate in EDITOR_FALLBACK_BINARIES:
                if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
                    resolved, source = candidate, "fallback"
                    break
    if not resolved:
        raise AppException(key="errors.editor_binary_not_found", status_code=404)
    return build_i18n_response(request, 200, {
        "detail_key": "status.ok",
        "resolved": resolved,
        "source": source,           # "override" | "path" | "fallback"
        "override_broken": bool(override) and source != "override",
    })


@router.post("/settings/telegram/test")
def test_telegram(request: Request):
    bot_token, chat_id = get_telegram_raw()
    if not bot_token or not chat_id:
        raise AppException(key="errors.telegram_not_configured", status_code=400)

    ok, detail = send_telegram_message(
        bot_token,
        chat_id,
        "🔔 <b>Pulse</b> — teste de notificação",
    )
    if not ok:
        raise AppException(
            key="errors.telegram_send_failed",
            status_code=502,
            params={"detail": detail},
        )
    return build_i18n_response(request, 200, {"detail_key": "success.telegram_test_sent"})


@router.post("/settings/telegram/discover-chat-id")
def discover_chat_id(
    request: Request,
    bot_token: str | None = Body(None, embed=True),
):
    token = (bot_token or "").strip() or get_telegram_raw()[0]
    if not token:
        raise AppException(key="errors.telegram_not_configured", status_code=400)

    ok, detail, updates = get_telegram_updates(token)
    if not ok:
        raise AppException(
            key="errors.telegram_send_failed",
            status_code=502,
            params={"detail": detail},
        )

    chat_id = extract_latest_chat_id(updates)
    if not chat_id:
        raise AppException(key="errors.no_chat_found", status_code=404)

    return build_i18n_response(request, 200, {
        "detail_key": "success.chat_id_discovered",
        "chat_id": chat_id,
    })

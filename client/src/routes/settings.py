from fastapi import APIRouter, Body, Request

from resources.settings import (
    get_public_settings,
    get_telegram_raw,
    update_telegram,
    update_notifications,
)
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

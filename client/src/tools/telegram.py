import json
import logging
import urllib.error
import urllib.parse
import urllib.request

logger = logging.getLogger(__name__)

TELEGRAM_API_URL = "https://api.telegram.org/bot{token}/sendMessage"
TELEGRAM_UPDATES_URL = "https://api.telegram.org/bot{token}/getUpdates"
REQUEST_TIMEOUT = 10


def get_telegram_updates(bot_token):
    if not bot_token:
        return False, "not_configured", []
    url = TELEGRAM_UPDATES_URL.format(token=bot_token)
    req = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
            body = json.loads(resp.read().decode("utf-8"))
            if body.get("ok"):
                return True, "ok", body.get("result", [])
            return False, body.get("description") or "unknown_error", []
    except urllib.error.HTTPError as exc:
        detail = "unknown_error"
        try:
            err_body = json.loads(exc.read().decode("utf-8"))
            detail = err_body.get("description") or f"HTTP {exc.code}"
        except Exception:
            detail = f"HTTP {exc.code}"
        return False, detail, []
    except urllib.error.URLError as exc:
        return False, str(exc.reason), []
    except Exception as exc:
        logger.error(f"Telegram getUpdates failed: {exc}")
        return False, str(exc), []


def extract_latest_chat_id(updates):
    for update in reversed(updates):
        msg = (
            update.get("message")
            or update.get("edited_message")
            or update.get("channel_post")
            or update.get("edited_channel_post")
        )
        if not msg:
            continue
        chat = msg.get("chat") or {}
        chat_id = chat.get("id")
        if chat_id is not None:
            return str(chat_id)
    return None


def send_telegram_message(bot_token, chat_id, text, parse_mode="HTML"):
    if not bot_token or not chat_id:
        return False, "not_configured"

    url = TELEGRAM_API_URL.format(token=bot_token)
    payload = urllib.parse.urlencode({
        "chat_id": chat_id,
        "text": text,
        "parse_mode": parse_mode,
    }).encode("utf-8")

    req = urllib.request.Request(url, data=payload, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")

    try:
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
            body = json.loads(resp.read().decode("utf-8"))
            if body.get("ok"):
                return True, "ok"
            return False, body.get("description") or "unknown_error"
    except urllib.error.HTTPError as exc:
        detail = "unknown_error"
        try:
            err_body = json.loads(exc.read().decode("utf-8"))
            detail = err_body.get("description") or f"HTTP {exc.code}"
        except Exception:
            detail = f"HTTP {exc.code}"
        logger.warning(f"Telegram HTTP error: {detail}")
        return False, detail
    except urllib.error.URLError as exc:
        logger.warning(f"Telegram network error: {exc.reason}")
        return False, str(exc.reason)
    except Exception as exc:
        logger.error(f"Telegram send failed: {exc}")
        return False, str(exc)

import json
import logging
import os
import threading
from pathlib import Path

from system.log import AppException

logger = logging.getLogger(__name__)

SETTINGS_FILE = Path(__file__).resolve().parents[2] / "data" / "settings.json"

TIMEOUT_MIN = 5
TIMEOUT_MAX = 3600
DEFAULT_TIMEOUT = 30

VALID_CHANNELS = {"browser", "telegram"}
DEFAULT_CHANNELS = ["browser", "telegram"]

settings = {
    "telegram": {"bot_token": "", "chat_id": ""},
    "notifications": {"idle_timeout_seconds": DEFAULT_TIMEOUT, "channels": list(DEFAULT_CHANNELS)},
    # Empty string = auto-detect (see _resolve_vscode_binary in routes/terminal.py).
    # When set, the user's explicit path wins over auto-detection.
    "editor": {"binary_override": ""},
}


def _normalize_channels(value):
    if not isinstance(value, list):
        return list(DEFAULT_CHANNELS)
    seen = []
    for item in value:
        if isinstance(item, str) and item in VALID_CHANNELS and item not in seen:
            seen.append(item)
    return seen

_lock = threading.Lock()


def _atomic_write(data):
    SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = SETTINGS_FILE.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, SETTINGS_FILE)


def save_settings():
    _atomic_write(settings)


def load_settings():
    if not SETTINGS_FILE.exists():
        logger.info(f"No settings file at {SETTINGS_FILE}; using defaults")
        return
    try:
        with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError) as exc:
        logger.warning(f"Failed to read {SETTINGS_FILE}: {exc}. Using defaults.")
        return

    tele = data.get("telegram", {})
    notif = data.get("notifications", {})
    editor = data.get("editor", {})
    with _lock:
        settings["telegram"]["bot_token"] = tele.get("bot_token", "") or ""
        settings["telegram"]["chat_id"] = tele.get("chat_id", "") or ""
        timeout = notif.get("idle_timeout_seconds", DEFAULT_TIMEOUT)
        try:
            timeout = int(timeout)
        except (TypeError, ValueError):
            timeout = DEFAULT_TIMEOUT
        settings["notifications"]["idle_timeout_seconds"] = max(TIMEOUT_MIN, min(TIMEOUT_MAX, timeout))
        if "channels" in notif:
            settings["notifications"]["channels"] = _normalize_channels(notif.get("channels"))
        else:
            settings["notifications"]["channels"] = list(DEFAULT_CHANNELS)
        settings["editor"]["binary_override"] = str(editor.get("binary_override", "") or "").strip()
    logger.info(f"Loaded settings (telegram configured: {bool(settings['telegram']['bot_token'])})")


def get_public_settings():
    with _lock:
        return {
            "telegram": {
                "bot_token": settings["telegram"]["bot_token"],
                "chat_id": settings["telegram"]["chat_id"],
            },
            "notifications": {
                "idle_timeout_seconds": settings["notifications"]["idle_timeout_seconds"],
                "channels": list(settings["notifications"]["channels"]),
            },
            "editor": {
                "binary_override": settings["editor"]["binary_override"],
            },
        }


def get_telegram_raw():
    with _lock:
        return settings["telegram"]["bot_token"], settings["telegram"]["chat_id"]


def update_telegram(bot_token, chat_id):
    with _lock:
        if bot_token is not None:
            settings["telegram"]["bot_token"] = str(bot_token).strip()
        if chat_id is not None:
            settings["telegram"]["chat_id"] = str(chat_id).strip()
        save_settings()


def update_notifications(idle_timeout_seconds=None, channels=None):
    with _lock:
        if idle_timeout_seconds is not None:
            try:
                value = int(idle_timeout_seconds)
            except (TypeError, ValueError):
                raise AppException(key="errors.invalid_timeout", status_code=400)
            if value < TIMEOUT_MIN or value > TIMEOUT_MAX:
                raise AppException(
                    key="errors.invalid_timeout",
                    status_code=400,
                    params={"min": TIMEOUT_MIN, "max": TIMEOUT_MAX},
                )
            settings["notifications"]["idle_timeout_seconds"] = value
        if channels is not None:
            settings["notifications"]["channels"] = _normalize_channels(channels)
        save_settings()


def get_idle_timeout():
    with _lock:
        return settings["notifications"]["idle_timeout_seconds"]


def get_channels():
    with _lock:
        return list(settings["notifications"]["channels"])


def get_editor_override():
    with _lock:
        return settings["editor"]["binary_override"]


def update_editor(binary_override=None):
    with _lock:
        if binary_override is not None:
            settings["editor"]["binary_override"] = str(binary_override or "").strip()
        save_settings()

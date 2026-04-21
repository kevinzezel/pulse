import os
from pathlib import Path

from dotenv import dotenv_values

# When running under systemd/launchd, env vars are injected via EnvironmentFile
# / EnvironmentVariables — use those directly. In dev (./start.sh) the shell
# loads .env into the process, but not always exported, so we fall back to
# reading the .env file at a known path.
def _load_config() -> dict:
    if "API_KEY" in os.environ:
        return {
            "COMPOSE_PROJECT_NAME": os.environ.get("COMPOSE_PROJECT_NAME", "pulse"),
            "VERSION": os.environ.get("VERSION", "unknown"),
            "API_HOST": os.environ["API_HOST"],
            "API_PORT": os.environ["API_PORT"],
            "API_KEY": os.environ["API_KEY"],
        }
    client_root = Path(__file__).resolve().parents[2]
    return dict(dotenv_values(client_root / ".env"))


_cfg = _load_config()

COMPOSE_PROJECT_NAME = _cfg["COMPOSE_PROJECT_NAME"]
VERSION = _cfg["VERSION"]
API_HOST = _cfg["API_HOST"]
API_PORT = int(_cfg["API_PORT"])
API_KEY = _cfg["API_KEY"]

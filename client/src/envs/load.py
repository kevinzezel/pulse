import logging
import os
from pathlib import Path

from dotenv import dotenv_values


def _read_install_version() -> str | None:
    # $INSTALL_ROOT/VERSION é o single source of truth da versão instalada,
    # reescrito pelo installer a cada upgrade. Necessário porque seed_client_env()
    # preserva client.env durante upgrade — sem isso, VERSION= ficaria congelado
    # na release pré-upgrade e o /api/version reportaria errado.
    # Em dev (sem install) o arquivo não existe → cai no fallback do env/.env.
    install_root = Path(__file__).resolve().parents[3]
    candidate = install_root / "VERSION"
    if candidate.is_file():
        try:
            value = candidate.read_text().strip()
            return value or None
        except OSError as err:
            logging.getLogger(__name__).warning(
                "Failed to read $INSTALL_ROOT/VERSION at %s: %s — falling back to .env",
                candidate, err,
            )
            return None
    return None


# When running under systemd/launchd, env vars are injected via EnvironmentFile
# / EnvironmentVariables — use those directly. In dev (./start.sh) the shell
# loads .env into the process, but not always exported, so we fall back to
# reading the .env file at a known path.
def _load_config() -> dict:
    install_version = _read_install_version()
    if "API_KEY" in os.environ:
        return {
            "COMPOSE_PROJECT_NAME": os.environ.get("COMPOSE_PROJECT_NAME", "pulse"),
            "VERSION": install_version or os.environ.get("VERSION", "unknown"),
            "API_HOST": os.environ["API_HOST"],
            "API_PORT": os.environ["API_PORT"],
            "API_KEY": os.environ["API_KEY"],
        }
    client_root = Path(__file__).resolve().parents[2]
    cfg = dict(dotenv_values(client_root / ".env"))
    if install_version:
        cfg["VERSION"] = install_version
    return cfg


_cfg = _load_config()

COMPOSE_PROJECT_NAME = _cfg["COMPOSE_PROJECT_NAME"]
VERSION = _cfg["VERSION"]
API_HOST = _cfg["API_HOST"]
API_PORT = int(_cfg["API_PORT"])
API_KEY = _cfg["API_KEY"]

import asyncio
import logging
from typing import Any

from fastapi import WebSocket

logger = logging.getLogger(__name__)

_clients: set[WebSocket] = set()
_lock = asyncio.Lock()


async def register(websocket: WebSocket) -> None:
    async with _lock:
        _clients.add(websocket)


async def unregister(websocket: WebSocket) -> None:
    async with _lock:
        _clients.discard(websocket)


async def broadcast(event: dict[str, Any]) -> None:
    async with _lock:
        snapshot = list(_clients)
    if not snapshot:
        return
    dead: list[WebSocket] = []
    for ws in snapshot:
        try:
            await ws.send_json(event)
        except Exception as exc:
            logger.debug("Broadcast send failed, dropping client: %s", exc)
            dead.append(ws)
    if dead:
        async with _lock:
            for ws in dead:
                _clients.discard(ws)

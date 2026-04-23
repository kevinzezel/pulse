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
    # Envio paralelo: um cliente lento não atrasa o envio para os outros.
    results = await asyncio.gather(
        *[ws.send_json(event) for ws in snapshot],
        return_exceptions=True,
    )
    dead: list[WebSocket] = []
    for ws, result in zip(snapshot, results):
        if isinstance(result, Exception):
            logger.debug("Broadcast send failed, dropping client: %s", result)
            dead.append(ws)
    if dead:
        async with _lock:
            for ws in dead:
                _clients.discard(ws)

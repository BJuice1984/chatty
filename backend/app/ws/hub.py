"""In-process WebSocket fan-out for one API process."""

from __future__ import annotations

from collections import defaultdict

from fastapi import WebSocket


class ChatHub:
    def __init__(self):
        self._connections: dict[int, set[WebSocket]] = defaultdict(set)

    async def connect(self, chat_id: int, websocket: WebSocket) -> None:
        self._connections[chat_id].add(websocket)

    async def disconnect(self, chat_id: int, websocket: WebSocket) -> None:
        connections = self._connections.get(chat_id)
        if connections is None:
            return
        connections.discard(websocket)
        if not connections:
            self._connections.pop(chat_id, None)

    async def broadcast(self, chat_id: int, payload: dict[str, object]) -> None:
        stale: list[WebSocket] = []
        for websocket in tuple(self._connections.get(chat_id, ())):
            try:
                await websocket.send_json(payload)
            except Exception:
                stale.append(websocket)
        for websocket in stale:
            await self.disconnect(chat_id, websocket)


hub = ChatHub()

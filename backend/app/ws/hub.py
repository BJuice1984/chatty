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

    async def close_chat(self, chat_id: int, code: int = 1000) -> None:
        """Закрывает все сокеты чата (после удаления): клиенты сами не переподключаются.

        Записи убираются из хаба сразу, до закрытия, чтобы параллельный
        ``connect`` не зарегистрировал сокет в уже удалённом чате.
        """

        for websocket in self._connections.pop(chat_id, set()):
            try:
                await websocket.close(code=code)
            except Exception:
                # сокет уже мёртв — молча пропускаем
                pass


hub = ChatHub()


class StoriesHub:
    """User-keyed registry of /ws/stories sockets: the stories feed is global,
    so fan-out goes by user (multi-tab friendly), not by chat."""

    def __init__(self):
        self._user_sockets: dict[int, set[WebSocket]] = {}

    async def connect(self, user_id: int, websocket: WebSocket) -> None:
        self._user_sockets.setdefault(user_id, set()).add(websocket)

    async def disconnect(self, user_id: int, websocket: WebSocket) -> None:
        sockets = self._user_sockets.get(user_id)
        if sockets is None:
            return
        sockets.discard(websocket)
        if not sockets:
            self._user_sockets.pop(user_id, None)

    async def broadcast(
        self,
        payload: dict[str, object],
        *,
        exclude_user_id: int | None = None,
    ) -> None:
        stale: list[tuple[int, WebSocket]] = []
        # снимок: await ниже уступает потоку, параллельный disconnect
        # не должен ронять итерацию (send_json падает на мёртвом сокете —
        # собираем и вычищаем, как в ChatHub.broadcast)
        for user_id, sockets in list(self._user_sockets.items()):
            if user_id == exclude_user_id:
                continue
            for websocket in tuple(sockets):
                try:
                    await websocket.send_json(payload)
                except Exception:
                    stale.append((user_id, websocket))
        for user_id, websocket in stale:
            await self.disconnect(user_id, websocket)


stories_hub = StoriesHub()

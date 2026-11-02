"""The bot answer reaches connected websocket feeds without a refetch.

BotService writes the answer straight to the database; the endpoint is the
place that mirrors the WS-событие a live send would have produced. A duplicate
delivery of the same run must not broadcast the answer a second time.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.bot.provider import BotProviderError
from app.core.security import hash_password
from app.models.user import User

BOT_EMAIL = 'bot@chatty.local'
ANSWER = ' The broadcast fixture answer. '


class FakeBotProvider:
    def __init__(self, answers: list[str] | None = None, error: BotProviderError | None = None):
        self.answers = list(answers or [])
        self.error = error

    def complete(self, messages: list[dict]) -> str:
        if self.error is not None:
            raise self.error
        if not self.answers:
            raise AssertionError('scripted provider ran out of answers')
        return self.answers.pop(0)


def seed_bot_user(session_factory) -> int:
    # прямая вставка в сессию: лишний TestClient в lifespan-shutdown
    # dispose'ит engine и убивает in-memory базу
    with session_factory() as session:
        user = User(email=BOT_EMAIL, password_hash=hash_password('not-a-real-login-hash'))
        session.add(user)
        session.commit()
        return user.id


def test_successful_run_broadcasts_answer_and_duplicate_does_not(app, session_factory):
    app.state.bot_provider = FakeBotProvider(answers=[ANSWER])
    bot_id = seed_bot_user(session_factory)

    with TestClient(app) as client:
        registered = client.post(
            '/api/v1/auth/register',
            json={'email': 'broadcast-owner@example.com', 'password': 'correct horse battery staple'},
        )
        assert registered.status_code == 201
        chat = client.post('/api/v1/chats', json={'title': 'AI', 'is_ai': True}).json()
        chat_id = chat['id']

        with client.websocket_connect(
            f'/api/v1/ws/chats/{chat_id}',
            headers={'Origin': 'http://localhost:3000'},
        ) as websocket:
            message = client.post(
                f'/api/v1/chats/{chat_id}/messages',
                json={'content': 'Any question.'},
            ).json()

            run = client.post(
                f'/api/v1/chats/{chat_id}/bot/runs',
                json={'message_id': message['id']},
            ).json()
            assert run['status'] == 'succeeded'

            event = websocket.receive_json()
            assert event['type'] == 'message'
            assert event['content']['content'] == ANSWER.strip()
            assert event['content']['user_id'] == bot_id

            # duplicate delivery returns the stored run — no second broadcast.
            # The history request flushes the queue deterministically: the
            # next event must be the history reply, not a duplicate answer.
            duplicate = client.post(
                f'/api/v1/chats/{chat_id}/bot/runs',
                json={'message_id': message['id']},
            ).json()
            assert duplicate['id'] == run['id']

            websocket.send_json({'type': 'history', 'content': {'limit': 10}})
            next_event = websocket.receive_json()
            assert next_event['type'] == 'history', 'duplicate run must not re-broadcast the answer'

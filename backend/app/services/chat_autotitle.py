"""One-shot LLM chat auto-naming (2026-11-06-llm-chat-autotitle).

A pure synchronous service: threshold gates, context build, the provider
call and the one-shot CAS rename. It never imports the WS transport — the
fan-out belongs to the scheduler module (app/ws/autotitle); this file stays
the review F-5 grep pin's clean zone. The rename is quiet: no system
message row, the EXISTING 'chat_renamed' event carries the new title to
ACTIVE members. The one-shot property rides the ``auto_titled`` flag itself:
a successful rename clears it atomically (``UPDATE ... WHERE auto_titled``),
so a manual rename that landed first simply makes the CAS lose silently.
"""

from __future__ import annotations

import logging

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.bot.config import BotSettings
from app.bot.config import AutoTitleSettings
from app.bot.prompts import build_title_messages
from app.bot.provider import BotProvider, BotProviderError
from app.models.chat import Chat
from app.models.message import Message
from app.repositories.users import UserRepository

logger = logging.getLogger(__name__)

# Маркер отказа из промпта: темы в диалоге нет — названия не будет
NONE_MARKER = 'NONE'

# Краевые символы, не являющиеся названием: пробелы, парные кавычки,
# хвостовые точки и многоточия
TRIM_CHARS = ' \t"\'«»“”….'

# Токен-бюджет короткого ответа: 2–4 слова с запасом на служебные токены
TITLE_MAX_TOKENS = 64


class ChatAutoTitleService:
    def __init__(
        self,
        session: Session,
        bot: BotSettings,
        autotitle: AutoTitleSettings,
        *,
        provider: BotProvider,
    ):
        self.session = session
        self.bot = bot
        self.autotitle = autotitle
        self.provider = provider
        self.users = UserRepository(session)

    def maybe_rename(self, chat_id: int) -> str | None:
        """Переименовать auto_titled-чат по контексту, ровно один раз.

        Возвращает новый title или None (гейт не пройден, модель отказалась,
        ответ не прошёл гигиену, CAS проиграл гонку). Любая ошибка провайдера
        логируется и превращается в None — автозаполнение тихо ретраится на
        следующем юзерском сообщении, пока флаг жив.
        """
        if not self.autotitle.enabled:
            return None
        chat = self.session.get(Chat, chat_id)
        if chat is None or not chat.auto_titled or chat.is_dm:
            return None

        bot_user = self.users.get_by_email(self.bot.user_email)
        bot_user_id = bot_user.id if bot_user is not None else None
        user_messages = self._user_messages(chat_id, bot_user_id)
        total_messages = self.session.scalar(
            select(func.count()).select_from(Message).where(Message.chat_id == chat_id),
        ) or 0
        # хвостовой гвард: чат вырос без порога (приветствия/модель лежала) —
        # автозаполнение больше не беспокоит ни чат, ни модель
        if total_messages > self.autotitle.max_chat_messages:
            return None
        if (
            len(user_messages) < self.autotitle.min_user_messages
            or sum(len(content) for content, _ in user_messages) < self.autotitle.min_user_chars
        ):
            return None

        dialogue = self._dialogue(chat_id, bot_user_id)
        title = self._ask_model(dialogue)
        if title is None:
            return None

        # one-shot CAS: гашение флага и новое название атомарны; rowcount 0 —
        # ручной rename (или чей-то повторный запуск) уже выиграл, тихий пропуск
        result = self.session.execute(
            update(Chat)
            .where(Chat.id == chat_id, Chat.auto_titled.is_(True))
            .values(title=title, auto_titled=False),
        )
        if result.rowcount == 0:
            self.session.rollback()
            return None
        self.session.commit()
        return title

    def _user_messages(self, chat_id: int, bot_user_id: int | None) -> list[tuple[str, int]]:
        """Юзерские реплики чата: (content, user_id).

        В порог идут только строки живых участников: kind IS NULL (системные
        «X переименовал чат…» не считаются) и непустой content (file-only
        реплики не считаются). Ботовские ответы исключены по bot_user_id —
        иначе развёрнутый ответ на первое «привет» мгновенно перевалят порог.
        """
        rows = self.session.execute(
            select(Message.content, Message.user_id)
            .where(
                Message.chat_id == chat_id,
                Message.kind.is_(None),
                Message.content.is_not(None),
            )
            .order_by(Message.id),
        ).all()
        return [
            (content, user_id)
            for content, user_id in rows
            if content and content.strip() and user_id != bot_user_id
        ]

    def _dialogue(self, chat_id: int, bot_user_id: int | None) -> list[dict[str, str]]:
        """Транскрипт для промпта: последние context_messages kind-NULL
        непустых сообщений (роли user/bot по bot_user_id), хвостовой кап
        context_chars — не влезающие СТАРЫЕ реплики отбрасываются (поздние
        информативнее для текущей темы), порядок в промпте хронологический."""
        rows = self.session.execute(
            select(Message.content, Message.user_id)
            .where(
                Message.chat_id == chat_id,
                Message.kind.is_(None),
                Message.content.is_not(None),
            )
            .order_by(Message.id.desc())
            .limit(self.autotitle.context_messages),
        ).all()
        picked: list[tuple[str, str]] = []
        budget = self.autotitle.context_chars
        # rows — от НОВЫХ к старым: набираем с хвоста, старшие не влезают —
        # просто перестаём брать (не break-пустота), потом разворачиваем
        for content, user_id in rows:
            text = (content or '').strip()
            if not text:
                continue
            role = 'bot' if user_id == bot_user_id else 'user'
            line = f'{role}: {text}'
            if len(line) > budget:
                continue
            budget -= len(line)
            picked.append((role, text))
        return [{'role': role, 'content': text} for role, text in reversed(picked)]

    def _ask_model(self, dialogue: list[dict[str, str]]) -> str | None:
        if not dialogue:
            return None
        prompt = build_title_messages(dialogue)
        try:
            # короткий путь с собственным бюджетом; scripted-фейки без
            # complete_short идут фолбэком на complete() — прецедент
            # BotService._answer с complete_stream
            complete_short = getattr(self.provider, 'complete_short', None)
            if complete_short is not None:
                answer = complete_short(
                    prompt,
                    max_tokens=TITLE_MAX_TOKENS,
                    timeout_seconds=self.autotitle.timeout_seconds,
                )
            else:
                answer = self.provider.complete(prompt)
        except BotProviderError as exc:
            logger.warning('chat autotitle provider failed: %s', exc.kind)
            return None
        return self._sanitize(answer)

    def _sanitize(self, answer: str) -> str | None:
        """Гигиена ответа: снять краевые пробелы/переводы строк, потом
        кавычки/точки/многоточия; отвергнуть пустое, NONE, многострочное и
        слишком длинное — отказ оставляет auto_titled живым (ретрай позже)."""
        title = answer.strip().strip(TRIM_CHARS)
        if not title or title.upper() == NONE_MARKER or '\n' in title or '\r' in title:
            return None
        if len(title) > self.autotitle.max_title_chars:
            return None
        return title

# Просмотр базы данных Chatty (локальный own-стенд)

Инструкция для оператора: как смотреть данные PostgreSQL и файловые объекты
локального compose-стенда (`docker compose --env-file .env up -d`). Секреты
(пароли) не дублируются здесь — они в операторском корневом `.env`.

## Что где лежит

| Данные | Где | Доступ |
| --- | --- | --- |
| Реляционные данные | контейнер `db` (postgres:16-alpine), volume `chatty_chatty-postgres`, база `chatty`, пользователь `chatty` | `docker compose exec` / GUI через порт (см. ниже) |
| Файлы документов (байты) | контейнер `object-storage` (RustFS, S3-совместимый), volume `chatty_chatty-object-storage`, бакет `chatty-files`, ключи `chat/{chat_id}/{uuid}` | веб-консоль http://localhost:9001 |
| Метаданные и векторы | таблицы `files`, `documents`, `doc_chunks` (эмбеддинги — JSON-массив float, не pgvector) | psql / GUI |

Порт 5432 наружу **не** публикуется по умолчанию (безопасность) — отсюда
два способа просмотра ниже.

## 1. Быстро: psql внутри контейнера

Клиента psql на хосте не требуется — он уже в образе:

```bash
# интерактивная сессия
docker compose --env-file .env exec db psql -U chatty -d chatty

# одиночный запрос
docker compose --env-file .env exec -T db psql -U chatty -d chatty -c "SELECT …"
```

Таблицы (14): `users`, `chats`, `chat_members`, `chat_last_reads`, `messages`,
`files`, `documents`, `doc_chunks`, `bot_runs`, `contacts`, `reactions`,
`stories`, `story_views`, `alembic_version`.

### Полезные запросы (RAG-контур)

```sql
-- документы со статусами ингестии
SELECT d.id, f.original_name, d.status, d.error_kind, d.chunk_count, d.chat_id
FROM documents d JOIN files f ON f.id = d.file_id ORDER BY d.id;

-- чанки документа (эмбеддинг не смотреть — огромный JSON)
SELECT ordinal, left(content, 120) AS snippet FROM doc_chunks
WHERE document_id = :doc_id ORDER BY ordinal;

-- участники чата / пользователи
SELECT u.id, u.email, u.role FROM users ORDER BY u.id;
SELECT chat_id, user_id, role FROM chat_members WHERE chat_id = :chat_id;

-- прогоны бота (вопрос→ответ, вложение)
SELECT id, chat_id, status, error_kind, attachment_file_id
FROM bot_runs ORDER BY id DESC LIMIT 10;

-- размер по чатам
SELECT chat_id, count(*) AS chunks FROM doc_chunks GROUP BY chat_id;
```

## 2. Удобно: GUI-клиент (DBeaver / DataGrip / VS Code SQLTools / pgAdmin)

Порт 5432 нужно опубликовать. Создайте рядом с `docker-compose.yml` файл
`docker-compose.db-port.yml` (гитигнорить):

```yaml
services:
  db:
    ports:
      - "127.0.0.1:5432:5432"
```

и поднимите стек с ним:

```bash
docker compose --env-file .env -f docker-compose.yml -f docker-compose.db-port.yml up -d
```

Параметры подключения в GUI:

| Параметр | Значение |
| --- | --- |
| Host | `localhost` |
| Port | `5432` |
| Database | `chatty` |
| User | `chatty` |
| Password | значение `POSTGRES_PASSWORD` из корневого `.env` |

Привязка только к `127.0.0.1` — порт не виден из сети. После работы уберите
override и пересоздайте стек без него.

Альтернатива без публикации порта — pgAdmin контейнером в сети стенда:

```bash
docker run --rm -d --name chatty-pgadmin \
  --network chatty_chatty-internal \
  -p 127.0.0.1:5050:80 \
  -e PGADMIN_DEFAULT_EMAIL=admin@pgadmin.local \
  -e PGADMIN_DEFAULT_PASSWORD=pgadmin-local \
  dpage/pgadmin:latest
```

Веб-интерфейс на http://localhost:5050, сервер в настройках — `db:5432`.

## 3. Файлы документов (RustFS)

Веб-консоль: **http://localhost:9001** (логин/пароль — `OBJECT_STORAGE_ACCESS_KEY`
/ `OBJECT_STORAGE_SECRET_KEY` из корневого `.env`). Бакет `chatty-files`;
документы чатов — префикс `chat/{chat_id}/…`, аватары/истории — `media/…`.

Скачать файл документа можно и через API (нужна cookie-сессия):

```bash
curl -b cookies.txt -OJ http://127.0.0.1:8000/api/v1/files/{file_id}/download
```

## 4. Бэкап и восстановление

```bash
# бэкап (volume не трогаем)
docker compose --env-file .env exec -T db \
  pg_dump -U chatty -d chatty > backup-$(date +%Y%m%d-%H%M).sql

# восстановление в чистую базу (осторожно: перезаписывает данные)
docker compose --env-file .env exec -T db \
  psql -U chatty -d chatty < backup-YYYYMMDD-HHMM.sql
```

## Осторожности

- БД — живой стенд: `UPDATE/DELETE` только со свежим бэкапом (RLS нет,
  прав хватает, чтобы сломать всё).
- Схему меняют только миграции alembic (`alembic upgrade head` при старте
  контейнера api), не руками.
- Volumes `chatty-postgres` / `chatty-object-storage` не удалять без
  проверенного бэкапа (см. docs/deployment/own-backend.md, Rollback).

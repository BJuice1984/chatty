#!/usr/bin/env bash
# Загрузка документов для RAG-поиска в AI-чат собственного бэкенда:
# login админом -> (найти|создать) is_ai-чат -> для каждого файла
# конвертация .doc/.rtf -> .docx (soffice на хосте; в API-контейнере
# конвертера нет — нативный .doc падает с converter_failed) ->
# POST /files -> POST /documents/{id}/ingest -> отчёт.
#
# Использование:
#   CHATTY_ADMIN_EMAIL=... CHATTY_ADMIN_PASSWORD=... \
#     bash backend/scripts/upload_documents.sh <папка-с-файлами>
#
# Env:
#   CHATTY_API            базовый URL (default http://127.0.0.1:8000/api/v1)
#   CHATTY_ADMIN_EMAIL    email админа (сид CHATTY_SEED_ADMIN_*, обязателен)
#   CHATTY_ADMIN_PASSWORD пароль админа (>= 12 символов, обязателен)
#   CHATTY_AI_CHAT_TITLE  заголовок AI-чата (default "Документы")

set -euo pipefail

die() {
    echo "ошибка: $*" >&2
    exit 1
}

command -v curl >/dev/null || die 'curl не найден'
command -v jq >/dev/null || die 'jq не найден'

API="${CHATTY_API:-http://127.0.0.1:8000/api/v1}"
EMAIL="${CHATTY_ADMIN_EMAIL:-}"
PASSWORD="${CHATTY_ADMIN_PASSWORD:-}"
CHAT_TITLE="${CHATTY_AI_CHAT_TITLE:-Документы}"

[ -n "$EMAIL" ] || die 'задайте CHATTY_ADMIN_EMAIL (см. CHATTY_SEED_ADMIN_EMAIL в операторском env)'
[ -n "$PASSWORD" ] || die 'задайте CHATTY_ADMIN_PASSWORD'
[ "$#" -eq 1 ] || die "укажите папку с файлами: $0 <папка>"
[ -d "$1" ] || die "не папка: $1"

SRC_DIR="$(cd "$1" && pwd)"
COOKIE_JAR="$(mktemp)"
CONVERT_DIR="$(mktemp -d)"
trap 'rm -f "$COOKIE_JAR"; rm -rf "$CONVERT_DIR"' EXIT

api() {
    # api <method> <path> [дополнительные аргументы curl]
    local method="$1" path="$2"
    shift 2
    curl -sS --fail-with-body -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
        -X "$method" "$API$path" "$@"
}

echo "== login $EMAIL"
LOGIN_BODY=$(api POST /auth/login \
    -H 'Content-Type: application/json' \
    -d "{\"email\": \"$EMAIL\", \"password\": \"$PASSWORD\"}")
USER_ROLE=$(echo "$LOGIN_BODY" | jq -r '.role // empty')
[ "$USER_ROLE" = 'admin' ] || die "пользователь $EMAIL не админ (role=$USER_ROLE): ingest требует роль admin"

echo "== поиск AI-чата «$CHAT_TITLE»"
CHAT_ID=$(
    api GET /chats | jq -r --arg title "$CHAT_TITLE" \
        '[.[] | select(.is_ai == true and .title == $title)][0].id // empty'
)
if [ -z "$CHAT_ID" ]; then
    echo "   не найден — создаётся"
    CHAT_ID=$(api POST /chats \
        -H 'Content-Type: application/json' \
        -d "{\"title\": \"$CHAT_TITLE\", \"is_ai\": true}" | jq -r '.id')
fi
echo "   chat_id=$CHAT_ID"

FAILED=0
UPLOADED=0

upload_one() {
    local path="$1"
    local name status error_kind file_id chunks ingest
    name="$(basename "$path")"

    file_id=$(api POST /files -F "chat_id=$CHAT_ID" -F "uploaded=@$path" | jq -r '.file_id')
    ingest=$(api POST "/documents/$file_id/ingest")
    status=$(echo "$ingest" | jq -r '.status')
    error_kind=$(echo "$ingest" | jq -r '.error_kind // ""')
    chunks=$(echo "$ingest" | jq -r '.chunk_count')

    if [ "$status" = 'ready' ]; then
        echo "   ok: $name -> ready ($chunks чанков)"
        UPLOADED=$((UPLOADED + 1))
    else
        echo "   FAIL: $name -> $status ($error_kind)"
        FAILED=$((FAILED + 1))
    fi
}

echo "== загрузка файлов из $SRC_DIR"
shopt -s nullglob nocaseglob
for entry in "$SRC_DIR"/*; do
    [ -f "$entry" ] || continue
    name="$(basename "$entry")"
    lower="${name,,}"
    case "$lower" in
        *.docx|*.pdf|*.xlsx)
            upload_one "$entry"
            ;;
        *.doc|*.rtf)
            # нативный .doc недоступен в контейнере API, .rtf не в whitelist —
            # конвертация в .docx локальным soffice
            command -v soffice >/dev/null || {
                echo "   SKIP: $name (нужен soffice для конвертации, а его нет в PATH)"
                FAILED=$((FAILED + 1))
                continue
            }
            echo "   конвертация $name -> docx"
            if soffice --headless --convert-to docx --outdir "$CONVERT_DIR" "$entry" >/dev/null 2>&1; then
                base="${name%.*}"
                converted="$CONVERT_DIR/$base.docx"
                [ -f "$converted" ] || {
                    echo "   FAIL: $name (soffice не создал $converted)"
                    FAILED=$((FAILED + 1))
                    continue
                }
                upload_one "$converted"
            else
                echo "   FAIL: $name (ошибка soffice)"
                FAILED=$((FAILED + 1))
            fi
            ;;
        *)
            echo "   SKIP: $name (поддерживаются .docx .pdf .xlsx; .doc/.rtf конвертируются)"
            ;;
    esac
done
shopt -u nullglob nocaseglob

echo "== итог: готово $UPLOADED, неудач $FAILED"
[ "$FAILED" -eq 0 ] || exit 1

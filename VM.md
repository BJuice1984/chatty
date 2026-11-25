# Стенд chatty-vm (KVM): запуск и обслуживание

Внутренний стенд для live-проверки own-бэкенда с реальными данными: VM
`chatty-vm` (Ubuntu Server 24.04) под KVM/libvirt на хосте разработки.
Секреты (операторский env, реквизиты) в репозитории не хранятся — env живёт
только на VM в `~/chatty/.env`. Канонический runbook самого бэкенда
(preflight, health, rollback) — `docs/deployment/own-backend.md`; здесь —
специфика стенда.

Все команды virsh выполняются на хосте разработки от вашего пользователя.

## 1. Запуск VM

```bash
# состояние (State: running / shut off)
virsh --connect qemu:///system list --all

# старт (если shut off)
virsh --connect qemu:///system start chatty-vm

# опционально: автозапуск VM вместе с хостом
virsh --connect qemu:///system autostart chatty-vm
```

IP выдаётся DHCP из сети libvirt `default` (192.168.122.0/24) и может
меняться между запусками:

```bash
virsh --connect qemu:///system net-dhcp-leases default
```

Вход по ключу `~/.ssh/id_ed25519` с хоста (пример: 2026-11-16 —
`192.168.122.24`; ниже в командах — `<vm-ip>`):

```bash
ssh chattyadmin@<vm-ip>
```

QEMU Guest Agent в гостевой ОС не работает — консоль без ssh доступна
только через `virsh screenshot` + `virsh send-key` (SPICE).

## 2. Бэкенд (docker compose)

```bash
ssh chattyadmin@<vm-ip> 'cd ~/chatty && docker compose --env-file .env up -d'
```

- `--build` добавляется только после rsync-обновления кода (см. раздел 3);
  если код не менялся, `up -d` поднимает существующие образы.
- При старте `api` прогоняет миграции (`alembic upgrade head`) и
  идемпотентный сид — готовность проверяется `/ready`, не `/health`.

```bash
# дождаться готовности (несколько секунд после старта контейнера api)
ssh chattyadmin@<vm-ip> '
  for i in 1 2 3 4 5; do
    r=$(curl -s http://127.0.0.1:8000/ready); [ "$r" = "ready" ] && break; sleep 3
  done
  echo "ready: $r"
  curl -s http://127.0.0.1:8000/health
  curl -s -o /dev/null -w "rustfs: %{http_code}\n" http://127.0.0.1:9000/health
'
```

## 3. Обновление кода на VM (rsync)

VM не может `git fetch` origin (приватный GitHub) — код доставляется rsync
с хоста. Операторский `.env` на VM не перезатирается:

```bash
rsync -a --delete \
  --exclude .git --exclude node_modules --exclude backend/.venv \
  --exclude work --exclude dist --exclude .alk \
  --exclude __pycache__ --exclude .pytest_cache --exclude .eslintcache \
  --exclude .env --exclude .env.own --exclude .env.operator \
  ~/dev/chatty/ chattyadmin@<vm-ip>:~/chatty/
```

После rsync на VM:

```bash
ssh chattyadmin@<vm-ip> 'cd ~/chatty && docker compose --env-file .env up -d --build'
# фронт: пересобрать под API стенда и перезапустить (см. раздел 4)
ssh chattyadmin@<vm-ip> 'cd ~/chatty && npx vite build --mode own'
```

## 4. Фронт (express-статика из dist/)

Фронт — не контейнер: `node server/server.js` на порту 3001, лог
`~/frontend.log`. После ребута VM и после каждой пересборки поднимается
руками.

Запуск строго отсонединённо — простой `nohup ... &` внутри ssh-команды
умирает при разрыве сессии:

```bash
ssh chattyadmin@<vm-ip> 'cd ~/chatty && (setsid nohup node server/server.js >> ~/frontend.log 2>&1 < /dev/null &)'
```

Проверка — pgrep отдельной командой, паттерн через `[s]erver` (паттерн без
скобок совпадает с собственной ssh-командой: `pkill` по нему убьёт сессию,
exit 255):

```bash
ssh chattyadmin@<vm-ip> 'pgrep -af "[s]erver/server.js" && curl -sf -o /dev/null -w "front: %{http_code}\n" http://127.0.0.1:3001'
```

## 5. Автозапуск контейнеров

По умолчанию restart-политик в `docker-compose.yml` нет — после ребута VM
стек не поднимается сам. Настройка:

Предусловие — docker должен стартовать при загрузке ОС (на стенде уже так):

```bash
ssh chattyadmin@<vm-ip> 'systemctl is-enabled docker'   # → enabled
```

**Вариант A — канонический (compose-файл).** Добавить в `docker-compose.yml`
сервисам `api`, `db`, `object-storage`:

```yaml
services:
  api:
    restart: unless-stopped
    # ...
  db:
    restart: unless-stopped
    # ...
  object-storage:
    restart: unless-stopped
    # ...
```

Важно: **не** добавлять политику сервису `object-storage-volume-init` — это
one-shot (chown тома, exit 0), с политикой `always`/`unless-stopped` он
будет перезапускаться в цикле.

Применить (пересоздаст контейнеры с новой политикой):

```bash
ssh chattyadmin@<vm-ip> 'cd ~/chatty && docker compose --env-file .env up -d'
# проверка политики
ssh chattyadmin@<vm-ip> "docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' chatty-api-1 chatty-db-1 chatty-object-storage-1"
```

Замечание: compose-файл общий для хоста и VM (уходит по rsync). Политика
`unless-stopped` не поднимает контейнеры, остановленные вручную, поэтому
для локального дев-стека хоста это безопасно.

**Вариант B — быстрый, без правки compose-файла:**

```bash
ssh chattyadmin@<vm-ip> 'docker update --restart unless-stopped chatty-api-1 chatty-db-1 chatty-object-storage-1'
```

Оговорка: настройка живёт на контейнере и сбрасывается при пересоздании
(`up -d --build` при каждом обновлении кода) — повторять после каждого
деплоя. Поэтому для стенда предпочтителен вариант A.

**Проверка после ребута VM:** `docker compose ps` (все три — healthy) +
`curl /ready` из раздела 2. Фронт автозапуска не имеет — поднимается руками
(раздел 4); при желании его можно обернуть в systemd-юнит (сейчас не
настроен).

## 6. Доступ с хоста и из LAN (туннель)

Порты хоста (контракт 2026-11-10, не нарушать):

- `3005` — всегда туннель к фронту VM; `8001` — всегда туннель к API VM;
- локальный фронт разработки — `3006`;
- `3001` на хосте занят root-процессом другого проекта, `8000` — локальным
  chatty-api: не переиспользовать и не убивать.

Туннель поднимается на хосте (бинд 0.0.0.0 — доступ из LAN):

```bash
ssh -f -N -L 0.0.0.0:3005:127.0.0.1:3001 -L 0.0.0.0:8001:127.0.0.1:8000 chattyadmin@<vm-ip>
```

Проверка:

```bash
ss -ltn | grep -E ':(3005|8001)\b'
curl -sf -o /dev/null -w '%{http_code}\n' http://localhost:3005   # фронт → 200
curl -sf http://localhost:8001/health                              # API → ok
```

Из LAN стенд доступен по `http://<lan-ip-хоста>:3005` и `:8001` (пример:
2026-11-16 — `192.168.1.182`). CORS в `.env` VM разрешает конкретные
origin'ы (`:3001`, `:3005`), фронт собран под API `:8001` — если LAN-IP
хоста сменился, нужно пересобрать фронт (`npx vite build --mode own`) и
поправить `CHATTY_ALLOWED_ORIGINS`.

## 7. Шпаргалка: полный подъём после ребута

```bash
# 0) VM (если shut off) и её IP
virsh --connect qemu:///system start chatty-vm
virsh --connect qemu:///system net-dhcp-leases default    # → <vm-ip>

# 1) бэкенд (при настроенном автозапуске из раздела 5 — уже поднят)
ssh chattyadmin@<vm-ip> 'cd ~/chatty && docker compose --env-file .env up -d'

# 2) фронт
ssh chattyadmin@<vm-ip> 'cd ~/chatty && (setsid nohup node server/server.js >> ~/frontend.log 2>&1 < /dev/null &)'

# 3) туннель на хосте (если нужен LAN-доступ)
ssh -f -N -L 0.0.0.0:3005:127.0.0.1:3001 -L 0.0.0.0:8001:127.0.0.1:8000 chattyadmin@<vm-ip>

# 4) проверка с хоста
curl -sf -o /dev/null -w 'front: %{http_code}\n' http://localhost:3005
curl -sf http://localhost:8001/ready
```

## 8. Особенности стенда

- Обновление кода — только rsync (раздел 3); кадровые документы для RAG —
  `~/embedding_docs`; OCR (`ocrmypdf` + tesseract-rus) есть на VM, на хосте
  его нет; конвертация rtf/doc → docx (`soffice`) — наоборот, на хосте.
- PDF больше 10 МБ сжимать перед загрузкой
  (`gs -sDEVICE=pdfwrite -dPDFSETTINGS=/ebook`).
- Бот-юзер `bot@chatty.local` регистрируется как обычный пользователь;
  ответ бота — явный `POST /chats/{id}/bot/runs`, не авто-ответ.

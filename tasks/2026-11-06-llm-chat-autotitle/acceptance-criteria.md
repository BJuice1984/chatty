# Acceptance criteria — 2026-11-06-llm-chat-autotitle

| ID | Requirement | Evidence | Criterion |
| --- | --- | --- | --- |
| `AC-BE-GATE` | `REQ-BE-AUTOTITLE` | `EV-BE-1` | pytest: model NOT called when user-message count < 2 OR summed user chars < 120 (greeting-only chat stays 'Чат с'); bot answers and kind-bearing system lines never count toward the threshold; not-auto_titled chats, DMs, the disabled kill-switch (CHATTY_AUTOTITLE_ENABLED=false) and chats over MAX_CHAT_MESSAGES never call the model; AI and non-AI auto_titled chats are gated identically. |
| `AC-BE-TITLE` | `REQ-BE-AUTOTITLE` | `EV-BE-1` | pytest: after the threshold a scripted provider title lands as chats.title with auto_titled=0; the WS chat_renamed {chat_id, title} event reaches ACTIVE members; NO kind='chat_renamed' system message row is created; BOTH send paths (the WS message event and HTTP POST /chats/{id}/messages — the AI-assistant askBot seam) trigger the one-shot rename; subsequent messages never rename again; a manual rename (flag already cleared) makes the CAS a silent no-op — the LLM title does NOT overwrite the manual one. |
| `AC-BE-CONTEXT` | `REQ-BE-AUTOTITLE` | `EV-BE-1` | pytest: the prompt carries the recent kind-NULL non-empty messages with user/bot roles (bot by bot_user_id; system lines and file-only rows stay out of the transcript) and respects the message-count and char caps; answer hygiene strips wrapping quotes and a trailing dot and rejects empty/NONE/multiline/over-MAX_TITLE_CHARS answers leaving auto_titled untouched; a NONE answer followed later by a valid answer renames on the later attempt. |
| `AC-FE-SLICE` | `REQ-FE-AUTOTITLE` | `EV-FE-1` | mocha: handleChatRenamedEvent patches the slice title AND clears auto_titled (the header input becomes the static h2 — the messenger autoTitleInput flag reads the slice); the identical-title case still clears auto_titled when the slice flag is set; a non-auto-titled chat's patch is unchanged. |
| `AC-FE-AI-SEED` | `REQ-FE-AUTOTITLE` | `EV-FE-1` | mocha: the assistant empty-state creation passes auto_titled: true through the controller into the port and the own adapter includes auto_titled in the POST /chats payload only when explicitly set (unset stays absent — the chats/api/own.ts mirror). |
| `AC-PROCESS` | `REQ-FE-AUTOTITLE` | `EV-FE-1` | npm run verify, bash backend/verify.sh and guard-architecture --all --strict pass on the run branch with counts grown from the recorded base (mocha 712 / pytest 307); alembic heads unchanged (013_chat_auto_title — no migration); docs/progress/progress_log.md entry on top; no file outside the manifest write-sets changes. |

Evidence ids: EV-BE-1 = `bash backend/verify.sh` (pytest + alembic heads) на
ветке прогона; EV-FE-1 = `npm run verify` + `node .claude/hooks/scripts/guard-architecture.mjs --all --strict`
на ветке прогона. Оба гейта обязаны расти от базы 2026-11-06 (Linux-стенд):
mocha 712 passing, pytest 307 passed, alembic head 013_chat_auto_title.

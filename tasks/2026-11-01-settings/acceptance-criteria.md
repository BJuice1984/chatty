# Acceptance criteria — 2026-11-01-settings

Base: `feature/2026-11-01-contacts` @ d1ce06a... (full sha at freeze).
Evidence routes: `EV-BE-1` = verify:backend receipts; `EV-FE-THEME` =
npm run verify (theme wave); `EV-FE-1` = npm run verify (logic wave);
`EV-FE-2` = npm run verify + guard strict (UI wave).

| ID | Requirement | Evidence | Criterion |
| --- | --- | --- | --- |
| `AC-BE-SETTINGS` | `REQ-BE-SETTINGS` | `EV-BE-1` | Migration 011 adds users.display_name (nullable; NULL -> email-local-part fallback in UserSearchItem, ContactResponse, to_member_brief — pinned), users.phone (nullable) and users.send_read_receipts (NOT NULL default true), proven by the segment roundtrip test with the EXPLICIT downgrade target; heads == 011_settings; PUT /auth/profile updates display_name/phone/send_read_receipts with validation (csrf, 401 anonymous — pinned); PUT /auth/password verifies old (401 invalid_credentials), rehashes, revokes ALL refresh tokens and reissues current-session cookies (an old refresh token 401 after — pinned); POST /auth/logout-all bumps token_version with the comparison BUILT in get_current_user (core/deps.py — a previously issued access token 401 after — pinned); auth responses grow display_name/phone/send_read_receipts additive; POST /chats/{id}/rejoin reactivates the caller's archived row (left_at -> NULL, active semantics resume), kicked 403, active idempotent 204, unknown chat 404, anonymous 401; GET /files/usage returns the caller's {total_bytes, file_count} (one SUM/COUNT); MessageService.history skips mark_read when the viewer's send_read_receipts is false — the gate keeps the VIEWER's own unread badge after reading (chat_last_reads has no peer consumer; sender-visible receipts are a non-goal — pinned). |
| `AC-FE-THEME` | `REQ-FE-THEME` | `EV-FE-THEME` | The SCSS COLOR tokens render as CSS custom properties on :root with dark overrides under [data-theme='dark'] (metrics like $tablet/$desktop stay SCSS variables — @media arithmetic cannot use var()); component stylesheets reference var(--token) for colors AND raw hex/rgb() color literals in component files are extracted to tokens (the ~27 literals across messenger/modal/chat/story-viewer/button/contacts/contact-item/chat-list-user); the grep gate covers BOTH $color tokens and raw literals, exemption set = variable.scss (token source), utils/mixins.scss, utils/scrollbar.scss, libs/** (a stated plan choice — mixins.scss is linted), the light-scrollbar artifact documented; utils/theme.ts applies/persists 'light' / 'dark' / 'system' (localStorage chatty-theme), follows matchMedia in system mode, sets document.documentElement.dataset.theme; bootstrapped from main.ts; unit tests pin persistence, the system listener and dataset application; verify + stylelint green with zero comments in new scss. |
| `AC-FE-SETTINGS-LOGIC` | `REQ-FE-SETTINGS-LOGIC` | `EV-FE-1` | Profile port: changeProfile supported (PUT /auth/profile + csrf) with changePassword, logoutAll, fetchUsage additive — URL shapes + csrf mocha-pinned; toAuthUser maps REAL display_name/phone + send_read_receipts (no synthesized email-name — the old mapping would revert Account edits; AuthUser grows the flag, pinned); profile/password success refreshes the auth user through the composition-root seam (features/index.ts wiring — pinned); chats port/controller: rejoinChat(chatId) POST + csrf, refetches the list (pinned), reachable from the profile page via the wired seam; utils/preferences.ts exposes typed per-viewer preferences (sound, browserNotifications, autoDownload) with live subscriber notification — unit-pinned incl. localStorage failure tolerance. |
| `AC-FE-SETTINGS-UI` | `REQ-FE-SETTINGS-UI` | `EV-FE-2` | The six /settings items navigate the right pane (active modifier + section state — pinned): Account edits display_name/phone with validation and shows email/login read-only, password change (12+ policy message), Sign out, Sign out everywhere (confirm modal); Chats lists archived chats with «Вернуться» -> rejoin -> the card undims via the store (pinned); Appearance switches light/dark/system live (pinned against theme.ts); Notification toggles sound + browser notifications (permission request when enabling — pinned); Privacy toggles read receipts through PUT profile (pinned); Data Usage shows the fetched usage human-readable + the auto-download toggle (pinned); messenger delivery: WS message plays sound only when enabled, browser notification only when enabled+granted+document.hidden, attachment previews gated by autoDownload with a «Скачать» fallback (all gate-pinned in jsdom); all new user text through double braces / escapeHtml builders. |
| `AC-PROCESS` | `REQ-FE-SETTINGS-UI` | `EV-FE-2` | npm run verify, verify:backend (heads == 011_settings; suite green modulo the 4 documented Windows ingestion failures) and guard strict pass with grown counts (mocha 450 base; pytest 230 base); NEXT.md records the settings surface and progress_log carries the cumulative follow-up registry; no file outside the manifest write-sets changes; rides feature/2026-11-01-contacts. |

## Details

### AC-FE-THEME — why tokens must be custom properties

SCSS variables compile away — a runtime theme switch needs CSS custom
properties resolved by the browser. The sweep is mechanical
($token -> var(--token)) but wide; scrollbars/libs stay untouched
(stylelint-excluded). A one-frame light flash on cold load with a dark
choice is a documented non-goal (inline bootstrap script).

### AC-FE-SETTINGS-UI — delivery gates in jsdom

WebAudio/Notification APIs do not exist in jsdom: the tests pin the
GATES (enabled/disabled/hidden branches deciding whether the API is
called) with injected stubs, not the APIs themselves — honest
coverage of what jsdom can prove.

### AC-PROCESS — counts

Real bases at the attempt line: mocha 450, pytest 230 (+4 known
Windows ingestion failures excluded). The manual smoke (toggle theme,
leave+rejoin a chat, change password from a second device and watch it
log out, receipts-off keeps a peer's unread) is an operator NOTE.

# Plan — 2026-11-01-settings

The six dead items of the /settings sidebar become a real settings
surface: the left menu navigates the right pane; every section works
against real backend state or an explicit client preference.

- **Account** — the profile form becomes real: editable display_name
  and phone (new user columns), a password-change flow, «Sign out»
  (existing) and «Sign out everywhere».
- **Chats** — the archive management screen: chats the viewer LEFT
  (dimmed in the list since 2026-11-01-chat-leave) with a «Вернуться»
  (rejoin) action.
- **Appearance** — light/dark/system theme: the SCSS palette becomes
  CSS custom properties, `[data-theme]` overrides, per-viewer choice in
  localStorage.
- **Notification** — sound on incoming messages + browser
  notifications (permission-gated), both per-viewer toggles.
- **Privacy** — «отправлять отчёты о прочтении» server-side per-user
  flag: when off, history loads no longer mark chats read for the
  recipient side (others keep seeing unread).
- **Data Usage** — storage used by the viewer's files (GET
  /files/usage) + an auto-download toggle gating attachment previews.

## Operator decisions (2026-11-01)

All four scope groups selected; implementation order fixed as waves
below; after plan review the full cycle runs autonomously.

## API contract (the wave decoupling point)

1. Migration `011_settings`: `users.display_name` (String(120)
   NULLable — NULL falls back to the email local-part EVERYWHERE the
   name is shown: UserSearchItem, ContactResponse, to_member_brief),
   `users.phone` (String(30) NULLable), `users.send_read_receipts`
   (Boolean NOT NULL server_default '1'). Segment roundtrip test per
   the 009/010 pattern with the EXPLICIT downgrade target
   ('010_chat_leave') — the head-relative '-1' trap is documented.
2. `PUT /api/v1/auth/profile` `{display_name?, phone?, send_read_receipts?}`
   (csrf): validates (display_name 0..120 trimmed, empty -> NULL;
   phone NULL or 3..30), updates, returns the extended UserResponse.
   Email/login stay immutable (email IS the login; out of scope).
3. `PUT /api/v1/auth/password` `{old_password, new_password}` (csrf):
   verifies old (401 invalid_credentials), enforces the password
   policy (12..256), rehashes, revokes ALL refresh tokens and reissues
   fresh cookies for the current session (other devices log out).
4. `POST /api/v1/auth/logout-all` (csrf): bumps `token_version`
   (invalidates every access token), revokes refresh tokens, clears
   cookies.
5. `GET /api/v1/auth/me` / login / register responses grow
   `display_name: str | None`, `phone: str | None`,
   `send_read_receipts: bool` (additive None/True defaults keep
   model_validate paths alive).
6. `POST /api/v1/chats/{chat_id}/rejoin`: reactivates the caller's OWN
   archived membership (left_at -> NULL; the row must exist — kicked
   users 403 chat_membership_required, unknown chat 404; an ACTIVE
   membership is an idempotent 204). After rejoin the member is active
   again (writes and pushes resume).
7. `GET /api/v1/files/usage`: `{total_bytes: int, file_count: int}`
   for the caller's files (uploaded_by the user; single SUM/COUNT).
8. History/read-receipt seam: `MessageService.history` skips
   `mark_read` when the RECIPIENT's `send_read_receipts` is false (the
   viewer's own flag governs their receipts; unread counts of others
   stay).
9. display_name fallback: `UserSearchItem.from_user`,
   `ContactResponse`, `to_member_brief` return
   `display_name or email-local-part` (contacts, member briefs, DM
   titles, search results all improve without further changes).

## Wave 1 — backend (WS-BE-SETTINGS)

Migration 011 + the segment test; User model columns; schemas
(UserResponse extension, ProfileUpdate, PasswordChange); services/auth
(update_profile, change_password, logout_everywhere — token_version
mechanics verified against the JWT identity path); endpoints/auth
(PUT profile, PUT password, POST logout-all, csrf + origin); rejoin
endpoint + service (repositories/chats reactivation helper —
add_member's reactivation branch refactored to share it); files usage
endpoint (repositories/files SUM/COUNT); MessageService.history
receipt gate; display_name fallback in the three name builders; pytest:
profile update + validation, password flow (wrong old 401, other
sessions revoked — refresh with an old token 401, current session
alive), logout-all (old access 401), rejoin (archived -> active,
kicked 403, active idempotent, unknown 404, anonymous 401), usage
shape, receipts-off keeps unread for the peer (history load does not
mark), display_name fallback cases, segment test.

## Wave 2 — frontend theme + preferences (WS-FE-THEME)

1. `src/scss/utils/variable.scss` — every color/metric token becomes a
   CSS custom property declared on `:root` (compiled from the current
   palette) with the SCSS `$var` kept as an alias `map` ONLY where
   non-color math needs it; component files keep using `var(--token)`.
   `src/scss/utils/theme-dark.scss` (new): the dark overrides under
   `[data-theme='dark']` — a curated dark palette (backgrounds, text,
   borders, accents inverted appropriately; images/svg unaffected).
2. `src/utils/theme.ts` (new) — applyTheme/setTheme/getTheme;
   'light' | 'dark' | 'system'; persists the choice in localStorage
   (key chatty-theme), `matchMedia('(prefers-color-scheme: dark)')`
   listener for 'system'; sets `document.documentElement.dataset.theme`
   ('dark' or removes); bootstrapped from main.ts BEFORE first paint
   (inline in index.html? no — main.ts import; a one-frame flash is
   acceptable and noted).
3. Component SCSS sweep: replace `$token` color references with
   `var(--token)` across src/scss/** (mechanical; scrollbars/libs
   excluded where stylelint ignores). Gates: verify + stylelint.
4. Tests: theme module unit tests (persistence, system listener,
   dataset application in jsdom).

## Wave 3 — frontend settings logic (WS-FE-SETTINGS-LOGIC)

1. `src/utils/types.ts` — AppState user grows display_name/phone;
   ProfileUser types updated.
2. `src/features/profile/ports.ts` + `api/own.ts` — changeProfile
   becomes supported (PUT /auth/profile + csrf), changePassword,
   logoutAll, fetchUsage (GET /files/usage via its own transport)
   additive; the auth store refresh after profile/password changes
   (fetchUser).
3. `src/features/chats/ports.ts` + `api/own.ts` + `controller.ts` —
   rejoinChat(chatId) (POST + csrf; refetch chats, reopen selection
   stays manual); tests.
4. `src/utils/preferences.ts` (new) — typed localStorage-backed
   per-viewer preferences: theme (delegated to theme.ts), sound
   (bool, default true), browserNotifications (bool + permission
   state), autoDownload (bool, default true); subscribers notified
   (tiny EventTarget) so UI toggles apply live; unit tests.

## Wave 4 — frontend settings UI + delivery (WS-FE-SETTINGS-UI)

1. ProfilePage restructure: the six sidebar items navigate the right
   pane (section state in page props); `ProfileSettingsItem` gains an
   onClick + active modifier. Sections:
   - Account: editable display_name + phone (validated), read-only
     email/login rows, password change (old/new/repeat, 12+ policy
     message), «Sign out», «Sign out everywhere» (confirm modal).
   - Chats: archived list (leftAt set) with «Вернуться» -> rejoin ->
     refetch (the card undims via the store).
   - Appearance: theme radio (light/dark/system) wired to theme.ts.
   - Notification: sound toggle + browser notifications toggle
     (requests permission when enabling).
   - Privacy: «отправлять отчёты о прочтении» toggle -> PUT profile
     (server-side flag).
   - Data Usage: usage display (human-readable) + auto-download
     toggle (preferences).
2. Messenger delivery: on WS message — sound (when enabled, WebAudio
   short ping, no asset), browser notification (when enabled +
   permission granted + document.hidden); attachment previews gated by
   autoDownload (when off: placeholder with «Скачать» link using the
   existing fileUrl). Read receipts need no client change (server
   gate).
3. Docs: NEXT.md + progress_log (carry the follow-up registry).

## Wave 5 — evidence and closure

npm run verify, verify:backend, guard strict; evidence under
work/2026-11-01-settings/; rides feature/2026-11-01-contacts into the
open PR.

## Out of scope

email/login change (email IS the login — separate security-heavy
feature); per-chat notification settings; server push of profile
changes to other sessions; E2E-ish tests of WebAudio/Notification
(jdom lacks them — unit-test the gates); theme flash-of-light-mode
elimination (inline bootstrap script) — noted, not built; granular
storage breakdown per chat; deleting stored files from Data Usage.

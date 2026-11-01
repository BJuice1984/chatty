# Developer overview — 2026-11-01-settings

## Intent and user-visible result

/settings stops being a mock: the six sidebar items (Account, Chats,
Appearance, Notification, Privacy, Data Usage) navigate a working
right pane. The profile form edits real fields (display_name — which
immediately improves names across contacts, member briefs, DM titles
and search — plus phone), passwords can change, all devices can be
logged out, left chats can be rejoined, the app has a dark theme, and
notifications/privacy/media behavior are togglable.

## Architecture map

Backend (wave 1):

- Migration 011: users.display_name/phone/send_read_receipts; segment
  test with the EXPLICIT downgrade target (the 010 trap documented).
- schemas/auth.py: UserResponse extension + ProfileUpdate +
  PasswordChange; services/auth.py: update_profile, change_password
  (revoke-all-refresh + reissue current), logout_everywhere
  (token_version bump — verify how the JWT identity path consumes
  token_version in core/security.py + deps.py before wiring).
- endpoints/auth.py: PUT profile, PUT password, POST logout-all
  (csrf + origin like the existing mutations).
- chats: rejoin endpoint + shared reactivation helper (refactor
  add_member's branch); files: GET /files/usage (SUM/COUNT);
  messages: history receipt gate (recipient's send_read_receipts);
  name builders fall back display_name -> email-local-part.

Frontend:

- Theme (wave 2): variable.scss -> :root custom properties +
  theme-dark.scss [data-theme='dark'] overrides; the component sweep
  ($token -> var(--token)); utils/theme.ts (light/dark/system,
  localStorage chatty-theme, matchMedia, dataset.theme) bootstrapped
  in main.ts.
- Logic (wave 3): profile port (changeProfile supported, password,
  logoutAll, usage), user refresh after changes; chats rejoinChat;
  utils/preferences.ts (sound/browserNotifications/autoDownload +
  tiny subscriber bus).
- UI (wave 4): ProfilePage sections + ProfileSettingsItem onClick;
  messenger delivery gates (sound/WebAudio, Notification when hidden,
  autoDownload attachment gating).

## Key risks

- token_version: confirm the access-token validation actually
  compares the claim against the column (else logout-all does not
  kill old access tokens) — pin with a real 401-after test.
- The theme sweep is wide and mechanical — a missed file leaves a
  hardcoded color in dark mode; stylelint cannot catch it. Mitigate:
  grep the themed tree for the old $color tokens as the wave gate.
- Password change revoking refresh tokens must not kill the CURRENT
  session's cookies — reissue in the same response (pinned).
- Receipts: the gate is on the RECIPIENT's flag (their outgoing
  receipts), not the viewer's — test from both sides.
- jsdom lacks WebAudio/Notification/matchMedia — stub them in tests;
  matchMedia exists in jsdom but confirm before relying on it.
- Windows host: verify:backend via bash + PYTHON_BIN; the 4 ingestion
  failures are pre-existing noise.

## Execution model

Four sequential waves (backend -> theme -> logic -> UI+delivery);
verify / verify:backend / guard strict per wave; after plan review the
cycle runs autonomously to finalize per the operator instruction.

## Non-goals reminder

No email/login change, no per-chat notification settings, no
server-push of profile changes, no flash-elimination inline script,
no per-chat storage breakdown, no file deletion from Data Usage.

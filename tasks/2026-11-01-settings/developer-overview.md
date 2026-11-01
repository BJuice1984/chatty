# Developer overview — 2026-11-01-settings

## Intent and user-visible result

/settings stops being a mock: the six sidebar items (Account, Chats,
Appearance, Notification, Privacy, Data Usage) navigate a working
right pane. The profile form edits real fields (display_name — which
immediately improves names across contacts, member briefs and search;
DM titles keep their denormalized creation-time local-part — plus
phone), passwords can change, all devices can be logged out, left
chats can be rejoined, the app has a dark theme, and
notifications/privacy/media behavior are togglable.

## Architecture map

Backend (wave 1):

- Migration 011: users.display_name/phone/send_read_receipts; segment
  test with the EXPLICIT downgrade target (the 010 trap documented).
- schemas/auth.py: UserResponse extension + ProfileUpdate +
  PasswordChange; services/auth.py: update_profile, change_password
  (revoke-all-refresh + reissue current), logout_everywhere
  (token_version bump) — and the comparison is BUILT in
  core/deps.py get_current_user (create_token embeds `ver`;
  the check is missing today — core/security.py unchanged; the
  401-after pin proves it).
- endpoints/auth.py: PUT profile, PUT password, POST logout-all
  (csrf + origin like the existing mutations).
- chats: rejoin endpoint + shared reactivation helper (refactor
  add_member's branch); files: GET /files/usage (SUM/COUNT);
  messages: history receipt gate (recipient's send_read_receipts);
  name builders fall back display_name -> email-local-part.

Frontend:

- Theme (wave 2): variable.scss -> :root custom properties (COLOR
  tokens only — metrics stay SCSS vars) + theme-dark.scss
  [data-theme='dark'] overrides; the component sweep covers $color
  tokens AND raw hex/rgb literals (exemptions: variable.scss,
  mixins.scss, scrollbar.scss, libs — a stated plan choice; mixins
  IS linted); utils/theme.ts (light/dark/system, localStorage
  chatty-theme, matchMedia, dataset.theme) bootstrapped in main.ts.
- Logic (wave 3): toAuthUser maps REAL display_name/phone +
  send_read_receipts; profile port (changeProfile supported,
  password, logoutAll, usage); user refresh + rejoin reach the page
  through composition-root seams in features/index.ts; chats
  rejoinChat; utils/preferences.ts (sound/browserNotifications/
  autoDownload + tiny subscriber bus).
- UI (wave 4): ProfilePage sections + ProfileSettingsItem onClick;
  read-only email/login rows are plain markup; delivery gates — the
  background-chat seam in features/chats/ws/own.ts (sound/WebAudio,
  Notification when hidden, autoDownload attachment gating),
  messenger.ts for the open chat.

## Key risks

- token_version: the access-token validation does NOT compare the
  claim today — the wave BUILDS it in core/deps.py and pins a real
  401-after test.
- The theme sweep is wide and mechanical — a missed token OR raw
  hex/rgb literal leaves a hardcoded color in dark mode; stylelint
  cannot catch it. Mitigate: the grep gate covers BOTH classes.
- Password change revoking refresh tokens must not kill the CURRENT
  session's cookies — reissue in the same response (pinned).
- Receipts: chat_last_reads feeds only the viewer's OWN unread badge —
  the gate keeps the viewer's badge unread; sender-visible receipts
  are a non-goal (test the viewer side, there is no peer surface).
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

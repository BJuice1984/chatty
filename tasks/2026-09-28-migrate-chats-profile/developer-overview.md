# Stage 4 — Chats and profile feature migration

Roadmap alias: `migrate-chats-profile`; ALK package id: `2026-09-28-migrate-chats-profile`. Create `feature/2026-09-28-migrate-chats-profile` from accepted `main` after stage 3 is available; this planning draft was authored on `feature/agent-harness`.

Move chats and profile UI/controller behavior into self-contained feature modules with ports, then remove the legacy pages/controllers/API classes named in the manifest. The stage 3 auth boundary and stage 1 `MessagesController` compatibility adapter remain. The later API cutover owns adapter files and composition-root wiring, so this stage must not edit those paths.

Deletion is authorized only after feature modules compile and the stage's migration evidence proves the legacy behavior has a replacement. Practicum smoke is a required external gate; record `UNAVAILABLE` when the service cannot be reached.

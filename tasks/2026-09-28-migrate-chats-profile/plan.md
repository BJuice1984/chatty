# Implementation plan

1. Map legacy chat/profile page, controller and API responsibilities to feature-owned ports.
2. Implement chats and profile modules, stores, controllers, ports and equivalent Block/Handlebars pages.
3. Add focused feature-boundary tests and prove the new paths compile with the existing auth/module kernel.
4. Run Practicum smoke and only then remove the explicitly listed legacy pages, controllers and API classes. Preserve `src/controllers/MessagesController.ts`.
5. Run `npm run verify`, record deletion inventory and hand off the feature contract to stage 7.

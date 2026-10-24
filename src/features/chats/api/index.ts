// Порт chats: единственная реализация — own-адаптер собственного бэкенда
// (stage 7 выбирал по env.mode; cutover 2026-10-16 оставил одну историю).

import type { ChatsPort } from '../ports.ts'
import { ownChatsPort } from './own.ts'

export const chatsPort: ChatsPort = ownChatsPort

// Выбор адаптера chats по режиму (stage 7).

import { env } from '../../../utils/env.ts'
import type { ChatsPort } from '../ports.ts'
import { ownChatsPort } from './own.ts'
import { practicumChatsPort } from './practicum.ts'

export const chatsPort: ChatsPort = env.mode === 'own' ? ownChatsPort : practicumChatsPort

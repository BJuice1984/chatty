// Порт contacts: единственная реализация — own-адаптер собственного
// бэкенда (как у chats после cutover 2026-10-16 — одна история).

import type { ContactsPort } from '../ports.ts'
import { ownContactsPort } from './own.ts'

export const contactsPort: ContactsPort = ownContactsPort

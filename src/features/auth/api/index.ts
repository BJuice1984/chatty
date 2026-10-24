// Порт auth: единственная реализация — own-адаптер собственного бэкенда
// (stage 7 выбирал по env.mode; cutover 2026-10-16 оставил одну историю).

import type { AuthPort } from '../ports.ts'
import { ownAuthPort } from './own.ts'

export const authPort: AuthPort = ownAuthPort

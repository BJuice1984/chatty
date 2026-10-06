// Выбор адаптера auth по режиму (stage 7): env.mode определён на старте
// (VITE_APP_MODE/MODE); режим фиксирован на время жизни приложения.

import { env } from '../../../utils/env.ts'
import type { AuthPort } from '../ports.ts'
import { ownAuthPort } from './own.ts'
import { practicumAuthPort } from './practicum.ts'

export const authPort: AuthPort = env.mode === 'own' ? ownAuthPort : practicumAuthPort

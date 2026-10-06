// Выбор адаптера profile по режиму (stage 7).

import { env } from '../../../utils/env.ts'
import type { ProfilePort } from '../ports.ts'
import { ownProfilePort } from './own.ts'
import { practicumProfilePort } from './practicum.ts'

export const profilePort: ProfilePort = env.mode === 'own' ? ownProfilePort : practicumProfilePort

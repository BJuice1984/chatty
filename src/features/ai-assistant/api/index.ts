// Выбор адаптера AI-ассистента по режиму (stage 7 идиома): env.mode определён
// на старте; в practicum-режиме каждая операция явно unsupported.

import { env } from '../../../utils/env.ts'
import type { AiAssistantPort } from '../ports.ts'
import { ownAiAssistantPort } from './own.ts'
import { practicumAiAssistantPort } from './practicum.ts'

export const aiAssistantPort: AiAssistantPort = env.mode === 'own' ? ownAiAssistantPort : practicumAiAssistantPort

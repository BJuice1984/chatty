// Порт AI-ассистента: единственная реализация — own-адаптер (RAG-поиск и
// вопрос-ответ собственного бэкенда).

import type { AiAssistantPort } from '../ports.ts'
import { ownAiAssistantPort } from './own.ts'

export const aiAssistantPort: AiAssistantPort = ownAiAssistantPort

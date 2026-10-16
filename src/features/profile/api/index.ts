// Порт profile: единственная реализация — own-адаптер. Собственный бэкенд
// не предоставляет пользовательских профилей, операции явно отвергаются
// (см. own.ts) — контроллер и UI остаются за контрактом порта.

import type { ProfilePort } from '../ports.ts'
import { ownProfilePort } from './own.ts'

export const profilePort: ProfilePort = ownProfilePort

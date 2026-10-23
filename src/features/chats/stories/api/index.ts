// Реализация порта stories по умолчанию — own-адаптер собственного бэкенда

import type { StoriesPort } from '../ports.ts'
import { ownStoriesPort } from './own.ts'

export const storiesPort: StoriesPort = ownStoriesPort

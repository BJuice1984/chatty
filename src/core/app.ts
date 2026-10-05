// Композиционный шов приложения (stage 3).
// main.ts не входит в write-set стадии: подключение корня — stage 4.

import type { AppContext, AppModule } from './module/types.ts'
import { registerModules } from './module/registry.ts'

export interface App {
    bootstrapOrder: string[]
    // eslint-disable-next-line no-unused-vars
    module(name: string): AppModule
}

export function createApp(modules: readonly AppModule[], context: AppContext = {}): App {
    const registry = registerModules(modules)
    const bootstrapOrder = registry.bootstrap(context)

    return {
        bootstrapOrder,
        module: (name: string) => registry.get(name),
    }
}

// Реестр модулей с детерминированным поведением коллизий (stage 3).

import type { AppContext, AppModule } from './types.ts'

export class ModuleRegistrationError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'ModuleRegistrationError'
    }
}

export class ModuleRegistry {
    private readonly modules = new Map<string, AppModule>()

    register(module: AppModule): void {
        if (typeof module.name !== 'string' || module.name.length === 0) {
            throw new ModuleRegistrationError('module name must be a non-empty string')
        }

        if (this.modules.has(module.name)) {
            throw new ModuleRegistrationError(`module "${module.name}" is already registered`)
        }

        this.modules.set(module.name, module)
    }

    get(name: string): AppModule {
        const module = this.modules.get(name)

        if (module === undefined) {
            throw new ModuleRegistrationError(`module "${name}" is not registered`)
        }

        return module
    }

    names(): string[] {
        return Array.from(this.modules.keys())
    }

    // Топологический порядок инициализации: зависимости раньше зависимых.
    // Неизвестная зависимость и цикл — явные ошибки, не undefined-поведение.
    resolveOrder(): string[] {
        const visited = new Set<string>()
        const inProgress = new Set<string>()
        const order: string[] = []

        const visit = (name: string, chain: string[]): void => {
            if (visited.has(name)) {
                return
            }

            if (inProgress.has(name)) {
                throw new ModuleRegistrationError(
                    `cyclic module dependency: ${[...chain, name].join(' -> ')}`
                )
            }

            const module = this.modules.get(name)

            if (module === undefined) {
                throw new ModuleRegistrationError(`module "${name}" is not registered`)
            }

            inProgress.add(name)

            for (const dep of module.deps ?? []) {
                visit(dep, [...chain, name])
            }

            inProgress.delete(name)
            visited.add(name)
            order.push(name)
        }

        for (const name of this.modules.keys()) {
            visit(name, [])
        }

        return order
    }

    bootstrap(context: AppContext = {}): string[] {
        const order = this.resolveOrder()

        for (const name of order) {
            this.modules.get(name)?.setup?.(context)
        }

        return order
    }
}

export function registerModules(modules: readonly AppModule[]): ModuleRegistry {
    const registry = new ModuleRegistry()

    for (const module of modules) {
        registry.register(module)
    }

    return registry
}

import { expect } from 'chai'
import { ModuleRegistry, ModuleRegistrationError, registerModules } from './registry.ts'

describe('ModuleRegistry', () => {
    it('should register modules and list names deterministically', () => {
        const registry = registerModules([{ name: 'auth' }, { name: 'chats' }])

        expect(registry.names()).to.deep.eq(['auth', 'chats'])
    })

    it('should reject an empty module name', () => {
        const registry = new ModuleRegistry()

        expect(() => registry.register({ name: '' })).to.throw(ModuleRegistrationError)
    })

    it('should reject duplicate module registration with an explicit message', () => {
        const registry = new ModuleRegistry()
        registry.register({ name: 'auth' })

        expect(() => registry.register({ name: 'auth' }))
            .to.throw(ModuleRegistrationError, /"auth" is already registered/)
    })

    it('should resolve dependencies before dependents', () => {
        const order: string[] = []
        const registry = registerModules([
            {
                name: 'chats',
                deps: ['auth'],
                setup: () => order.push('chats'),
            },
            {
                name: 'auth',
                setup: () => order.push('auth'),
            },
        ])

        expect(registry.resolveOrder()).to.deep.eq(['auth', 'chats'])
        expect(registry.bootstrap()).to.deep.eq(['auth', 'chats'])
        expect(order).to.deep.eq(['auth', 'chats'])
    })

    it('should reject an unknown dependency', () => {
        const registry = registerModules([{ name: 'chats', deps: ['missing'] }])

        expect(() => registry.resolveOrder()).to.throw(ModuleRegistrationError, /"missing" is not registered/)
    })

    it('should reject cyclic dependencies with the dependency chain', () => {
        const registry = registerModules([
            { name: 'a', deps: ['b'] },
            { name: 'b', deps: ['a'] },
        ])

        expect(() => registry.resolveOrder()).to.throw(ModuleRegistrationError, /cyclic module dependency: a -> b -> a/)
    })

    it('should expose registered modules by name and reject unknown ones', () => {
        const registry = registerModules([{ name: 'auth' }])

        expect(registry.get('auth').name).to.eq('auth')
        expect(() => registry.get('chats')).to.throw(ModuleRegistrationError, /"chats" is not registered/)
    })
})

describe('createApp', () => {
    it('should bootstrap modules in dependency order and expose them', async () => {
        const { createApp } = await import('../app.ts')
        const order: string[] = []

        const app = createApp([
            { name: 'profile', deps: ['auth'], setup: () => order.push('profile') },
            { name: 'auth', setup: () => order.push('auth') },
        ])

        expect(app.bootstrapOrder).to.deep.eq(['auth', 'profile'])
        expect(order).to.deep.eq(['auth', 'profile'])
        expect(app.module('auth').name).to.eq('auth')
    })
})

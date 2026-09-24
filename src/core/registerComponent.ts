import Handlebars, { HelperOptions } from 'handlebars'
import Block from './Block.ts'

interface CustomData {
    root: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        __refs?: Record<string, Block<any>> // Уточненный тип для __refs
        __children?: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            component: Block<any> // Уточненный тип для component
            // eslint-disable-next-line no-unused-vars
            embed: (fragment: DocumentFragment) => void
        }[]
    }
}

export function registerComponent(name: string, Component: typeof Block) {
    if (name in Handlebars.helpers) {
        throw new Error(`The ${name} component is already registered!`)
    }

    // eslint-disable-next-line func-names
    Handlebars.registerHelper(name, function (this: unknown, { hash, data, fn }: HelperOptions) {
        const component = new Component(hash)
        const dataAttribute = `data-id="${component.id}"`

        const customData = data as CustomData // Уточняем тип данных

        if (Boolean(hash) && typeof hash === 'object' && 'ref' in hash) {

            const hashRef = hash.ref as string // Явное приведение типа

            ;(customData.root.__refs = customData.root.__refs || {})[hashRef] = component
        }

        ;(customData.root.__children = customData.root.__children || []).push({
            component,
            embed(fragment: DocumentFragment) {
                const stub = fragment.querySelector(`[${dataAttribute}]`)

                if (!stub) {
                    return
                }

                component.getContent()?.append(...Array.from(stub.childNodes))
                stub.replaceWith(component.getContent()!)
            },
        })

        // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
        const contents = fn ? fn(this) : ''

        return `<div ${dataAttribute}>${contents}</div>`
    })
}

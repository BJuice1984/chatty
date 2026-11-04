import Handlebars, { HelperOptions } from 'handlebars'
import Block, { Props, markBlockRetained } from './Block.ts'

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

// Keyed-кэш инстансов (2026-11-04-bot-wait-offline): хелпер с cacheKey в
// hash переиспользует живой инстанс между рендерами — setProps-обновление
// вместо конструирования, embed переносит СУЩЕСТВУЮЩИЙ элемент в новый
// рендер (stub replaceWith двигает узел, элемент не пересоздаётся на
// стороне родителя). Кэш — один на регистрацию: ключи разных компонентов
// не пересекаются; все кэши видны модулю, чтобы prune смел ушедшие ключи.
const keyedInstanceCaches = new Set<Map<string, Block>>()

// Prune keyed-кэшей: уничтожает и удаляет записи, чьих ключей нет в
// переданном множестве. Единственный владелец времени жизни
// retained-инстансов: compile-смета и destroy() родителя их пропускают,
// поэтому без prune кэш рос бы неограниченно (смена чата, удаление
// сообщения должны ронять осевшие записи).
export function pruneComponentCache(alive: Set<string>): void {
    keyedInstanceCaches.forEach(cache => {
        cache.forEach((instance, key) => {
            if (!alive.has(key)) {
                cache.delete(key)
                instance.destroy()
            }
        })
    })
}

export function registerComponent(name: string, Component: typeof Block) {
    if (name in Handlebars.helpers) {
        throw new Error(`The ${name} component is already registered!`)
    }

    const instanceCache = new Map<string, Block>()

    keyedInstanceCaches.add(instanceCache)

    // eslint-disable-next-line func-names
    Handlebars.registerHelper(name, function (this: unknown, { hash, data, fn }: HelperOptions) {
        // opt-in: без строкового cacheKey поведение прежнее — новый инстанс
        // на каждый вызов хелпера, кэш не участвует
        const cacheKey = typeof hash?.cacheKey === 'string' && hash.cacheKey !== ''
            ? hash.cacheKey
            : undefined

        let component: Block

        if (cacheKey != null && instanceCache.has(cacheKey)) {
            // Попадание: обновляем ЖИВОЙ инстанс, embed ниже перенесёт его
            // существующий элемент в новый рендер родителя
            component = instanceCache.get(cacheKey) as Block
            component.setProps(hash as Props)
        } else {
            component = new Component(hash)

            if (cacheKey != null) {
                instanceCache.set(cacheKey, component)

                // retained-метка (review F-2): родительские смета/destroy
                // этот инстанс пропускают — его жизнью владеет prune
                markBlockRetained(component)
            }
        }

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

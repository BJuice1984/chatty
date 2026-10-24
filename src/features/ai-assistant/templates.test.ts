// Детерминированный template-ассерт (stage 10): тройные скобки в шаблонах
// фичи разрешены ТОЛЬКО для вызовов зарегистрированных компонентов-хелперов
// (AiTypingIndicator / AiDocumentCard); любые данные — double-stache.

import { expect } from 'chai'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const FEATURE_ROOT = join(process.cwd(), 'src', 'features', 'ai-assistant')

const REGISTERED_HELPERS = ['AiTypingIndicator', 'AiDocumentCard']

function collectTemplates(dir: string): string[] {
    const found: string[] = []

    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)

        if (entry.isDirectory()) {
            found.push(...collectTemplates(full))
        } else if (entry.name.endsWith('.hbs')) {
            found.push(full)
        }
    }

    return found
}

describe('ai assistant template wire-data safety', () => {
    const templates = collectTemplates(FEATURE_ROOT)

    it('has found the feature templates', () => {
        expect(templates.length).to.be.greaterThan(0)
    })

    it('uses triple-stache only for registered component helpers', () => {
        for (const path of templates) {
            const source = readFileSync(path, 'utf8')
            const triples = source.match(/\{\{\{[\s\S]*?\}\}\}/g) ?? []

            for (const triple of triples) {
                const head = triple.replace(/^\{\{\{/, '').trim()

                expect(
                    REGISTERED_HELPERS.some(helper => head.startsWith(helper)),
                    `${path}: triple-stache is not a registered component helper: ${triple}`
                ).to.be.true

                const inner = triple.slice(3, -3)

                expect(
                    inner.includes('{{'),
                    `${path}: nested interpolation inside triple-stache would render wire data raw: ${triple}`
                ).to.be.false
            }
        }
    })

    it('renders every wire-data field through double-stache escaping', () => {
        const wireFields = ['answer', 'error', 'title', 'snippet', 'content', 'query', 'label']

        for (const path of templates) {
            const source = readFileSync(path, 'utf8')
            const doubles = source.match(/\{\{[^{}]+\}\}/g) ?? []

            expect(doubles.length, `${path}: expected double-stanche data interpolations`).to.be.greaterThan(0)

            for (const field of wireFields) {
                if (new RegExp(`\\b${field}\\b`).test(source)) {
                    expect(
                        doubles.some(item => item.includes(field)),
                        `${path}: field "${field}" must be interpolated with double-stanche`
                    ).to.be.true
                }
            }
        }
    })
})

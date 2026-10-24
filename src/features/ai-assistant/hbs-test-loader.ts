// Тестовый погрузчик .hbs (stage 10): vite-плагин предкомпилирует шаблоны
// только для сборки, а mocha/tsx не знает расширения. Хук компилирует
// шаблон тем же Handlebars, в котором registerComponent регистрирует
// компоненты-хелперы, — рендер в тестах идёт по настоящим шаблонам фичи.

import Handlebars from 'handlebars'
import { readFileSync } from 'node:fs'

// eslint-disable-next-line no-unused-vars
type CompiledTemplate = (context: unknown) => string

interface CjsModule {
    exports: CompiledTemplate & { default?: CompiledTemplate }
}

declare const require: {
    // eslint-disable-next-line no-unused-vars
    extensions: Record<string, (module: CjsModule, filename: string) => void>
}

const extensions = require.extensions

if (extensions['.hbs'] === undefined) {
    extensions['.hbs'] = (module, filename) => {
        const compiled = Handlebars.compile(readFileSync(filename, 'utf8')) as CompiledTemplate

        module.exports = compiled
        module.exports.default = compiled
    }
}

export const hbsTestLoaderInstalled = true

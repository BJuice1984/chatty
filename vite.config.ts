import { defineConfig } from 'vite'
import { resolve } from 'path'
import { fileURLToPath } from 'url'
import vitePluginHandlebarsPrecompile from './vite-plugin-handelbars-precompile'

const projectRoot = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
    build: {
        outDir: resolve(projectRoot, 'dist'),
    },
    server: {
        port: 3001,
        // строгий порт: занятый 3001 — loud-отказ вместо молчаливого
        // переезда на соседний (молчаливый сдвиг рассинхронизирует
        // фронт-origin с CHATTY_ALLOWED_ORIGINS бэкенда)
        strictPort: true,
    },
    plugins: [vitePluginHandlebarsPrecompile()],
})

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
        port: 3006,
        // строгий порт: занятый 3006 — loud-отказ вместо молчаливого
        // переезда на соседний (молчаливый сдвиг рассинхронизирует
        // фронт-origin с CHATTY_ALLOWED_ORIGINS бэкенда); 3005 на хосте
        // занят ssh-туннелем к стенду chatty-vm, локальный фронт всегда 3006
        strictPort: true,
    },
    plugins: [vitePluginHandlebarsPrecompile()],
})

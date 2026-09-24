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
        port: 3000,
    },
    plugins: [vitePluginHandlebarsPrecompile()],
})

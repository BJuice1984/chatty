import express from 'express'
import path, { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const distPath = resolve(__dirname, '../dist')

const app = express()
// Дефолт 3001 — контракт VM-стенда chatty-vm (туннель host:3005 → VM:3001);
// локально прод-проверку зовут с PORT=3006 (3005 занят туннелем, дефолт
// dev-сервера — 3006)
const port = Number(process.env.PORT) || 3001
app.use(express.static(resolve(distPath)))

app.use((req, res) => {
    res.sendFile(path.join(__dirname, '../dist', 'index.html'))
})

app.listen(port, () => {
    console.log('server started on ' + port)
})

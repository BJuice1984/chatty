import express from 'express'
import path, { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const distPath = resolve(__dirname, '../dist')

const app = express()
const port = 3001
app.use(express.static(resolve(distPath)))

app.use((req, res) => {
    res.sendFile(path.join(__dirname, '../dist', 'index.html'))
})

app.listen(port, () => {
    console.log('server started on ' + port)
})

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDb } from './db.js'
import { createApp } from './app.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// minimal .env loader
const envFile = path.join(ROOT, '.env')
if (fs.existsSync(envFile)) for (const l of fs.readFileSync(envFile, 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const db = openDb(process.env.DATABASE_FILE ? path.resolve(ROOT, process.env.DATABASE_FILE) : path.join(ROOT, 'data/qa-hub.db'))
const app = createApp(db)
const port = Number(process.env.PORT || 4400)
app.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`QA Team Hub running at http://${process.env.HOST || '127.0.0.1'}:${port}`))

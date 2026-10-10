// Usage: npm run create-admin -- --email you@example.dk --name "Your Name" --password "a-long-password-1"
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDb } from '../db.js'
import { hashPassword, checkPasswordStrength } from '../auth.js'
import { EMAIL_RE } from '../services/mailer.js'

const a = {}
for (let i = 2; i < process.argv.length; i++) if (process.argv[i].startsWith('--')) a[process.argv[i].slice(2)] = process.argv[++i]
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
if (!EMAIL_RE.test(a.email || '') || !a.name || !a.password) { console.error('Usage: npm run create-admin -- --email <email> --name <name> --password <password>'); process.exit(1) }
checkPasswordStrength(a.password)
const db = openDb(process.env.DATABASE_FILE ? path.resolve(ROOT, process.env.DATABASE_FILE) : path.join(ROOT, 'data/qa-hub.db'))
const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(a.email)
const hash = await hashPassword(a.password)
if (existing) { db.prepare('UPDATE users SET password_hash = ?, is_admin = 1, active = 1 WHERE id = ?').run(hash, existing.id); console.log(`Updated ${a.email}: now an active admin with the new password.`) }
else { db.prepare('INSERT INTO users (email, name, password_hash, is_admin) VALUES (?,?,?,1)').run(a.email, a.name, hash); console.log(`Created admin ${a.email}.`) }

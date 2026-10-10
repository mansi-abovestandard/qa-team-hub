import crypto from 'node:crypto'
import { HttpError, forbidden, bad } from './http.js'

const SESSION_DAYS = 14
const scrypt = (pw, salt) => new Promise((res, rej) => crypto.scrypt(pw, salt, 64, { N: 16384 }, (e, k) => (e ? rej(e) : res(k))))

export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16)
  const key = await scrypt(pw, salt)
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`
}
export async function verifyPassword(pw, stored) {
  const [alg, saltHex, keyHex] = String(stored).split('$')
  if (alg !== 'scrypt') return false
  const key = await scrypt(pw, Buffer.from(saltHex, 'hex'))
  const want = Buffer.from(keyHex, 'hex')
  return key.length === want.length && crypto.timingSafeEqual(key, want)
}
export function checkPasswordStrength(pw) {
  if (typeof pw !== 'string' || pw.length < 10) throw bad('Password must be at least 10 characters')
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) throw bad('Password must contain letters and numbers')
}

const sha = (t) => crypto.createHash('sha256').update(t).digest('hex')
const COOKIE = 'qa_session'

export function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('base64url')
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString()
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha(token), userId, expires)
  return { token, expires }
}
export function setCookie(res, token, expires) {
  const secure = process.env.COOKIE_SECURE === 'true' ? '; Secure' : ''
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${new Date(expires).toUTCString()}${secure}`)
}
export function clearCookie(res) { res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`) }
const readCookie = (req) => {
  const m = String(req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`))
  return m ? m[1] : null
}
export function destroySession(db, req) {
  const t = readCookie(req); if (t) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(t))
}

// attaches req.user (or null)
export const sessionMiddleware = (db) => (req, _res, next) => {
  req.user = null
  const t = readCookie(req)
  if (t) {
    const row = db.prepare(`SELECT u.id, u.email, u.name, u.is_admin, u.active, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`).get(sha(t))
    if (row && row.active && row.expires_at > new Date().toISOString()) req.user = { id: row.id, email: row.email, name: row.name, isAdmin: !!row.is_admin }
  }
  next()
}
export const requireUser = (req, _res, next) => (req.user ? next() : next(new HttpError(401, 'Please sign in')))
export const requireAdmin = (req, _res, next) => (!req.user ? next(new HttpError(401, 'Please sign in')) : req.user.isAdmin ? next() : next(forbidden('Only an admin can do this')))

// CSRF defence for cookie auth: mutating requests must be JSON (cannot be sent by a plain HTML form) and same-origin
export const csrfGuard = (req, _res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next()
  const origin = req.headers.origin
  if (origin && new URL(origin).host !== req.headers.host) return next(forbidden('Cross-site request blocked'))
  const hasBody = Number(req.headers['content-length'] || 0) > 0
  if (hasBody && !String(req.headers['content-type'] || '').includes('application/json')) return next(new HttpError(415, 'JSON required'))
  next()
}

// simple in-memory login throttle: 8 tries / 10 min per ip+email
const attempts = new Map()
export function throttle(key) {
  const now = Date.now(); const list = (attempts.get(key) || []).filter((t) => now - t < 600000)
  if (list.length >= 8) throw new HttpError(429, 'Too many attempts. Wait a few minutes and try again.')
  list.push(now); attempts.set(key, list)
}
export const clearThrottle = (key) => attempts.delete(key)

// project role: admin > editor > QA (stored as tester) > viewer. Global admins act as project admins everywhere.
const RANK = { viewer: 0, tester: 1, editor: 2, admin: 3 }
export function projectRole(db, user, projectId) {
  if (!user) return null
  if (user.isAdmin) return 'admin'
  const r = db.prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?').get(projectId, user.id)
  return r ? r.role : null
}
export function requireProjectRole(db, user, projectId, min = 'viewer') {
  const role = projectRole(db, user, projectId)
  if (!role) throw forbidden('You are not a member of this project')
  if (RANK[role] < RANK[min]) throw forbidden(`This needs the ${min} role in this project`)
  return role
}

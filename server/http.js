export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status }
}
export const bad = (m) => new HttpError(400, m)
export const notFound = (m = 'Not found') => new HttpError(404, m)
export const forbidden = (m = 'You do not have access to this') => new HttpError(403, m)
export const str = (v, max = 5000) => String(v ?? '').trim().slice(0, max)
export const oneOf = (v, list, label) => { if (!list.includes(v)) throw bad(`${label} must be one of: ${list.join(', ')}`); return v }
// wrap async handlers so errors reach the error middleware
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

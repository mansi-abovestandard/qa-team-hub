export class ApiError extends Error { constructor(status, message) { super(message); this.status = status } }

export async function api(method, url, body) {
  const res = await fetch(url, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' })
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/api/auth/')) window.dispatchEvent(new Event('qa-unauthorized'))
    throw new ApiError(res.status, (data && data.error) || res.statusText)
  }
  return data
}
export const get = (u) => api('GET', u)
export const post = (u, b = {}) => api('POST', u, b)
export const put = (u, b = {}) => api('PUT', u, b)
export const patch = (u, b = {}) => api('PATCH', u, b)
export const del = (u) => api('DELETE', u)

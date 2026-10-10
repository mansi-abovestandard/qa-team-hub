import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

// ---- toasts
const ToastCtx = createContext(() => {})
export const useToast = () => useContext(ToastCtx)
export function ToastProvider({ children }) {
  const [msg, setMsg] = useState(null)
  const t = useRef()
  const show = useCallback((text, kind = 'info') => { setMsg({ text, kind }); clearTimeout(t.current); t.current = setTimeout(() => setMsg(null), 4500) }, [])
  return <ToastCtx.Provider value={show}>{children}{msg && <div className={`toast ${msg.kind}`} role="status">{msg.text}</div>}</ToastCtx.Provider>
}

// ---- modal
export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head"><h2>{title}</h2><button className="icon" onClick={onClose} aria-label="Close">×</button></div>
        {children}
      </div>
    </div>
  )
}

export function Field({ label, children, hint }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>
}

export const STATUSES = ['Not tested', 'Pass', 'Fail', 'Blocked', 'Not applicable']
export const pct = (x) => `${Math.round((x || 0) * 100)}%`
export const fmtDate = (s) => (s ? new Date(s).toLocaleString('da-DK', { dateStyle: 'short', timeStyle: 'short' }) : '')

export function Verdict({ stats, compact }) {
  const cls = { GO: 'go', 'GO WITH RISKS': 'risk', 'NO-GO': 'nogo' }[stats.verdict]
  if (compact) return <span className={`pill ${cls}`}>{stats.verdict}</span>
  return (
    <div className={`verdict ${cls}`}>
      <strong>{stats.verdict}</strong> <span>{stats.verdictText}</span>
      {stats.reasons.length > 0 && <ul>{stats.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
    </div>
  )
}
export function Progress({ stats }) {
  return (
    <div>
      <div className="muted">{stats.tested} of {stats.applicable} checked ({pct(stats.progress)}) · pass rate {pct(stats.passRate)}</div>
      <div className="bar"><i style={{ width: pct(stats.progress) }} /></div>
    </div>
  )
}
export function Counters({ counts }) {
  return (
    <div className="counters">
      {['Pass', 'Fail', 'Blocked', 'Not tested', 'Not applicable'].map((k) => (
        <div key={k} className={`counter c-${k.replace(/ /g, '')}`}><div className="n">{counts[k]}</div>{k}</div>
      ))}
    </div>
  )
}
export function useAsync(fn, deps) {
  const [state, set] = useState({ loading: true, data: null, error: null })
  const reload = useCallback(() => {
    set((s) => ({ ...s, loading: true }))
    return fn().then((data) => set({ loading: false, data, error: null })).catch((error) => set({ loading: false, data: null, error }))
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { reload() }, [reload])
  return { ...state, reload, setData: (data) => set((s) => ({ ...s, data })) }
}
export function Loading({ state }) {
  if (state.loading && !state.data) return <div className="empty">Loading…</div>
  if (state.error) return <div className="empty error">{state.error.message}</div>
  return null
}

import { useState } from 'react'
import { post } from '../api.js'
import { Field } from '../ui.jsx'
import { ThemeToggle } from '../theme.jsx'

export default function Login({ needsSetup, onDone }) {
  const [f, setF] = useState({ name: '', email: '', password: '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const submit = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true)
    try { await post(needsSetup ? '/api/auth/setup' : '/api/auth/login', f); await onDone() } catch (x) { setErr(x.message) } finally { setBusy(false) }
  }
  return (
    <div className="login">
      <div className="login-bar"><ThemeToggle /></div>
      <form className="card" onSubmit={submit}>
        <h1>QA Team Hub</h1>
        <p className="muted">{needsSetup ? 'First start: create the admin account for your team.' : 'Sign in to continue.'}</p>
        {needsSetup && <Field label="Your name"><input value={f.name} onChange={set('name')} required autoFocus /></Field>}
        <Field label="Email"><input type="email" value={f.email} onChange={set('email')} required autoFocus={!needsSetup} autoComplete="username" /></Field>
        <Field label="Password" hint={needsSetup ? 'At least 10 characters, with letters and numbers.' : undefined}>
          <input type="password" value={f.password} onChange={set('password')} required autoComplete={needsSetup ? 'new-password' : 'current-password'} />
        </Field>
        {err && <div className="error-box">{err}</div>}
        <button className="primary" disabled={busy}>{needsSetup ? 'Create admin and start' : 'Sign in'}</button>
      </form>
    </div>
  )
}

import { useState } from 'react'
import { patch, post } from '../api.js'
import { useAuth } from '../auth.js'
import { Field, useToast } from '../ui.jsx'

export default function Profile() {
  const { user, refresh } = useAuth()
  const toast = useToast()
  const [name, setName] = useState(user.name)
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' })
  const [busyName, setBusyName] = useState(false)
  const [busyPw, setBusyPw] = useState(false)

  const saveName = async (e) => {
    e.preventDefault()
    setBusyName(true)
    try { await patch('/api/auth/profile', { name }); await refresh(); toast('Name saved', 'ok') }
    catch (x) { toast(x.message, 'error') }
    finally { setBusyName(false) }
  }
  const savePassword = async (e) => {
    e.preventDefault()
    if (pw.next !== pw.confirm) { toast('The new password and the confirmation do not match', 'error'); return }
    setBusyPw(true)
    try {
      await post('/api/auth/password', { current: pw.current, next: pw.next })
      setPw({ current: '', next: '', confirm: '' })
      toast('Password changed. Use it the next time you sign in.', 'ok')
    } catch (x) { toast(x.message, 'error') }
    finally { setBusyPw(false) }
  }
  return (
    <div className="stack narrow-page">
      <h1>Your profile</h1>
      <p className="muted">You are signed in as <b>{user.email}</b>{user.isAdmin ? ' (global admin)' : ''}. This page changes only your account.</p>
      <form className="card" onSubmit={saveName}>
        <h3>Name</h3>
        <Field label="Name shown in the app"><input value={name} onChange={(e) => setName(e.target.value)} required /></Field>
        <Field label="Email"><input value={user.email} readOnly /></Field>
        <button className="primary" disabled={busyName}>Save name</button>
      </form>
      <form className="card" onSubmit={savePassword}>
        <h3>Change your password</h3>
        <Field label="Current password"><input type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required autoComplete="current-password" /></Field>
        <Field label="New password" hint="At least 10 characters, with letters and numbers."><input type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} required autoComplete="new-password" /></Field>
        <Field label="Confirm new password"><input type="password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} required autoComplete="new-password" /></Field>
        <button className="primary" disabled={busyPw}>Change password</button>
      </form>
    </div>
  )
}

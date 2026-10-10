import { useState } from 'react'
import { get, patch, post } from '../api.js'
import { Field, Loading, Modal, useAsync, useToast } from '../ui.jsx'

export default function Users() {
  const toast = useToast()
  const st = useAsync(() => get('/api/users'), [])
  const [add, setAdd] = useState(false); const [reset, setReset] = useState(null)
  const change = async (u, body) => { try { await patch(`/api/users/${u.id}`, body); st.reload() } catch (x) { toast(x.message, 'error') } }
  return (
    <div>
      <div className="page-head"><h1>Team</h1><button className="primary" onClick={() => setAdd(true)}>Add a person</button></div>
      <p className="muted">Everyone who can sign in. Give people access to projects under each project's Settings. A global admin can manage every project.</p>
      <Loading state={st} />
      {st.data && (
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Global admin</th><th>Active</th><th /></tr></thead>
          <tbody>{st.data.map((u) => (
            <tr key={u.id} className={u.active ? '' : 'dim'}><td>{u.name}</td><td>{u.email}</td>
              <td><input type="checkbox" checked={u.isAdmin} onChange={(e) => change(u, { isAdmin: e.target.checked })} aria-label="Global admin" /></td>
              <td><input type="checkbox" checked={u.active} onChange={(e) => change(u, { active: e.target.checked })} aria-label="Active" /></td>
              <td><button className="ghost small" onClick={() => setReset(u)}>Set new password</button></td></tr>
          ))}</tbody>
        </table>
      )}
      {add && <UserModal onClose={() => setAdd(false)} onSaved={() => { setAdd(false); st.reload() }} />}
      {reset && <ResetModal user={reset} onClose={() => setReset(null)} />}
    </div>
  )
}
function UserModal({ onClose, onSaved }) {
  const toast = useToast()
  const [f, setF] = useState({ name: '', email: '', password: '', isAdmin: false })
  const submit = async (e) => { e.preventDefault(); try { await post('/api/users', f); toast('Person added', 'ok'); onSaved() } catch (x) { toast(x.message, 'error') } }
  return (
    <Modal title="Add a person" onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="Name"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required autoFocus /></Field>
        <Field label="Email"><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></Field>
        <Field label="Temporary password" hint="At least 10 characters, letters and numbers. Tell them to change it after signing in."><input type="text" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required /></Field>
        <label className="check"><input type="checkbox" checked={f.isAdmin} onChange={(e) => setF({ ...f, isAdmin: e.target.checked })} /> Global admin (can manage every project and all people)</label>
        <div className="actions"><button type="button" className="ghost" onClick={onClose}>Cancel</button><button className="primary">Add</button></div>
      </form>
    </Modal>
  )
}
function ResetModal({ user, onClose }) {
  const toast = useToast(); const [pw, setPw] = useState('')
  const submit = async (e) => { e.preventDefault(); try { await patch(`/api/users/${user.id}`, { password: pw }); toast('Password changed. They are signed out.', 'ok'); onClose() } catch (x) { toast(x.message, 'error') } }
  return (
    <Modal title={`New password for ${user.name}`} onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="New password" hint="At least 10 characters, letters and numbers."><input type="text" value={pw} onChange={(e) => setPw(e.target.value)} required autoFocus /></Field>
        <div className="actions"><button type="button" className="ghost" onClick={onClose}>Cancel</button><button className="primary">Change password</button></div>
      </form>
    </Modal>
  )
}

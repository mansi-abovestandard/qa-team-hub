import { useEffect, useState } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { del, get, patch, post, put } from '../api.js'
import { useAuth } from '../auth.js'
import { Field, Loading, useAsync, useToast } from '../ui.jsx'

export default function Settings() {
  const { pid } = useParams(); const { project, reloadProject } = useOutletContext()
  const { user } = useAuth(); const toast = useToast(); const nav = useNavigate()
  const users = useAsync(() => get('/api/users'), [])
  const detail = useAsync(() => get(`/api/projects/${pid}`), [pid])
  const [f, setF] = useState({ name: project.name, description: project.description || '', baseUrl: project.baseUrl || '', recipients: (project.recipients || []).join(', ') })
  const [members, setMembers] = useState(null)
  const [tplName, setTplName] = useState('')
  useEffect(() => { if (detail.data) setMembers(detail.data.members.map((m) => ({ userId: m.id, role: m.role }))) }, [detail.data])

  const saveDetails = async (e) => {
    e.preventDefault()
    try { await patch(`/api/projects/${pid}`, f); toast('Saved', 'ok'); reloadProject() } catch (x) { toast(x.message, 'error') }
  }
  const saveMembers = async () => {
    try { await put(`/api/projects/${pid}/members`, { members }); toast('Team saved', 'ok'); detail.reload() } catch (x) { toast(x.message, 'error') }
  }
  const setRole = (uid, role) => setMembers((m) => {
    const rest = (m || []).filter((x) => x.userId !== uid)
    return role ? [...rest, { userId: uid, role }] : rest
  })
  const roleOf = (uid) => members?.find((m) => m.userId === uid)?.role || ''
  const saveTpl = async () => {
    try { const r = await post(`/api/projects/${pid}/save-as-template`, { name: tplName }); toast(`Template saved with ${r.items} tasks`, 'ok'); setTplName('') } catch (x) { toast(x.message, 'error') }
  }
  const archive = async () => {
    if (!window.confirm(`Archive project "${project.name}"? It disappears from the list (data is kept in the database).`)) return
    try { await del(`/api/projects/${pid}`); nav('/') } catch (x) { toast(x.message, 'error') }
  }
  return (
    <div className="stack">
      <form className="card" onSubmit={saveDetails}>
        <h3>Project details</h3>
        <Field label="Name"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
        <Field label="Description"><input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <Field label="Website address (automatic checks)"><input value={f.baseUrl} onChange={(e) => setF({ ...f, baseUrl: e.target.value })} placeholder="https://" /></Field>
        <Field label="Who gets the final report by email" hint="Separate addresses with commas. For the Saturday report use mk@abovestandard.dk, mg@abovestandard.dk, pm@abovestandard.dk. SMTP settings are in the server's .env file."><input value={f.recipients} onChange={(e) => setF({ ...f, recipients: e.target.value })} placeholder="mk@abovestandard.dk, mg@abovestandard.dk, pm@abovestandard.dk" /></Field>
        <button className="primary">Save details</button>
      </form>

      <div className="card">
        <h3>Team on this project</h3>
        <p className="muted"><b>admin</b> manages tasks, team and settings. <b>editor</b> can test and can add branches and record staging and production deploys. <b>QA</b> runs rounds, sets statuses, reports bugs, and records staging and live test results. <b>viewer</b> can read. Global admins can do everything everywhere.</p>
        <Loading state={users} />
        {users.data && members && (
          <table>
            <thead><tr><th>Person</th><th>Role in this project</th></tr></thead>
            <tbody>{users.data.filter((u) => u.active).map((u) => (
              <tr key={u.id}><td>{u.name} <span className="muted">{u.email}{u.isAdmin ? ' · global admin' : ''}</span></td>
                <td><select value={roleOf(u.id)} onChange={(e) => setRole(u.id, e.target.value)}>
                  <option value="">No access</option><option value="viewer">viewer</option><option value="tester">QA</option><option value="editor">editor</option><option value="admin">admin</option></select></td></tr>
            ))}</tbody>
          </table>
        )}
        <button className="primary" onClick={saveMembers}>Save team</button>
      </div>

      {user.isAdmin && (
        <div className="card">
          <h3>Reuse this checklist</h3>
          <p className="muted">Save this project's tasks as a template so other projects can start from it.</p>
          <div className="row gap"><input placeholder="Template name" value={tplName} onChange={(e) => setTplName(e.target.value)} /><button className="ghost" disabled={!tplName.trim()} onClick={saveTpl}>Save as template</button></div>
          <hr />
          <button className="ghost danger" onClick={archive}>Archive this project</button>
        </div>
      )}
    </div>
  )
}

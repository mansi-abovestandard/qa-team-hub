import { useState } from 'react'
import { useOutletContext, useParams } from 'react-router-dom'
import { get, patch } from '../api.js'
import { Field, Loading, Modal, fmtDate, useAsync, useToast } from '../ui.jsx'

const OPEN = ['open', 'in_progress', 'fixed']
export default function Bugs() {
  const { pid } = useParams(); const { canTest } = useOutletContext()
  const st = useAsync(() => get(`/api/projects/${pid}/bugs`), [pid])
  const users = useAsync(() => get('/api/users'), [])
  const [filter, setFilter] = useState('open'); const [sel, setSel] = useState(null)
  const list = (st.data || []).filter((b) => filter === 'all' || (filter === 'open' ? OPEN.includes(b.status) : b.status === filter))
  return (
    <div>
      <div className="filters">
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="open">Open (open, in progress, fixed)</option><option value="all">All</option>
          <option value="verified">Verified</option><option value="wontfix">Won't fix</option>
        </select>
        <span className="muted">{list.length} bug(s). "fixed" means fixed but not yet verified in a round. Bugs are reported from a task inside a test round.</span>
      </div>
      <Loading state={st} />
      {st.data && list.length === 0 && <div className="empty">No bugs here.</div>}
      {list.length > 0 && (
        <table>
          <thead><tr><th>Bug</th><th>Severity</th><th>Status</th><th>Title</th><th>Task</th><th>Assigned</th><th>Updated</th><th /></tr></thead>
          <tbody>{list.map((b) => (
            <tr key={b.dbId}><td className="mono">{b.id}</td><td><span className={`sev ${b.severity}`}>{b.severity}</span></td><td>{b.status.replace('_', ' ')}</td>
              <td>{b.title}{b.actual && <div className="muted small">{b.actual.slice(0, 140)}</div>}</td><td className="mono">{b.itemId}</td><td>{b.assignee}</td><td>{fmtDate(b.updatedAt)}</td>
              <td><button className="ghost small" onClick={() => setSel(b)}>Open</button></td></tr>
          ))}</tbody>
        </table>
      )}
      {sel && <BugModal bug={sel} users={users.data || []} canTest={canTest} onClose={() => setSel(null)} onSaved={() => { setSel(null); st.reload() }} />}
    </div>
  )
}

function BugModal({ bug, users, canTest, onClose, onSaved }) {
  const toast = useToast()
  const ev = useAsync(() => get(`/api/bugs/${bug.dbId}/events`), [bug.dbId])
  const [f, setF] = useState({ status: bug.status, severity: bug.severity, assigneeId: users.find((u) => u.name === bug.assignee)?.id || '', comment: '' })
  const save = async () => {
    try { await patch(`/api/bugs/${bug.dbId}`, { status: f.status, severity: f.severity, assigneeId: f.assigneeId || null, comment: f.comment || undefined }); toast('Bug updated', 'ok'); onSaved() } catch (x) { toast(x.message, 'error') }
  }
  return (
    <Modal title={`${bug.id} - ${bug.title}`} onClose={onClose} wide>
      <div className="two">
        <Field label="Status"><select value={f.status} disabled={!canTest} onChange={(e) => setF({ ...f, status: e.target.value })}>
          {['open', 'in_progress', 'fixed', 'verified', 'wontfix'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select></Field>
        <Field label="Severity"><select value={f.severity} disabled={!canTest} onChange={(e) => setF({ ...f, severity: e.target.value })}>{['critical', 'major', 'minor', 'trivial'].map((s) => <option key={s}>{s}</option>)}</select></Field>
      </div>
      <Field label="Assigned to"><select value={f.assigneeId} disabled={!canTest} onChange={(e) => setF({ ...f, assigneeId: e.target.value })}><option value="">Nobody</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
      {bug.stepsToReproduce && <p><b>What was done:</b><br />{bug.stepsToReproduce}</p>}
      {bug.expected && <p><b>Expected:</b><br />{bug.expected}</p>}
      {bug.actual && <p><b>What happened:</b><br />{bug.actual}</p>}
      {bug.url && <p><b>Page:</b> {bug.url}</p>}
      <h4>History</h4>
      <ul className="history">{(ev.data || []).map((e, i) => <li key={i}><span className="muted">{fmtDate(e.at + 'Z')}</span> {e.by ? <b>{e.by}: </b> : null}{e.text}</li>)}</ul>
      {canTest && <Field label="Add a comment"><textarea rows={2} value={f.comment} onChange={(e) => setF({ ...f, comment: e.target.value })} /></Field>}
      <div className="actions"><button className="ghost" onClick={onClose}>Close</button>{canTest && <button className="primary" onClick={save}>Save</button>}</div>
    </Modal>
  )
}

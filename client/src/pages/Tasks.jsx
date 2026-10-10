import { useMemo, useState } from 'react'
import { useOutletContext, useParams } from 'react-router-dom'
import { del, get, patch, post } from '../api.js'
import { Field, Loading, Modal, useAsync, useToast } from '../ui.jsx'

export default function Tasks() {
  const { pid } = useParams(); const { canAdmin } = useOutletContext()
  const toast = useToast()
  const st = useAsync(() => get(`/api/projects/${pid}/tasks`), [pid])
  const [q, setQ] = useState(''); const [area, setArea] = useState('')
  const [edit, setEdit] = useState(null); const [imp, setImp] = useState(false)
  const tasks = st.data || []
  const areas = useMemo(() => [...new Set(tasks.map((t) => t.area))], [tasks])
  const list = tasks.filter((t) => (!area || t.area === area) && (!q || `${t.code} ${t.title} ${t.group}`.toLowerCase().includes(q.toLowerCase())))
  const remove = async (t) => {
    if (!window.confirm(`Remove "${t.title}" from the checklist?\nOld test rounds keep their copy.`)) return
    try { await del(`/api/tasks/${t.id}`); toast('Task removed', 'ok'); st.reload() } catch (x) { toast(x.message, 'error') }
  }
  return (
    <div>
      <div className="page-head">
        <p className="muted">These tasks are copied into every new test round. Changes here apply to the <b>next</b> round; finished rounds keep their own copy.</p>
        {canAdmin && <div className="row gap">
          <button className="primary" onClick={() => setEdit({})}>Add a task</button>
          <button className="ghost" onClick={() => setImp(true)}>Import CSV</button>
          <a className="btn ghost" href={`/api/projects/${pid}/tasks.csv`}>Download CSV</a>
        </div>}
      </div>
      <div className="filters">
        <input type="search" placeholder="Search code, task or page…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={area} onChange={(e) => setArea(e.target.value)}><option value="">All areas</option>{areas.map((a) => <option key={a}>{a}</option>)}</select>
        <span className="muted">{list.length} of {tasks.length} tasks</span>
      </div>
      <Loading state={st} />
      {st.data && tasks.length === 0 && <div className="empty">No tasks yet. {canAdmin ? 'Add one or import a CSV.' : ''}</div>}
      {tasks.length > 0 && (
        <table>
          <thead><tr><th>Code</th><th>Area</th><th>Page / module</th><th>Task</th><th>Priority</th>{canAdmin && <th />}</tr></thead>
          <tbody>
            {list.slice(0, 1000).map((t) => (
              <tr key={t.id}><td className="mono">{t.code}</td><td>{t.area}</td><td>{t.group}</td><td>{t.title}{t.auto && <span className="chip auto">automatic</span>}</td><td><span className={`chip ${t.priority}`}>{t.priority}</span></td>
                {canAdmin && <td className="nowrap"><button className="ghost small" onClick={() => setEdit(t)}>Edit</button> <button className="ghost small danger" onClick={() => remove(t)}>Remove</button></td>}</tr>
            ))}
          </tbody>
        </table>
      )}
      {list.length > 1000 && <div className="muted">Showing the first 1000.</div>}
      {edit && <TaskModal pid={pid} task={edit} areas={areas} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); st.reload() }} />}
      {imp && <ImportModal pid={pid} onClose={() => setImp(false)} onDone={() => { setImp(false); st.reload() }} />}
    </div>
  )
}

function TaskModal({ pid, task, areas, onClose, onSaved }) {
  const toast = useToast()
  const [f, setF] = useState({ title: task.title || '', area: task.area || '', group: task.group || '', steps: task.steps || '', expected: task.expected || '', priority: task.priority || 'medium', code: task.code || '' })
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const submit = async (e) => {
    e.preventDefault()
    try {
      if (task.id) await patch(`/api/tasks/${task.id}`, f); else await post(`/api/projects/${pid}/tasks`, f)
      toast('Task saved', 'ok'); onSaved()
    } catch (x) { toast(x.message, 'error') }
  }
  return (
    <Modal title={task.id ? `Edit ${task.code}` : 'Add a task'} onClose={onClose} wide>
      <form onSubmit={submit}>
        <Field label="Task (what to check) *"><input value={f.title} onChange={set('title')} required autoFocus /></Field>
        <div className="two">
          <Field label="Area" hint="e.g. Public website, CMS admin, Mobile app"><input value={f.area} onChange={set('area')} list="areas" /></Field>
          <Field label="Page or module" hint="e.g. Home page - /"><input value={f.group} onChange={set('group')} /></Field>
        </div>
        <datalist id="areas">{areas.map((a) => <option key={a} value={a} />)}</datalist>
        <Field label="How to test (steps)"><textarea rows={3} value={f.steps} onChange={set('steps')} /></Field>
        <Field label="You pass if…"><textarea rows={3} value={f.expected} onChange={set('expected')} /></Field>
        <div className="two">
          <Field label="Priority"><select value={f.priority} onChange={set('priority')}><option>high</option><option>medium</option><option>low</option></select></Field>
          {!task.id && <Field label="Code (optional)" hint="Leave empty for an automatic code"><input value={f.code} onChange={set('code')} /></Field>}
        </div>
        <div className="actions"><button type="button" className="ghost" onClick={onClose}>Cancel</button><button className="primary">Save task</button></div>
      </form>
    </Modal>
  )
}

function ImportModal({ pid, onClose, onDone }) {
  const toast = useToast()
  const [csv, setCsv] = useState('')
  const readFile = (e) => { const f = e.target.files?.[0]; if (f) f.text().then(setCsv) }
  const submit = async (e) => {
    e.preventDefault()
    try { const r = await post(`/api/projects/${pid}/tasks/import`, { csv }); toast(`${r.added} task(s) added, ${r.skipped} skipped (code already exists)`, 'ok'); onDone() } catch (x) { toast(x.message, 'error') }
  }
  return (
    <Modal title="Import tasks from CSV" onClose={onClose} wide>
      <form onSubmit={submit}>
        <p className="muted">First row must be the column names. Needed: <b>title</b>. Optional: code, area, group (page or module), steps, expected, priority (high / medium / low). Existing codes are skipped.</p>
        <input type="file" accept=".csv,text/csv" onChange={readFile} />
        <Field label="…or paste CSV here"><textarea rows={8} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={'code,area,group,title,expected,priority\nA-1,Admin,Orders,Create an order,Order is saved,high'} /></Field>
        <div className="actions"><button type="button" className="ghost" onClick={onClose}>Cancel</button><button className="primary" disabled={!csv.trim()}>Import</button></div>
      </form>
    </Modal>
  )
}

import { useMemo, useState } from 'react'
import { useOutletContext, useParams } from 'react-router-dom'
import { del, get, patch, post } from '../api.js'
import { Field, Loading, Modal, useAsync, useToast } from '../ui.jsx'

export default function Tasks() {
  const { pid } = useParams(); const { canAdmin } = useOutletContext()
  const toast = useToast()
  const st = useAsync(() => get(`/api/projects/${pid}/tasks`), [pid])
  const [q, setQ] = useState(''); const [area, setArea] = useState(''); const [group, setGroup] = useState('')
  const [edit, setEdit] = useState(null); const [imp, setImp] = useState(false)
  const tasks = st.data || []
  const areas = useMemo(() => [...new Set(tasks.map((t) => t.area))], [tasks])
  const groups = useMemo(() => [...new Set(tasks.filter((t) => !area || t.area === area).map((t) => t.group))], [tasks, area])
  const list = tasks.filter((t) => (!area || t.area === area) && (!group || t.group === group) && (!q || `${t.code} ${t.title} ${t.group} ${t.steps} ${t.expected}`.toLowerCase().includes(q.toLowerCase())))
  const remove = async (t) => {
    if (!window.confirm(`Remove "${t.title}" from the checklist?\nOld test rounds keep their copy.`)) return
    try { await del(`/api/tasks/${t.id}`); toast('Task removed', 'ok'); st.reload() } catch (x) { toast(x.message, 'error') }
  }
  return (
    <div>
      <div className="page-head">
        <p className="muted">Each task shows what to test and the expected result. Public website tasks are grouped by page and section. CMS tasks are grouped by module and section. A new module is added with Import CSV; existing tasks stay. Changes here apply to the <b>next</b> round; finished rounds keep their own copy.</p>
        {canAdmin && <div className="row gap">
          <button className="primary" onClick={() => setEdit({})}>Add a task</button>
          <button className="ghost" onClick={() => setImp(true)}>Import CSV</button>
          <a className="btn ghost" href={`/api/projects/${pid}/tasks.csv`}>Download CSV</a>
        </div>}
      </div>
      <div className="filters">
        <input type="search" placeholder="Search code, task, page or expected result…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={area} onChange={(e) => { setArea(e.target.value); setGroup('') }}><option value="">All areas</option>{areas.map((a) => <option key={a}>{a}</option>)}</select>
        <select value={group} onChange={(e) => setGroup(e.target.value)}><option value="">All pages / modules</option>{groups.map((g) => <option key={g}>{g}</option>)}</select>
        <span className="muted">{list.length} of {tasks.length} tasks</span>
      </div>
      <Loading state={st} />
      {st.data && tasks.length === 0 && <div className="empty">No tasks yet. {canAdmin ? 'Add one or import a CSV.' : ''}</div>}
      {tasks.length > 0 && <TaskGroups tasks={list.slice(0, 1000)} canAdmin={canAdmin} onEdit={setEdit} onRemove={remove} />}
      {list.length > 1000 && <div className="muted">Showing the first 1000. Use the filters to narrow down.</div>}
      {edit && <TaskModal pid={pid} task={edit} areas={areas} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); st.reload() }} />}
      {imp && <ImportModal pid={pid} onClose={() => setImp(false)} onDone={() => { setImp(false); st.reload() }} />}
    </div>
  )
}

function TaskGroups({ tasks, canAdmin, onEdit, onRemove }) {
  let last = null
  return (
    <div>
      {tasks.map((t) => {
        const head = `${t.area} — ${t.group}`
        const showHead = head !== last; last = head
        return (
          <div key={t.id}>
            {showHead && <div className="group">{head}</div>}
            <div className="item">
              <div className="code">{t.code}</div>
              <div className="main">
                <div className="title">{t.title} <span className={`chip ${t.priority}`}>{t.priority}</span>{t.auto && <span className="chip auto">automatic</span>}</div>
                <div className="more"><b>What to test: </b>{t.steps || <span>Not written yet</span>}</div>
                <div className="more"><b>Expected result: </b>{t.expected || <span>Not written yet</span>}</div>
              </div>
              {canAdmin && <div className="row gap"><button className="ghost small" onClick={() => onEdit(t)}>Edit</button><button className="ghost small danger" onClick={() => onRemove(t)}>Remove</button></div>}
            </div>
          </div>
        )
      })}
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
        <Field label="What to test"><textarea rows={3} value={f.steps} onChange={set('steps')} placeholder="Open the page or CMS section and do this…" /></Field>
        <Field label="Expected result"><textarea rows={3} value={f.expected} onChange={set('expected')} placeholder="What you should see when it is correct" /></Field>
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
        <p className="muted">Adds the new page or CMS module <b>on top of the tasks already in this project</b>. A row whose code already exists is skipped, so the old checklist stays. First row must be the column names. Needed: <b>title</b>, <b>steps</b> (what to test) and <b>expected</b> (expected result). Also use code, area, group (page or module) and priority (high / medium / low).</p>
        <input type="file" accept=".csv,text/csv" onChange={readFile} />
        <Field label="…or paste CSV here"><textarea rows={8} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={'code,area,group,title,steps,expected,priority\nCMS-1,CMS admin,New module - Section,Save the form,Open the section and save,The form is stored,high'} /></Field>
        <div className="actions"><button type="button" className="ghost" onClick={onClose}>Cancel</button><button className="primary" disabled={!csv.trim()}>Import</button></div>
      </form>
    </Modal>
  )
}

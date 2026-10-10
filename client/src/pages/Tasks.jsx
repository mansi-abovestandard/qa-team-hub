import { useEffect, useMemo, useRef, useState } from 'react'
import { useOutletContext, useParams } from 'react-router-dom'
import { del, get, patch, post } from '../api.js'
import { Field, Loading, Modal, useAsync, useToast } from '../ui.jsx'

function groupSections(tasks) {
  const map = new Map()
  for (const t of tasks) {
    const key = `${t.area}\0${t.group}`
    if (!map.has(key)) map.set(key, { key, area: t.area, group: t.group, items: [] })
    map.get(key).items.push(t)
  }
  return [...map.values()]
}

export default function Tasks() {
  const { pid } = useParams(); const { canAdmin } = useOutletContext()
  const toast = useToast()
  const st = useAsync(() => get(`/api/projects/${pid}/tasks`), [pid])
  const [q, setQ] = useState(''); const [area, setArea] = useState('')
  const [sectionKey, setSectionKey] = useState(''); const [openId, setOpenId] = useState(null)
  const [edit, setEdit] = useState(null); const [imp, setImp] = useState(false)
  const pane = useRef(null)
  const tasks = st.data || []
  const areas = useMemo(() => [...new Set(tasks.map((t) => t.area))], [tasks])
  const list = tasks.filter((t) => (!area || t.area === area) && (!q || `${t.code} ${t.title} ${t.group} ${t.steps} ${t.expected}`.toLowerCase().includes(q.toLowerCase())))
  const sections = useMemo(() => groupSections(list), [list])
  useEffect(() => {
    if (!sections.some((s) => s.key === sectionKey)) setSectionKey(sections[0]?.key || '')
  }, [sections, sectionKey])
  const current = sections.find((s) => s.key === sectionKey) || sections[0]
  const index = sections.findIndex((s) => s.key === current?.key)
  const pick = (key) => { setSectionKey(key); setOpenId(null); pane.current?.scrollIntoView({ block: 'nearest' }) }
  const remove = async (t) => {
    if (!window.confirm(`Remove "${t.title}" from the checklist?\nOld test rounds keep their copy.`)) return
    try { await del(`/api/tasks/${t.id}`); toast('Task removed', 'ok'); st.reload() } catch (x) { toast(x.message, 'error') }
  }
  return (
    <div>
      <div className="page-head">
        <p className="muted">Pick a page or module on the left. Open a row to see what to test and the expected result. Import CSV adds a new module and leaves the existing tasks. Changes apply to the next round.</p>
        {canAdmin && <div className="row gap">
          <button className="primary" onClick={() => setEdit({})}>Add a task</button>
          <button className="ghost" onClick={() => setImp(true)}>Import CSV</button>
          <a className="btn ghost" href={`/api/projects/${pid}/tasks.csv`}>Download CSV</a>
        </div>}
      </div>
      <div className="filters">
        <input type="search" placeholder="Search code, task, page or expected result…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={area} onChange={(e) => setArea(e.target.value)}><option value="">All areas</option>{areas.map((a) => <option key={a}>{a}</option>)}</select>
        <span className="muted">{list.length} of {tasks.length} tasks · {sections.length} pages / modules</span>
      </div>
      <Loading state={st} />
      {st.data && tasks.length === 0 && <div className="empty">No tasks yet. {canAdmin ? 'Add one or import a CSV.' : ''}</div>}
      {tasks.length > 0 && sections.length === 0 && <div className="empty">No tasks match the search.</div>}
      {sections.length > 0 && (
        <div className="round-work">
          <nav className="section-nav" aria-label="Pages and modules">
            {sections.map((s, i) => {
              const showArea = i === 0 || sections[i - 1].area !== s.area
              return (
                <div key={s.key}>
                  {showArea && <div className="section-area">{s.area}</div>}
                  <button type="button" className={s.key === current.key ? 'on' : ''} onClick={() => pick(s.key)}>
                    <span className="g">{s.group}</span>
                    <span className="n">{s.items.length}</span>
                  </button>
                </div>
              )
            })}
          </nav>
          <div ref={pane}>
            <div className="row between section-head">
              <div><h3>{current.group}</h3><div className="muted small">{current.area} · {current.items.length} tasks</div></div>
              <div className="row gap">
                <button className="ghost small" disabled={index <= 0} onClick={() => pick(sections[index - 1].key)}>Previous</button>
                <button className="ghost small" disabled={index >= sections.length - 1} onClick={() => pick(sections[index + 1].key)}>Next</button>
              </div>
            </div>
            <div className="task-panel">
              {current.items.map((t) => (
                <TaskRow key={t.id} task={t} open={openId === t.id} onToggle={() => setOpenId(openId === t.id ? null : t.id)} canAdmin={canAdmin} onEdit={setEdit} onRemove={remove} />
              ))}
            </div>
          </div>
        </div>
      )}
      {edit && <TaskModal pid={pid} task={edit} areas={areas} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); st.reload() }} />}
      {imp && <ImportModal pid={pid} onClose={() => setImp(false)} onDone={() => { setImp(false); st.reload() }} />}
    </div>
  )
}

function TaskRow({ task, open, onToggle, canAdmin, onEdit, onRemove }) {
  return (
    <div className={`task${open ? ' open' : ''}`}>
      <div className="task-row">
        <button type="button" className="chev" aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} details for ${task.code}`} onClick={onToggle}>{open ? '▾' : '▸'}</button>
        <button type="button" className="task-title" onClick={onToggle}>
          <span className="code">{task.code}</span>
          <span className="title">{task.title}</span>
          <span className={`chip ${task.priority}`}>{task.priority}</span>
          {task.auto && <span className="chip auto">automatic</span>}
        </button>
      </div>
      {open && (
        <div className="task-detail">
          <div className="more"><b>What to test: </b>{task.steps || <span>Not written yet</span>}</div>
          <div className="more"><b>Expected result: </b>{task.expected || <span>Not written yet</span>}</div>
          {canAdmin && <div className="row gap task-actions"><button className="ghost small" onClick={() => onEdit(task)}>Edit</button><button className="ghost small danger" onClick={() => onRemove(task)}>Remove</button></div>}
        </div>
      )}
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

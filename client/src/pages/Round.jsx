import { useEffect, useMemo, useRef, useState } from 'react'
import { useOutletContext, useParams } from 'react-router-dom'
import { get, post, put } from '../api.js'
import { Counters, Field, Loading, Modal, Progress, STATUSES, Verdict, fmtDate, useAsync, useToast } from '../ui.jsx'

export default function Round() {
  const { rid, pid } = useParams(); const { canTest } = useOutletContext()
  const toast = useToast()
  const st = useAsync(() => get(`/api/runs/${rid}`), [rid])
  const [tab, setTab] = useState('checklist')
  const [f, setF] = useState({ area: '', priority: '', status: '', q: '' })
  const [bugFor, setBugFor] = useState(null)
  const [mail, setMail] = useState(null)
  const run = st.data
  const locked = !run || run.status === 'closed' || !canTest

  const refreshStats = async () => { const r = await get(`/api/runs/${rid}`); st.setData(r) }
  const setItem = async (code, body) => {
    try {
      await put(`/api/runs/${rid}/items/${encodeURIComponent(code)}`, body)
      // update locally for speed, then refresh numbers
      st.setData({ ...run, results: { ...run.results, [code]: { ...(run.results[code] || { bugIds: [] }), ...body } } })
      if (body.status) refreshStats()
    } catch (x) { toast(x.message, 'error') }
  }
  const items = useMemo(() => {
    if (!run) return []
    const q = f.q.toLowerCase()
    return run.items.filter((i) => {
      const s = run.results[i.id]?.status || 'Not tested'
      return (!f.area || i.area === f.area) && (!f.priority || i.priority === f.priority) && (!f.status || s === f.status) &&
        (!q || `${i.id} ${i.title} ${i.group}`.toLowerCase().includes(q))
    })
  }, [run, f])
  if (!run) return <Loading state={st} />
  const areas = [...new Set(run.items.map((i) => i.area))]

  const runAuto = async () => {
    try {
      toast('Running automatic checks…')
      const r = await post(`/api/runs/${rid}/auto-checks`, {})
      toast(`${r.applied.length} automatic results saved` + (r.browserSkipped ? ' (browser checks skipped)' : ''), 'ok'); await st.reload()
    } catch (x) { toast(x.message, 'error') }
  }
  return (
    <div>
      <div className="page-head">
        <div><h2>{run.name} <span className="muted">· {run.environment}</span></h2>
          <div className="muted">Round {run.label} · {run.status} · started {fmtDate(run.createdAt)}{run.createdBy ? ` by ${run.createdBy}` : ''}{run.baseUrl ? ` · ${run.baseUrl}` : ''}</div></div>
        <div className="row gap">
          <a className="btn ghost" href={`/api/runs/${rid}/report.html`} target="_blank" rel="noreferrer">Open report</a>
        </div>
      </div>
      {tab !== 'checklist' && <Verdict stats={run.stats} />}
      {tab !== 'checklist' && <Counters counts={run.stats.counts} />}
      {tab !== 'checklist' && <div className="card"><Progress stats={run.stats} /></div>}
      <nav className="tabs sub">
        <button className={tab === 'checklist' ? 'active' : ''} onClick={() => setTab('checklist')}>Checklist</button>
        <button className={tab === 'problems' ? 'active' : ''} onClick={() => setTab('problems')}>Problems by page / module ({run.stats.problems})</button>
        <button className={tab === 'finish' ? 'active' : ''} onClick={() => setTab('finish')}>Finish and email</button>
      </nav>

      {tab === 'checklist' && (
        <Checklist items={items} total={run.items.length} results={run.results} stats={run.stats} areas={areas} filters={f} setFilters={setF} locked={locked} onSet={setItem} onBug={(i) => setBugFor(i)} onAuto={runAuto} />
      )}
      {tab === 'problems' && <Problems rid={rid} />}
      {tab === 'finish' && <Finish run={run} locked={run.status === 'closed' || !canTest} onDone={st.reload} setMail={setMail} />}
      {bugFor && <BugModal pid={pid} run={run} item={bugFor} onClose={() => setBugFor(null)} onSaved={() => { setBugFor(null); st.reload() }} />}
      {mail}
    </div>
  )
}

function groupSections(items) {
  const map = new Map()
  for (const it of items) {
    const key = `${it.area}\0${it.group}`
    if (!map.has(key)) map.set(key, { key, area: it.area, group: it.group, items: [] })
    map.get(key).items.push(it)
  }
  return [...map.values()]
}

function Checklist({ items, total, results, stats, areas, filters, setFilters, locked, onSet, onBug, onAuto }) {
  const sections = useMemo(() => groupSections(items), [items])
  const [sectionKey, setSectionKey] = useState('')
  const [openId, setOpenId] = useState(null)
  const pane = useRef(null)
  useEffect(() => {
    if (!sections.some((s) => s.key === sectionKey)) setSectionKey(sections[0]?.key || '')
  }, [sections, sectionKey])
  const current = sections.find((s) => s.key === sectionKey) || sections[0]
  const index = sections.findIndex((s) => s.key === current?.key)
  const pick = (key) => { setSectionKey(key); setOpenId(null); pane.current?.scrollIntoView({ block: 'nearest' }) }
  const statusOf = (id) => results[id]?.status || 'Not tested'
  const doneIn = (list) => list.filter((it) => statusOf(it.id) !== 'Not tested').length
  const setStatus = (status) => setFilters({ ...filters, status: filters.status === status ? '' : status })
  return (
    <>
      <div className="round-summary">
        <Verdict stats={stats} compact />
        <button type="button" className={`chip-btn ${filters.status === '' ? 'on' : ''}`} onClick={() => setFilters({ ...filters, status: '' })}>All {total}</button>
        {STATUSES.map((s) => (
          <button key={s} type="button" className={`chip-btn c-${s.replace(/ /g, '')} ${filters.status === s ? 'on' : ''}`} onClick={() => setStatus(s)}>
            {stats.counts[s]} {s === 'Not applicable' ? 'N/A' : s}
          </button>
        ))}
        <div className="summary-bar"><Progress stats={stats} /></div>
      </div>
      <div className="filters">
        <input type="search" placeholder="Search code, task or page…" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
        <select value={filters.area} onChange={(e) => setFilters({ ...filters, area: e.target.value })}><option value="">All areas</option>{areas.map((a) => <option key={a}>{a}</option>)}</select>
        <select value={filters.priority} onChange={(e) => setFilters({ ...filters, priority: e.target.value })}><option value="">All priorities</option><option>high</option><option>medium</option><option>low</option></select>
        {!locked && <button className="ghost" onClick={onAuto}>Run automatic checks</button>}
        <span className="muted">{items.length} match · {sections.length} pages / modules</span>
      </div>
      {sections.length === 0 && <div className="empty">No tasks match the filters.</div>}
      {sections.length > 0 && (
        <div className="round-work">
          <nav className="section-nav" aria-label="Pages and modules">
            {sections.map((s, i) => {
              const showArea = i === 0 || sections[i - 1].area !== s.area
              const done = doneIn(s.items)
              return (
                <div key={s.key}>
                  {showArea && <div className="section-area">{s.area}</div>}
                  <button type="button" className={s.key === current.key ? 'on' : ''} onClick={() => pick(s.key)}>
                    <span className="g">{s.group}<span className="a">{done === s.items.length ? 'Done' : `${s.items.length - done} left`}</span>
                      <span className="meter"><i style={{ width: `${Math.round((done / s.items.length) * 100)}%` }} /></span>
                    </span>
                    <span className="n">{done}/{s.items.length}</span>
                  </button>
                </div>
              )
            })}
          </nav>
          <div ref={pane}>
            <div className="row between section-head">
              <div><h3>{current.group}</h3><div className="muted small">{current.area} · {doneIn(current.items)} of {current.items.length} checked</div></div>
              <div className="row gap">
                <button className="ghost small" disabled={index <= 0} onClick={() => pick(sections[index - 1].key)}>Previous</button>
                <button className="ghost small" disabled={index >= sections.length - 1} onClick={() => pick(sections[index + 1].key)}>Next</button>
              </div>
            </div>
            <div className="task-panel">
              {current.items.map((it) => (
                <Item key={it.id} it={it} r={results[it.id] || { status: 'Not tested', notes: '', bugIds: [] }} open={openId === it.id} onToggle={() => setOpenId(openId === it.id ? null : it.id)} locked={locked} onSet={onSet} onBug={onBug} />
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function Item({ it, r, open, onToggle, locked, onSet, onBug }) {
  const [notes, setNotes] = useState(r.notes || '')
  const timer = useRef()
  useEffect(() => { setNotes(r.notes || '') }, [r.notes])
  const onNotes = (v) => { setNotes(v); clearTimeout(timer.current); timer.current = setTimeout(() => onSet(it.id, { notes: v }), 700) }
  return (
    <div className={`task s-${r.status.replace(/ /g, '')}${open ? ' open' : ''}`}>
      <div className="task-row">
        <button type="button" className="chev" aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} details for ${it.id}`} onClick={onToggle}>{open ? '▾' : '▸'}</button>
        <button type="button" className="task-title" onClick={onToggle}>
          <span className="code">{it.id}</span>
          <span className="title">{it.title}</span>
          <span className={`chip ${it.priority}`}>{it.priority}</span>
          {r.source === 'auto' && <span className="chip auto">auto</span>}
          {(r.bugIds || []).map((b) => <span key={b} className="chip">{b}</span>)}
        </button>
        <div className="status-btns inline" role="group" aria-label={`Status for ${it.id}`}>
          {STATUSES.filter((s) => s !== 'Not tested' || r.status !== 'Not tested').map((s) => (
            <button key={s} type="button" className={`small ${r.status === s ? `on ${s.replace(/ /g, '')}` : ''}`} disabled={locked || r.status === s} onClick={() => onSet(it.id, { status: s })}>
              {s === 'Not applicable' ? 'N/A' : s === 'Not tested' ? 'Clear' : s}
            </button>
          ))}
        </div>
      </div>
      {open && (
        <div className="task-detail">
          <div className="more"><b>What to test: </b>{it.steps || <span>Not written yet</span>}</div>
          <div className="more"><b>Expected result: </b>{it.expected || <span>Not written yet</span>}</div>
          {it.when && <div className="more"><b>When it appears: </b>{it.when}</div>}
          {it.ifEmpty && <div className="more"><b>If empty / loading: </b>{it.ifEmpty}</div>}
          <textarea rows={2} className="notes" placeholder="Notes: what you saw, browser, device" value={notes} disabled={locked} onChange={(e) => onNotes(e.target.value)} />
          <div className="row gap">
            {!locked && <button className="ghost small" onClick={() => onBug(it)}>Report bug</button>}
            {r.tester && r.source !== 'auto' && <span className="muted small">by {r.tester}</span>}
          </div>
        </div>
      )}
    </div>
  )
}

function Problems({ rid }) {
  const st = useAsync(() => get(`/api/runs/${rid}/report.txt`), [rid])
  if (!st.data) return <Loading state={st} />
  return <pre className="mail">{st.data}</pre>
}

function Finish({ run, locked, onDone }) {
  const toast = useToast()
  const st = useAsync(() => get(`/api/runs/${run.id}/mail`), [run.id])
  const [busy, setBusy] = useState(false)
  const m = st.data
  const finish = async (send) => {
    if (send && !window.confirm(`Close this round and email the final report to:\n${m.to.join('\n')}\n\nVerdict now: ${run.stats.verdict}`)) return
    if (!send && !window.confirm('Close this round without sending an email?')) return
    setBusy(true)
    try {
      const r = await post(`/api/runs/${run.id}/finish`, { send })
      toast(r.sent ? `Report sent to ${r.to.length} recipient(s)` : (r.error ? `Round closed, but the email was NOT sent: ${r.error}` : 'Round closed'), r.sent ? 'ok' : 'info')
      onDone()
    } catch (x) { toast(x.message, 'error') } finally { setBusy(false) }
  }
  return (
    <div className="card">
      <h3>Finish this round and email the report</h3>
      <p className="muted">Closes the round and emails one report. The report includes every pass, fail, blocked and not-applicable result with its note, plus each open bug and what happened.</p>
      {run.stats.counts['Not tested'] > 0 && <p className="warn">{run.stats.counts['Not tested']} task(s) are still "Not tested" and will be listed.</p>}
      <Loading state={st} />
      {m && <p className="muted">{m.ready ? <>Will be sent to <b>{m.to.join(', ')}</b> from {m.from}.</> : <>Email is not ready. Missing: <b>{m.missing.join(', ')}</b>. Recipients are set under Settings; SMTP settings are in the server's .env file.</>}</p>}
      {run.status === 'closed' ? <p><b>This round is closed.</b></p> : (
        <div className="row gap">
          <button className="primary" disabled={locked || busy || !m?.ready} onClick={() => finish(true)}>Finish round and email report</button>
          <button className="ghost" disabled={locked || busy} onClick={() => finish(false)}>Close round (no email)</button>
        </div>
      )}
      {run.status === 'closed' && m?.ready && !locked && <button className="ghost" onClick={() => finish(true)}>Send the report again</button>}
    </div>
  )
}

function BugModal({ pid, run, item, onClose, onSaved }) {
  const toast = useToast()
  const [f, setF] = useState({ title: `${item.title} - ${item.group}`.slice(0, 280), severity: 'major', stepsToReproduce: item.steps || '', expected: item.expected || '', actual: '', url: run.baseUrl || '' })
  const submit = async (e) => {
    e.preventDefault()
    try { await post(`/api/projects/${pid}/bugs`, { ...f, runId: run.id, itemId: item.id }); toast('Bug reported', 'ok'); onSaved() } catch (x) { toast(x.message, 'error') }
  }
  return (
    <Modal title={`Report a bug for ${item.id}`} onClose={onClose} wide>
      <form onSubmit={submit}>
        <Field label="Title *"><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required /></Field>
        <div className="two">
          <Field label="Severity"><select value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value })}><option>critical</option><option>major</option><option>minor</option><option>trivial</option></select></Field>
          <Field label="Page address"><input value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} /></Field>
        </div>
        <Field label="What I did"><textarea rows={3} value={f.stepsToReproduce} onChange={(e) => setF({ ...f, stepsToReproduce: e.target.value })} /></Field>
        <div className="two">
          <Field label="What I expected"><textarea rows={3} value={f.expected} onChange={(e) => setF({ ...f, expected: e.target.value })} /></Field>
          <Field label="What happened"><textarea rows={3} value={f.actual} onChange={(e) => setF({ ...f, actual: e.target.value })} autoFocus /></Field>
        </div>
        <div className="actions"><button type="button" className="ghost" onClick={onClose}>Cancel</button><button className="primary">Save bug</button></div>
      </form>
    </Modal>
  )
}

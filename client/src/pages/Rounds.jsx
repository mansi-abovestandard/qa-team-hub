import { useState } from 'react'
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { get, post } from '../api.js'
import { Field, Loading, Modal, Progress, Verdict, fmtDate, useAsync, useToast } from '../ui.jsx'

export default function Rounds() {
  const { pid } = useParams(); const { project, canTest } = useOutletContext()
  const st = useAsync(() => get(`/api/projects/${pid}/runs`), [pid])
  const [open, setOpen] = useState(false)
  return (
    <div>
      <div className="page-head">
        <p className="muted">Each Saturday, start a new round. That copies every task again, all set to Not tested. On a round, mark Pass, Fail, Blocked or N/A, add a note, and use Report bug when something is wrong. Open report and Download report on that round show the results at any time. Finish and email sends that same report to the addresses in Settings, and only if mail is configured on the server. Earlier rounds keep their results.</p>
        {canTest && <button className="primary" onClick={() => setOpen(true)}>Start new test round (all tasks again)</button>}
      </div>
      <Loading state={st} />
      {st.data && st.data.length === 0 && <div className="empty">No test round yet.</div>}
      <div className="stack">
        {(st.data || []).map((r) => (
          <Link key={r.id} to={`/projects/${pid}/rounds/${r.id}`} className="card round">
            <div className="row between">
              <h3>{r.name} <span className="muted">· {r.environment}</span></h3>
              <span className="row gap"><span className="pill">{r.status}</span><Verdict stats={r.stats} compact /></span>
            </div>
            <Progress stats={r.stats} />
            <div className="muted">{r.stats.counts.Pass} pass · {r.stats.counts.Fail} fail · {r.stats.counts.Blocked} blocked · {r.stats.counts['Not tested']} not tested · started {fmtDate(r.createdAt)}{r.createdBy ? ` by ${r.createdBy}` : ''}</div>
          </Link>
        ))}
      </div>
      {open && <NewRound project={project} onClose={() => setOpen(false)} />}
    </div>
  )
}

function NewRound({ project, onClose }) {
  const nav = useNavigate(); const toast = useToast()
  const [f, setF] = useState({ name: '', environment: 'staging', baseUrl: project.baseUrl || '', commit: '', autoChecks: !!project.baseUrl })
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault(); setBusy(true)
    try {
      const r = await post(`/api/projects/${project.id}/runs`, f)
      toast(`Round created with ${r.run.stats.total} tasks` + (r.auto ? `; ${r.auto.applied.length} automatic results saved` : ''), 'ok')
      nav(`/projects/${project.id}/rounds/${r.run.id}`)
    } catch (x) { toast(x.message, 'error'); setBusy(false) }
  }
  return (
    <Modal title="Start new test round" onClose={onClose}>
      <form onSubmit={submit}>
        <p className="muted">Creates every task again with status "Not tested".</p>
        <Field label="Name (release or version) *"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required autoFocus placeholder="v1.4.0" /></Field>
        <div className="two">
          <Field label="Environment"><select value={f.environment} onChange={(e) => setF({ ...f, environment: e.target.value })}><option>staging</option><option>production</option><option>local</option></select></Field>
          <Field label="Commit / build (optional)"><input value={f.commit} onChange={(e) => setF({ ...f, commit: e.target.value })} /></Field>
        </div>
        <Field label="Website address (for the automatic checks)"><input value={f.baseUrl} onChange={(e) => setF({ ...f, baseUrl: e.target.value })} placeholder="https://staging.example.dk" /></Field>
        <label className="check"><input type="checkbox" checked={f.autoChecks} disabled={!f.baseUrl} onChange={(e) => setF({ ...f, autoChecks: e.target.checked })} /> Run the automatic checks right away</label>
        <div className="actions"><button type="button" className="ghost" onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>{busy ? 'Creating…' : 'Create all tasks'}</button></div>
      </form>
    </Modal>
  )
}

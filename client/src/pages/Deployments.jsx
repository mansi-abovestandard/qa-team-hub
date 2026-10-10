import { useState } from 'react'
import { useOutletContext, useParams } from 'react-router-dom'
import { del, get, patch, post } from '../api.js'
import { Field, Loading, Modal, useAsync, useToast } from '../ui.jsx'

const TYPES = [['feature', 'Feature'], ['bugfix', 'Bugfix'], ['bug', 'Bug'], ['issue', 'Issue'], ['ui', 'UI design']]
const DEPLOY = [['pending', 'Pending'], ['deployed', 'Deployed']]
const TEST = [['pending', 'Pending'], ['in_progress', 'In progress'], ['complete', 'Complete']]
const RESULT = [['', '—'], ['pass', 'Pass'], ['fail', 'Fail']]
const label = (list, value) => list.find((x) => x[0] === value)?.[1] || value || '—'

const empty = { branchName: '', baseBranch: '', description: '', developer: '', branchType: 'feature', stagingDeploy: 'pending', stagingTest: 'pending', liveDeploy: 'pending', liveTest: 'pending', finalStatus: 'pending', stagingResult: '', liveResult: '' }

export default function Deployments() {
  const { pid } = useParams()
  const { canDeploy, canTest } = useOutletContext()
  const toast = useToast()
  const st = useAsync(() => get(`/api/projects/${pid}/deployments`), [pid])
  const [edit, setEdit] = useState(null)
  if (!st.data) return <Loading state={st} />
  return (
    <div>
      <div className="page-head">
        <p className="muted">Developer side of this project. Each row is one GitHub branch: who made it, which branch it was created from, and where it is on staging and production. Production can be marked Deployed only after staging is deployed, staging testing is complete, and the staging result is Pass.</p>
        {canDeploy && <button className="primary" onClick={() => setEdit({ ...empty })}>Add branch</button>}
      </div>
      {st.data.length === 0 && <div className="empty">No branches yet. An editor or admin adds one.</div>}
      {st.data.length > 0 && (
        <div className="table-wrap">
          <table className="deploy-table">
            <thead>
              <tr>
                <th>No</th><th>Branch</th><th>Created from</th><th>Change</th><th>Developer</th><th>Type</th>
                <th>Staging deploy</th><th>Staging testing</th><th>Live deploy</th><th>Live testing</th><th>Final</th><th>Staging</th><th>Live</th><th />
              </tr>
            </thead>
            <tbody>
              {st.data.map((d, i) => (
                <tr key={d.id}>
                  <td>{i + 1}</td>
                  <td className="mono">{d.branchName}</td>
                  <td className="mono">{d.baseBranch || '—'}</td>
                  <td>{d.description}</td>
                  <td>{d.developer}</td>
                  <td>{label(TYPES, d.branchType)}</td>
                  <td>{label(DEPLOY, d.stagingDeploy)}</td>
                  <td>{label(TEST, d.stagingTest)}</td>
                  <td>{label(DEPLOY, d.liveDeploy)}{d.liveDeploy !== 'deployed' && !d.readyForProd && <div className="muted small">Not ready</div>}</td>
                  <td>{label(TEST, d.liveTest)}</td>
                  <td>{label(TEST, d.finalStatus)}</td>
                  <td className={d.stagingResult === 'fail' ? 'sev critical' : d.stagingResult === 'pass' ? 'sev' : ''}>{label(RESULT, d.stagingResult)}</td>
                  <td className={d.liveResult === 'fail' ? 'sev critical' : ''}>{label(RESULT, d.liveResult)}</td>
                  <td>{(canDeploy || canTest) && <button className="ghost small" onClick={() => setEdit(d)}>{canDeploy ? 'Edit' : 'Test'}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {edit && <EditModal row={edit} canDeploy={canDeploy} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); st.reload() }} />}
    </div>
  )
}

function blockers(f) {
  const missing = []
  if (!f.branchName.trim()) missing.push('branch name')
  if (!f.developer.trim()) missing.push('which developer made it')
  if (!f.baseBranch.trim()) missing.push('which branch it was created from')
  if (f.stagingDeploy !== 'deployed') missing.push('staging deploy must be Deployed')
  if (f.stagingTest !== 'complete') missing.push('staging testing must be Complete')
  if (f.stagingResult !== 'pass') missing.push('staging result must be Pass')
  return missing
}

function EditModal({ row, canDeploy, onClose, onSaved }) {
  const toast = useToast()
  const [f, setF] = useState({ ...empty, ...row, branchName: row.branchName || '', baseBranch: row.baseBranch || '', description: row.description || '', developer: row.developer || '' })
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const missing = blockers(f)
  const pid = window.location.pathname.split('/')[2]
  const remove = async () => {
    if (!window.confirm(`Remove branch ${f.branchName}?`)) return
    try { await del(`/api/deployments/${row.id}`); toast('Removed', 'ok'); onSaved() } catch (x) { toast(x.message, 'error') }
  }
  const submit = async (e) => {
    e.preventDefault()
    try {
      if (row.id) await patch(`/api/deployments/${row.id}`, canDeploy ? f : { stagingTest: f.stagingTest, liveTest: f.liveTest, stagingResult: f.stagingResult, liveResult: f.liveResult })
      else await post(`/api/projects/${pid}/deployments`, f)
      toast('Saved', 'ok'); onSaved()
    } catch (x) { toast(x.message, 'error') }
  }
  return (
    <Modal title={row.id ? f.branchName : 'Add a branch'} onClose={onClose} wide>
      <form onSubmit={submit}>
        <div className="two">
          <Field label="GitHub branch name" hint="Exact branch name"><input value={f.branchName} onChange={set('branchName')} required disabled={!canDeploy} /></Field>
          <Field label="Created from" hint="The branch this was branched off, such as main"><input value={f.baseBranch} onChange={set('baseBranch')} disabled={!canDeploy} placeholder="main" /></Field>
        </div>
        <div className="two">
          <Field label="Developer"><input value={f.developer} onChange={set('developer')} disabled={!canDeploy} /></Field>
          <Field label="Type"><select value={f.branchType} onChange={set('branchType')} disabled={!canDeploy}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
        </div>
        <Field label="What changed"><input value={f.description} onChange={set('description')} disabled={!canDeploy} /></Field>
        <h4>Staging</h4>
        <div className="two">
          <Field label="Deploy"><select value={f.stagingDeploy} onChange={set('stagingDeploy')} disabled={!canDeploy}>{DEPLOY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
          <Field label="Testing"><select value={f.stagingTest} onChange={set('stagingTest')}>{TEST.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
        </div>
        <Field label="Staging result"><select value={f.stagingResult} onChange={set('stagingResult')}>{RESULT.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
        <h4>Production</h4>
        <div className="two">
          <Field label="Deploy"><select value={f.liveDeploy} onChange={set('liveDeploy')} disabled={!canDeploy}>{DEPLOY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
          <Field label="Testing"><select value={f.liveTest} onChange={set('liveTest')}>{TEST.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
        </div>
        <div className="two">
          <Field label="Live result"><select value={f.liveResult} onChange={set('liveResult')}>{RESULT.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
          <Field label="Final status"><select value={f.finalStatus} onChange={set('finalStatus')} disabled={!canDeploy}>{TEST.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
        </div>
        {f.liveDeploy === 'deployed' && missing.length > 0 && <div className="error-box">Not ready for production: {missing.join('; ')}.</div>}
        {f.liveDeploy === 'deployed' && missing.length === 0 && <p className="muted small">Ready for production. Branch {f.branchName || '—'} by {f.developer || '—'}, created from {f.baseBranch || '—'}, staging passed.</p>}
        <div className="actions">
          {canDeploy && row.id && <button type="button" className="ghost danger" onClick={remove}>Remove</button>}
          <span className="grow" />
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
          <button className="primary">Save</button>
        </div>
      </form>
    </Modal>
  )
}

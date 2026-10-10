import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { get, post } from '../api.js'
import { Field, Loading, useAsync, useToast } from '../ui.jsx'

export default function NewProject() {
  const nav = useNavigate(); const toast = useToast()
  const tpl = useAsync(() => get('/api/templates'), [])
  const [f, setF] = useState({ name: '', description: '', baseUrl: '', recipients: '', templateId: '' })
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const submit = async (e) => {
    e.preventDefault(); setBusy(true)
    try {
      const p = await post('/api/projects', { ...f, templateId: f.templateId ? Number(f.templateId) : null })
      toast('Project created', 'ok'); nav(`/projects/${p.id}`)
    } catch (x) { toast(x.message, 'error') } finally { setBusy(false) }
  }
  return (
    <form className="card narrow" onSubmit={submit}>
      <h1>New project</h1>
      <Field label="Project name *"><input value={f.name} onChange={set('name')} required autoFocus /></Field>
      <Field label="Description"><input value={f.description} onChange={set('description')} /></Field>
      <Field label="Website address" hint="Used by the automatic checks, e.g. https://staging.example.dk"><input value={f.baseUrl} onChange={set('baseUrl')} placeholder="https://" /></Field>
      <Field label="Who gets the final report by email" hint="Separate several addresses with commas"><input value={f.recipients} onChange={set('recipients')} placeholder="pm@abovestandard.dk, mg@abovestandard.dk" /></Field>
      <Field label="Start with" hint="You can add, change and remove tasks afterwards.">
        <select value={f.templateId} onChange={set('templateId')}>
          <option value="">Nothing (add tasks myself)</option>
          {(tpl.data || []).map((t) => <option key={t.id} value={t.id}>{t.name} - {t.items} tasks</option>)}
        </select>
      </Field>
      <Loading state={tpl} />
      <button className="primary" disabled={busy}>Create project</button>
    </form>
  )
}

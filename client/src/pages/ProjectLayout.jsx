import { NavLink, Outlet, useParams } from 'react-router-dom'
import { get } from '../api.js'
import { Loading, useAsync } from '../ui.jsx'

export default function ProjectLayout() {
  const { pid } = useParams()
  const st = useAsync(() => get(`/api/projects/${pid}`), [pid])
  if (!st.data) return <Loading state={st} />
  const p = st.data
  const canAdmin = p.role === 'admin'
  const canDeploy = p.role === 'admin' || p.role === 'editor'
  const roleName = { tester: 'QA', editor: 'editor', admin: 'admin', viewer: 'viewer' }[p.role] || p.role
  return (
    <div>
      <div className="page-head">
        <div><h1>{p.name}</h1>{p.description && <div className="muted">{p.description}</div>}</div>
        <span className="pill">{roleName}</span>
      </div>
      <nav className="tabs">
        <NavLink to={`/projects/${pid}`} end>QA · Test rounds</NavLink>
        <NavLink to={`/projects/${pid}/tasks`}>Checklist (tasks)</NavLink>
        <NavLink to={`/projects/${pid}/bugs`}>Bugs</NavLink>
        <NavLink to={`/projects/${pid}/deployments`}>Developer · Branches</NavLink>
        {canAdmin && <NavLink to={`/projects/${pid}/settings`}>Settings and team</NavLink>}
      </nav>
      <Outlet context={{ project: p, canAdmin, canDeploy, canTest: p.role !== 'viewer', reloadProject: st.reload }} />
    </div>
  )
}

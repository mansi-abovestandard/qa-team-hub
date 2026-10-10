import { Link } from 'react-router-dom'
import { get } from '../api.js'
import { useAuth } from '../auth.js'
import { Loading, Progress, Verdict, fmtDate, useAsync } from '../ui.jsx'

export default function Projects() {
  const { user } = useAuth()
  const st = useAsync(() => get('/api/projects'), [])
  return (
    <div>
      <div className="page-head">
        <h1>Projects</h1>
        {user.isAdmin && <Link to="/new-project" className="btn primary">New project</Link>}
      </div>
      <Loading state={st} />
      {st.data && st.data.length === 0 && (
        <div className="empty">{user.isAdmin ? 'No projects yet. Create the first project.' : 'You are not a member of any project yet. Ask an admin to add you.'}</div>
      )}
      <div className="grid">
        {(st.data || []).map((p) => (
          <Link key={p.id} to={`/projects/${p.id}`} className="card project">
            <div className="row between"><h2>{p.name}</h2>{p.latestRun && <Verdict stats={p.latestRun.stats} compact />}</div>
            {p.description && <p className="muted">{p.description}</p>}
            {p.latestRun ? (
              <>
                <div className="muted">Latest round: <b>{p.latestRun.name}</b> ({p.latestRun.environment}) · {p.latestRun.status} · {fmtDate(p.latestRun.createdAt)}</div>
                <Progress stats={p.latestRun.stats} />
                <div className="muted">{p.latestRun.stats.counts.Fail} failed · {p.latestRun.stats.problems} page(s)/module(s) with problems</div>
              </>
            ) : <div className="muted">No test round yet</div>}
            <div className="row gap muted"><span>{p.taskCount} tasks</span><span>{p.openBugs} open bugs</span><span>your role: {p.role}</span></div>
          </Link>
        ))}
      </div>
    </div>
  )
}

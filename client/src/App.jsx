import { useEffect, useState } from 'react'
import { Link, NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { useAuth } from './auth.js'
import { get, post } from './api.js'
import { AuthCtx } from './auth.js'
import Login from './pages/Login.jsx'
import Projects from './pages/Projects.jsx'
import NewProject from './pages/NewProject.jsx'
import ProjectLayout from './pages/ProjectLayout.jsx'
import Rounds from './pages/Rounds.jsx'
import Round from './pages/Round.jsx'
import Tasks from './pages/Tasks.jsx'
import Bugs from './pages/Bugs.jsx'
import Deployments from './pages/Deployments.jsx'
import Settings from './pages/Settings.jsx'
import Users from './pages/Users.jsx'
import Profile from './pages/Profile.jsx'
import { ThemeToggle } from './theme.jsx'

export default function App() {
  const [auth, setAuth] = useState({ loading: true, user: null, needsSetup: false })
  const refresh = () => get('/api/auth/state').then((s) => setAuth({ loading: false, user: s.user, needsSetup: s.needsSetup })).catch(() => setAuth({ loading: false, user: null, needsSetup: false }))
  useEffect(() => { refresh() }, [])
  useEffect(() => { const f = () => setAuth((a) => ({ ...a, user: null })); window.addEventListener('qa-unauthorized', f); return () => window.removeEventListener('qa-unauthorized', f) }, [])
  if (auth.loading) return <div className="empty">Loading…</div>
  if (!auth.user) return <Login needsSetup={auth.needsSetup} onDone={refresh} />
  return (
    <AuthCtx.Provider value={{ user: auth.user, refresh }}>
      <Shell />
    </AuthCtx.Provider>
  )
}

function Shell() {
  const { user, refresh } = useAuth()
  const nav = useNavigate()
  const logout = async () => { await post('/api/auth/logout'); await refresh(); nav('/') }
  return (
    <>
      <header className="top">
        <Link to="/" className="brand">QA Team Hub</Link>
        <nav>
          <NavLink to="/" end>Projects</NavLink>
          {user.isAdmin && <NavLink to="/admin/users">Team</NavLink>}
          <NavLink to="/profile">Profile</NavLink>
        </nav>
        <span className="grow" />
        <span className="who">{user.name}{user.isAdmin ? ' (admin)' : ''}</span>
        <ThemeToggle />
        <button className="ghost light icon-btn" onClick={logout} aria-label="Sign out" title="Sign out">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path d="M10 6V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2v-1" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="M4 12h11M11 8l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Projects />} />
          <Route path="/new-project" element={user.isAdmin ? <NewProject /> : <Navigate to="/" />} />
          <Route path="/admin/users" element={user.isAdmin ? <Users /> : <Navigate to="/" />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/projects/:pid" element={<ProjectLayout />}>
            <Route index element={<Rounds />} />
            <Route path="rounds/:rid" element={<Round />} />
            <Route path="tasks" element={<Tasks />} />
            <Route path="bugs" element={<Bugs />} />
            <Route path="deployments" element={<Deployments />} />
            <Route path="settings" element={<Settings />} />
          </Route>
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </>
  )
}

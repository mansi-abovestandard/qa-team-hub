import express from 'express'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { tx } from './db.js'
import { HttpError, bad, notFound, forbidden, str, oneOf, wrap } from './http.js'
import { hashPassword, verifyPassword, checkPasswordStrength, createSession, setCookie, clearCookie, destroySession,
  sessionMiddleware, requireUser, requireAdmin, csrfGuard, throttle, clearThrottle, projectRole, requireProjectRole } from './auth.js'
import { seedTemplates, copyTemplateToProject, saveProjectAsTemplate, insertTasks, packItems, rowToItem } from './services/templates.js'
import { runView, projectBugsView, previousRunView, autoStore, runLabel } from './services/runView.js'
import { computeStats, reportHtml, reportText } from './services/report.js'
import { runHttpChecks, runBrowserChecks, applyResults } from './services/autochecks.js'
import { mailSettings, buildMessage, sendMessage, EMAIL_RE, parseRecipients } from './services/mailer.js'
import { csvToObjects } from './services/csv.js'

const STATUSES = ['Not tested', 'Pass', 'Fail', 'Blocked', 'Not applicable']
const SEVERITIES = ['critical', 'major', 'minor', 'trivial']
const BUG_STATUSES = ['open', 'in_progress', 'fixed', 'verified', 'wontfix']
const ROLES = ['admin', 'editor', 'tester', 'viewer']
const BRANCH_TYPES = ['feature', 'bugfix', 'bug', 'issue', 'ui']
const DEPLOY_STATES = ['pending', 'deployed']
const TEST_STATES = ['pending', 'in_progress', 'complete']
const FINAL_STATES = ['pending', 'in_progress', 'complete']
const RESULT_STATES = ['', 'pass', 'fail']

function prodBlockers(row) {
  const missing = []
  if (!String(row.branch_name || '').trim()) missing.push('branch name')
  if (!String(row.developer || '').trim()) missing.push('which developer made it')
  if (!String(row.base_branch || '').trim()) missing.push('which branch it was created from')
  if (row.staging_deploy !== 'deployed') missing.push('staging deploy must be Deployed')
  if (row.staging_test !== 'complete') missing.push('staging testing must be Complete')
  if (row.staging_result !== 'pass') missing.push('staging result must be Pass')
  return missing
}
function assertProdReady(row) {
  if (row.live_deploy !== 'deployed') return
  const missing = prodBlockers(row)
  if (missing.length) throw bad(`Not ready for production: ${missing.join('; ')}.`)
}
function creatorName(user) {
  return str(user?.name, 120) || str(user?.email, 120)
}
function deployFields(b) {
  const branch_name = str(b.branchName, 200)
  if (!branch_name) throw bad('Branch name is required')
  return {
    branch_name, base_branch: str(b.baseBranch, 200), description: str(b.description, 500),
    branch_type: oneOf(b.branchType || 'feature', BRANCH_TYPES, 'branch type'),
    staging_deploy: oneOf(b.stagingDeploy || 'pending', DEPLOY_STATES, 'staging deploy'),
    staging_test: oneOf(b.stagingTest || 'pending', TEST_STATES, 'staging testing'),
    live_deploy: oneOf(b.liveDeploy || 'pending', DEPLOY_STATES, 'live deploy'),
    live_test: oneOf(b.liveTest || 'pending', TEST_STATES, 'live testing'),
    final_status: oneOf(b.finalStatus || 'pending', FINAL_STATES, 'final status'),
    staging_result: oneOf(b.stagingResult || '', RESULT_STATES, 'staging result'),
    live_result: oneOf(b.liveResult || '', RESULT_STATES, 'live result'),
  }
}
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const userOut = (u) => ({ id: u.id, email: u.email, name: u.name, isAdmin: !!u.is_admin, active: !!u.active })
const bugCodeNext = (db, pid) => `BUG-${String((db.prepare('SELECT COUNT(*) c FROM bugs WHERE project_id = ?').get(pid).c) + 1).padStart(3, '0')}`

export function createApp(db) {
  seedTemplates(db)
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: '2mb' }))
  app.use((req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'SAMEORIGIN'); res.setHeader('Referrer-Policy', 'same-origin'); next() })
  app.use(sessionMiddleware(db))
  app.use('/api', csrfGuard)

  // ------------------------------------------------------------ auth
  app.get('/api/auth/state', (req, res) => {
    const users = db.prepare('SELECT COUNT(*) c FROM users').get().c
    res.json({ needsSetup: users === 0, user: req.user })
  })
  app.post('/api/auth/setup', wrap(async (req, res) => {
    if (db.prepare('SELECT COUNT(*) c FROM users').get().c > 0) throw forbidden('Setup is already done')
    const { email, name, password } = req.body || {}
    if (!EMAIL_RE.test(str(email))) throw bad('Enter a valid email')
    if (!str(name)) throw bad('Enter a name')
    checkPasswordStrength(password)
    const id = db.prepare('INSERT INTO users (email, name, password_hash, is_admin) VALUES (?,?,?,1)').run(str(email), str(name, 100), await hashPassword(password)).lastInsertRowid
    const s = createSession(db, Number(id)); setCookie(res, s.token, s.expires)
    res.status(201).json({ user: { id: Number(id), email: str(email), name: str(name, 100), isAdmin: true } })
  }))
  app.post('/api/auth/login', wrap(async (req, res) => {
    const email = str(req.body?.email).toLowerCase(), password = String(req.body?.password || '')
    const key = `${req.ip}|${email}`
    throttle(key)
    const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email)
    const ok = u && u.active && (await verifyPassword(password, u.password_hash))
    if (!ok) throw new HttpError(401, 'Wrong email or password')
    clearThrottle(key)
    const s = createSession(db, u.id); setCookie(res, s.token, s.expires)
    res.json({ user: { id: u.id, email: u.email, name: u.name, isAdmin: !!u.is_admin } })
  }))
  app.post('/api/auth/logout', (req, res) => { destroySession(db, req); clearCookie(res); res.json({ ok: true }) })
  app.post('/api/auth/password', requireUser, wrap(async (req, res) => {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)
    if (!(await verifyPassword(String(req.body?.current || ''), u.password_hash))) throw bad('Current password is wrong')
    checkPasswordStrength(req.body?.next)
    if (req.body.next === req.body?.current) throw bad('Choose a different password')
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(req.body.next), u.id)
    res.json({ ok: true })
  }))
  app.patch('/api/auth/profile', requireUser, wrap(async (req, res) => {
    const name = str(req.body?.name, 100)
    if (!name) throw bad('Enter a name')
    db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, req.user.id)
    res.json({ user: { ...req.user, name } })
  }))

  // everything below needs a signed-in user
  app.use('/api', (req, res, next) => (req.path.startsWith('/auth/') ? next() : requireUser(req, res, next)))

  // ------------------------------------------------------------ users (admin)
  app.get('/api/users', (req, res) => {
    // everyone signed in can see names (needed to assign bugs / add members); only admins see inactive ones
    const rows = db.prepare('SELECT * FROM users ORDER BY name').all().filter((u) => u.active || req.user.isAdmin)
    res.json(rows.map(userOut))
  })
  app.post('/api/users', requireAdmin, wrap(async (req, res) => {
    const { email, name, password, isAdmin } = req.body || {}
    if (!EMAIL_RE.test(str(email))) throw bad('Enter a valid email')
    if (!str(name)) throw bad('Enter a name')
    checkPasswordStrength(password)
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(str(email))) throw new HttpError(409, 'A user with this email already exists')
    const id = db.prepare('INSERT INTO users (email, name, password_hash, is_admin) VALUES (?,?,?,?)').run(str(email), str(name, 100), await hashPassword(password), isAdmin ? 1 : 0).lastInsertRowid
    res.status(201).json(userOut(db.prepare('SELECT * FROM users WHERE id = ?').get(id)))
  }))
  app.patch('/api/users/:id', requireAdmin, wrap(async (req, res) => {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id)
    if (!u) throw notFound('User not found')
    const b = req.body || {}
    const admins = db.prepare('SELECT COUNT(*) c FROM users WHERE is_admin = 1 AND active = 1').get().c
    const losesAdmin = (b.isAdmin === false && u.is_admin) || (b.active === false && u.is_admin)
    if (losesAdmin && admins <= 1) throw bad('There must be at least one active admin')
    if (b.name !== undefined) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(str(b.name, 100) || u.name, u.id)
    if (b.isAdmin !== undefined) db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(b.isAdmin ? 1 : 0, u.id)
    if (b.active !== undefined) { db.prepare('UPDATE users SET active = ? WHERE id = ?').run(b.active ? 1 : 0, u.id); if (!b.active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id) }
    if (b.password) { checkPasswordStrength(b.password); db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(b.password), u.id); db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id) }
    res.json(userOut(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id)))
  }))

  // ------------------------------------------------------------ templates
  app.get('/api/templates', (_req, res) => {
    res.json(db.prepare(`SELECT t.id, t.name, t.description, t.builtin, (SELECT COUNT(*) FROM template_items i WHERE i.template_id = t.id) AS items FROM templates t ORDER BY t.builtin DESC, t.name`).all()
      .map((t) => ({ ...t, builtin: !!t.builtin })))
  })
  app.delete('/api/templates/:id', requireAdmin, (req, res) => {
    const t = db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id)
    if (!t) throw notFound('Template not found')
    if (t.builtin) throw bad('Built-in templates cannot be deleted')
    db.prepare('DELETE FROM templates WHERE id = ?').run(t.id); res.json({ ok: true })
  })

  // ------------------------------------------------------------ projects
  const visibleProjects = (user) => user.isAdmin
    ? db.prepare('SELECT p.*, \'admin\' AS role FROM projects p WHERE p.archived = 0 ORDER BY p.name').all()
    : db.prepare('SELECT p.*, m.role AS role FROM projects p JOIN project_members m ON m.project_id = p.id WHERE m.user_id = ? AND p.archived = 0 ORDER BY p.name').all(user.id)
  const projectOut = (p) => ({ id: p.id, name: p.name, description: p.description, baseUrl: p.base_url, recipients: parseRecipients(p.report_recipients), role: p.role, createdAt: p.created_at })
  const loadProject = (req, min = 'viewer') => {
    const p = db.prepare('SELECT * FROM projects WHERE id = ? AND archived = 0').get(Number(req.params.pid))
    if (!p) throw notFound('Project not found')
    const role = requireProjectRole(db, req.user, p.id, min)
    return { ...p, role }
  }
  const latestRunSummary = (pid) => {
    const r = db.prepare('SELECT id FROM runs WHERE project_id = ? ORDER BY id DESC LIMIT 1').get(pid)
    if (!r) return null
    return runSummary(r.id)
  }
  const runSummary = (id) => {
    const run = runView(db, id)
    const s = computeStats(run, projectBugsView(db, run.projectId), previousRunView(db, run))
    return { id: run.dbId, label: run.id, projectId: run.projectId, name: run.name, environment: run.environment, baseUrl: run.baseUrl, commit: run.commit, status: run.status,
      createdAt: run.createdAt, closedAt: run.closedAt, createdBy: run.createdBy,
      stats: { total: s.total, applicable: s.applicable, tested: s.tested, counts: s.counts, passRate: s.passRate, progress: s.progress, byArea: s.byArea, verdict: s.verdict,
        verdictText: s.verdictText, reasons: s.reasons, regressions: s.regressions.length, openBugs: s.openBugs.length, problems: s.issuesByGroup.filter((g) => g.Fail.length || g.Blocked.length).length } }
  }

  app.get('/api/projects', (req, res) => {
    res.json(visibleProjects(req.user).map((p) => ({
      ...projectOut(p),
      taskCount: db.prepare('SELECT COUNT(*) c FROM tasks WHERE project_id = ? AND active = 1').get(p.id).c,
      openBugs: db.prepare(`SELECT COUNT(*) c FROM bugs WHERE project_id = ? AND status IN ('open','in_progress','fixed')`).get(p.id).c,
      latestRun: latestRunSummary(p.id),
    })))
  })
  app.post('/api/projects', requireAdmin, wrap(async (req, res) => {
    const b = req.body || {}
    const name = str(b.name, 120); if (!name) throw bad('Project needs a name')
    if (db.prepare('SELECT 1 FROM projects WHERE name = ? AND archived = 0').get(name)) throw new HttpError(409, 'A project with this name already exists')
    const recipients = parseRecipients(b.recipients)
    if (recipients.some((e) => !EMAIL_RE.test(e))) throw bad('One of the report recipients is not a valid email')
    const id = tx(db, () => {
      const pid = Number(db.prepare('INSERT INTO projects (name, description, base_url, report_recipients, created_by) VALUES (?,?,?,?,?)')
        .run(name, str(b.description, 500), str(b.baseUrl, 300), recipients.join(','), req.user.id).lastInsertRowid)
      db.prepare('INSERT INTO project_members (project_id, user_id, role) VALUES (?,?,?)').run(pid, req.user.id, 'admin')
      if (b.templateId) {
        if (!db.prepare('SELECT 1 FROM templates WHERE id = ?').get(Number(b.templateId))) throw bad('Template not found')
        copyTemplateToProject(db, Number(b.templateId), pid)
      }
      return pid
    })
    res.status(201).json(projectOut({ ...db.prepare('SELECT * FROM projects WHERE id = ?').get(id), role: 'admin' }))
  }))
  app.get('/api/projects/:pid', (req, res) => {
    const p = loadProject(req)
    const members = db.prepare('SELECT u.id, u.name, u.email, m.role FROM project_members m JOIN users u ON u.id = m.user_id WHERE m.project_id = ? ORDER BY u.name').all(p.id)
    res.json({ ...projectOut(p), members })
  })
  app.patch('/api/projects/:pid', wrap(async (req, res) => {
    const p = loadProject(req, 'admin'); const b = req.body || {}
    if (b.name !== undefined && !str(b.name)) throw bad('Project needs a name')
    let recipients = p.report_recipients
    if (b.recipients !== undefined) {
      const list = parseRecipients(b.recipients)
      if (list.some((e) => !EMAIL_RE.test(e))) throw bad('One of the report recipients is not a valid email')
      recipients = list.join(',')
    }
    db.prepare('UPDATE projects SET name = ?, description = ?, base_url = ?, report_recipients = ? WHERE id = ?')
      .run(b.name !== undefined ? str(b.name, 120) : p.name, b.description !== undefined ? str(b.description, 500) : p.description, b.baseUrl !== undefined ? str(b.baseUrl, 300) : p.base_url, recipients, p.id)
    res.json(projectOut({ ...db.prepare('SELECT * FROM projects WHERE id = ?').get(p.id), role: p.role }))
  }))
  app.delete('/api/projects/:pid', requireAdmin, (req, res) => {
    const p = loadProject(req, 'admin')
    db.prepare('UPDATE projects SET archived = 1 WHERE id = ?').run(p.id); res.json({ ok: true })
  })
  app.put('/api/projects/:pid/members', (req, res) => {
    const p = loadProject(req, 'admin')
    const list = Array.isArray(req.body?.members) ? req.body.members : null
    if (!list) throw bad('members must be a list')
    for (const m of list) {
      oneOf(m.role, ROLES, 'role')
      if (!db.prepare('SELECT 1 FROM users WHERE id = ? AND active = 1').get(Number(m.userId))) throw bad(`Unknown user: ${m.userId}`)
    }
    if (!list.some((m) => m.role === 'admin') && !req.user.isAdmin) throw bad('Keep at least one project admin')
    tx(db, () => {
      db.prepare('DELETE FROM project_members WHERE project_id = ?').run(p.id)
      const st = db.prepare('INSERT OR REPLACE INTO project_members (project_id, user_id, role) VALUES (?,?,?)')
      for (const m of list) st.run(p.id, Number(m.userId), m.role)
    })
    res.json({ ok: true })
  })
  app.post('/api/projects/:pid/save-as-template', requireAdmin, (req, res) => {
    const p = loadProject(req, 'admin')
    const name = str(req.body?.name, 120); if (!name) throw bad('Template needs a name')
    if (db.prepare('SELECT 1 FROM templates WHERE name = ?').get(name)) throw new HttpError(409, 'A template with this name already exists')
    res.status(201).json(saveProjectAsTemplate(db, p.id, name, str(req.body?.description, 300)))
  })

  // ------------------------------------------------------------ deployments (GitHub branch + staging / production)
  const deployOut = (row) => {
    const blockers = prodBlockers(row)
    return {
      id: row.id, branchName: row.branch_name, baseBranch: row.base_branch, description: row.description, developer: row.created_by_name || row.developer, branchType: row.branch_type,
      stagingDeploy: row.staging_deploy, stagingTest: row.staging_test, liveDeploy: row.live_deploy, liveTest: row.live_test, finalStatus: row.final_status,
      stagingResult: row.staging_result, liveResult: row.live_result, createdBy: row.created_by_name || '', createdAt: row.created_at, updatedAt: row.updated_at,
      readyForProd: blockers.length === 0, prodBlockers: blockers,
    }
  }
  const loadDeployment = (req) => {
    const row = db.prepare(`SELECT d.*, u.name AS created_by_name FROM deployments d LEFT JOIN users u ON u.id = d.created_by WHERE d.id = ?`).get(Number(req.params.id))
    if (!row) throw notFound('Deployment not found')
    requireProjectRole(db, req.user, row.project_id, 'viewer')
    return row
  }
  app.get('/api/projects/:pid/deployments', (req, res) => {
    const p = loadProject(req)
    res.json(db.prepare(`SELECT d.*, u.name AS created_by_name FROM deployments d LEFT JOIN users u ON u.id = d.created_by WHERE d.project_id = ? ORDER BY d.id`).all(p.id).map(deployOut))
  })
  app.post('/api/projects/:pid/deployments', wrap(async (req, res) => {
    const p = loadProject(req, 'editor')
    const fields = deployFields(req.body || {})
    const developer = creatorName(req.user)
    assertProdReady({ ...fields, developer })
    const id = db.prepare(`INSERT INTO deployments (project_id, branch_name, base_branch, description, developer, branch_type, staging_deploy, staging_test, live_deploy, live_test, final_status, staging_result, live_result, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(p.id, fields.branch_name, fields.base_branch, fields.description, developer, fields.branch_type, fields.staging_deploy, fields.staging_test, fields.live_deploy, fields.live_test, fields.final_status, fields.staging_result, fields.live_result, req.user.id).lastInsertRowid
    res.status(201).json(deployOut(db.prepare(`SELECT d.*, u.name AS created_by_name FROM deployments d LEFT JOIN users u ON u.id = d.created_by WHERE d.id = ?`).get(id)))
  }))
  app.patch('/api/deployments/:id', wrap(async (req, res) => {
    const cur = loadDeployment(req)
    const role = projectRole(db, req.user, cur.project_id)
    const b = req.body || {}
    const editor = role === 'admin' || role === 'editor'
    if (role === 'viewer') throw forbidden('A viewer can only read deployments')
    if (!editor) {
      const extra = Object.keys(b).filter((k) => !['stagingTest', 'liveTest', 'stagingResult', 'liveResult'].includes(k))
      if (extra.length) throw forbidden('QA can update testing status and pass or fail. An editor adds the branch and records deploys.')
    }
    const next = { ...cur }
    const set = (col, key, allowed, label) => { if (b[key] !== undefined) next[col] = oneOf(b[key], allowed, label) }
    if (editor) {
      if (b.branchName !== undefined) next.branch_name = str(b.branchName, 200)
      if (b.baseBranch !== undefined) next.base_branch = str(b.baseBranch, 200)
      if (b.description !== undefined) next.description = str(b.description, 500)
      if (b.branchType !== undefined) next.branch_type = oneOf(b.branchType, BRANCH_TYPES, 'branch type')
      set('staging_deploy', 'stagingDeploy', DEPLOY_STATES, 'staging deploy')
      set('live_deploy', 'liveDeploy', DEPLOY_STATES, 'live deploy')
      set('final_status', 'finalStatus', FINAL_STATES, 'final status')
    }
    set('staging_test', 'stagingTest', TEST_STATES, 'staging testing')
    set('live_test', 'liveTest', TEST_STATES, 'live testing')
    set('staging_result', 'stagingResult', RESULT_STATES, 'staging result')
    set('live_result', 'liveResult', RESULT_STATES, 'live result')
    if (!next.branch_name) throw bad('Branch name is required')
    if (next.live_deploy === 'deployed' && cur.live_deploy !== 'deployed') assertProdReady(next)
    if (next.live_deploy === 'deployed') assertProdReady(next)
    db.prepare(`UPDATE deployments SET branch_name=?, base_branch=?, description=?, developer=?, branch_type=?, staging_deploy=?, staging_test=?, live_deploy=?, live_test=?, final_status=?, staging_result=?, live_result=?, updated_at=datetime('now') WHERE id=?`)
      .run(next.branch_name, next.base_branch, next.description, next.developer, next.branch_type, next.staging_deploy, next.staging_test, next.live_deploy, next.live_test, next.final_status, next.staging_result, next.live_result, cur.id)
    res.json(deployOut({ ...next, created_by_name: cur.created_by_name }))
  }))
  app.delete('/api/deployments/:id', (req, res) => {
    const row = loadDeployment(req)
    requireProjectRole(db, req.user, row.project_id, 'editor')
    db.prepare('DELETE FROM deployments WHERE id = ?').run(row.id)
    res.json({ ok: true })
  })

  // ------------------------------------------------------------ tasks (the project's checklist)
  const taskOut = (t) => ({ id: t.id, code: t.code, area: t.area, group: t.group_name, title: t.title, steps: t.steps, expected: t.expected, priority: t.priority, auto: !!t.auto, active: !!t.active, extra: JSON.parse(t.extra || '{}') })
  app.get('/api/projects/:pid/tasks', (req, res) => {
    const p = loadProject(req)
    res.json(db.prepare('SELECT * FROM tasks WHERE project_id = ? AND active = 1 ORDER BY sort, id').all(p.id).map(taskOut))
  })
  const taskFields = (b, cur = {}) => {
    const title = b.title !== undefined ? str(b.title, 300) : cur.title
    if (!title) throw bad('Task needs a title')
    return { title, area: b.area !== undefined ? (str(b.area, 80) || 'General') : (cur.area || 'General'), group: b.group !== undefined ? (str(b.group, 200) || 'General') : (cur.group_name || 'General'),
      steps: b.steps !== undefined ? str(b.steps, 4000) : (cur.steps || ''), expected: b.expected !== undefined ? str(b.expected, 4000) : (cur.expected || ''),
      priority: b.priority !== undefined ? oneOf(b.priority, ['high', 'medium', 'low'], 'priority') : (cur.priority || 'medium') }
  }
  app.post('/api/projects/:pid/tasks', (req, res) => {
    const p = loadProject(req, 'admin'); const f = taskFields(req.body || {})
    let code = str(req.body?.code, 30)
    if (!code) { let n = db.prepare('SELECT COUNT(*) c FROM tasks WHERE project_id = ?').get(p.id).c + 1; code = `T-${String(n).padStart(3, '0')}`
      while (db.prepare('SELECT 1 FROM tasks WHERE project_id = ? AND code = ?').get(p.id, code)) { n++; code = `T-${String(n).padStart(3, '0')}` } }
    if (db.prepare('SELECT 1 FROM tasks WHERE project_id = ? AND code = ?').get(p.id, code)) throw new HttpError(409, `Task code already exists: ${code}`)
    const sort = (db.prepare('SELECT MAX(sort) m FROM tasks WHERE project_id = ?').get(p.id).m ?? 0) + 1
    const id = db.prepare('INSERT INTO tasks (project_id, code, area, group_name, title, steps, expected, priority, sort) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(p.id, code, f.area, f.group, f.title, f.steps, f.expected, f.priority, sort).lastInsertRowid
    res.status(201).json(taskOut(db.prepare('SELECT * FROM tasks WHERE id = ?').get(id)))
  })
  const loadTask = (req, min) => {
    const t = db.prepare('SELECT * FROM tasks WHERE id = ? AND active = 1').get(Number(req.params.id))
    if (!t) throw notFound('Task not found')
    requireProjectRole(db, req.user, t.project_id, min)
    return t
  }
  app.patch('/api/tasks/:id', (req, res) => {
    const t = loadTask(req, 'admin'); const f = taskFields(req.body || {}, t)
    db.prepare('UPDATE tasks SET area = ?, group_name = ?, title = ?, steps = ?, expected = ?, priority = ? WHERE id = ?').run(f.area, f.group, f.title, f.steps, f.expected, f.priority, t.id)
    res.json(taskOut(db.prepare('SELECT * FROM tasks WHERE id = ?').get(t.id)))
  })
  app.delete('/api/tasks/:id', (req, res) => {
    const t = loadTask(req, 'admin')
    db.prepare('UPDATE tasks SET active = 0 WHERE id = ?').run(t.id) // soft delete: old rounds keep their copy
    res.json({ ok: true })
  })
  app.post('/api/projects/:pid/tasks/import', (req, res) => {
    const p = loadProject(req, 'admin'); const b = req.body || {}
    let rows = []
    if (typeof b.csv === 'string') {
      rows = csvToObjects(b.csv).map((r) => {
        const get = (...k) => { for (const n of k) { const key = Object.keys(r).find((x) => x.toLowerCase().startsWith(n)); if (key && r[key]) return r[key] } return '' }
        return { code: get('code', 'id'), area: get('area'), group: get('group', 'page', 'module'), title: get('title', 'check', 'task'), steps: get('steps', 'how'), expected: get('expected', 'you pass', 'pass'), priority: get('priority').toLowerCase() }
      })
    } else if (Array.isArray(b.items)) rows = b.items
    else throw bad('Send csv text or an items list')
    rows = rows.filter((r) => str(r.title))
    if (!rows.length) throw bad('No tasks found. A CSV needs at least a title column.')
    if (rows.length > 5000) throw bad('Too many tasks in one import (max 5000)')
    const existing = new Set(db.prepare('SELECT code FROM tasks WHERE project_id = ?').all(p.id).map((r) => r.code))
    let n = existing.size; let added = 0, skipped = 0
    let sort = (db.prepare('SELECT MAX(sort) m FROM tasks WHERE project_id = ?').get(p.id).m ?? 0)
    tx(db, () => {
      for (const r of rows) {
        let code = str(r.code, 30)
        if (code && existing.has(code)) { skipped++; continue }
        if (!code) { do { n++; code = `T-${String(n).padStart(3, '0')}` } while (existing.has(code)) }
        existing.add(code)
        const pr = ['high', 'medium', 'low'].includes(String(r.priority).toLowerCase()) ? String(r.priority).toLowerCase() : 'medium'
        db.prepare('INSERT INTO tasks (project_id, code, area, group_name, title, steps, expected, priority, sort) VALUES (?,?,?,?,?,?,?,?,?)')
          .run(p.id, code, str(r.area, 80) || 'General', str(r.group, 200) || 'General', str(r.title, 300), str(r.steps, 4000), str(r.expected, 4000), pr, ++sort)
        added++
      }
    })
    res.json({ added, skipped })
  })
  app.get('/api/projects/:pid/tasks.csv', (req, res) => {
    const p = loadProject(req)
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const head = ['code', 'area', 'group', 'title', 'steps', 'expected', 'priority']
    const rows = db.prepare('SELECT * FROM tasks WHERE project_id = ? AND active = 1 ORDER BY sort, id').all(p.id)
    res.type('text/csv').send([head.join(','), ...rows.map((t) => [t.code, t.area, t.group_name, t.title, t.steps, t.expected, t.priority].map(q).join(','))].join('\n'))
  })

  // ------------------------------------------------------------ test rounds (runs)
  app.get('/api/projects/:pid/runs', (req, res) => {
    const p = loadProject(req)
    res.json(db.prepare('SELECT id FROM runs WHERE project_id = ? ORDER BY id DESC').all(p.id).map((r) => runSummary(r.id)))
  })
  // "Start new test round": creates ALL tasks again, all set to Not tested
  app.post('/api/projects/:pid/runs', wrap(async (req, res) => {
    const p = loadProject(req, 'tester'); const b = req.body || {}
    const name = str(b.name, 120); if (!name) throw bad('Give the round a name, for example the release version')
    const taskCount = db.prepare('SELECT COUNT(*) c FROM tasks WHERE project_id = ? AND active = 1').get(p.id).c
    if (!taskCount) throw bad('This project has no tasks yet. Add tasks or start from a template first.')
    const baseUrl = str(b.baseUrl, 300) || p.base_url
    const id = tx(db, () => {
      const rid = Number(db.prepare('INSERT INTO runs (project_id, name, environment, base_url, commit_sha, created_by) VALUES (?,?,?,?,?,?)')
        .run(p.id, name, str(b.environment, 40) || 'staging', baseUrl, str(b.commit, 80), req.user.id).lastInsertRowid)
      db.prepare(`INSERT INTO run_items (run_id, task_id, code, area, group_name, title, steps, expected, priority, auto, extra, sort)
        SELECT ?, id, code, area, group_name, title, steps, expected, priority, auto, extra, sort FROM tasks WHERE project_id = ? AND active = 1`).run(rid, p.id)
      return rid
    })
    let auto = null
    if (b.autoChecks && baseUrl) auto = await doAutoChecks(id, p.id, baseUrl, false, 'auto-checks')
    res.status(201).json({ run: runSummary(id), auto })
  }))
  const loadRun = (req, min = 'viewer') => {
    const r = db.prepare('SELECT * FROM runs WHERE id = ?').get(Number(req.params.rid))
    if (!r) throw notFound('Test round not found')
    requireProjectRole(db, req.user, r.project_id, min)
    return r
  }
  app.get('/api/runs/:rid', (req, res) => {
    const r = loadRun(req)
    const run = runView(db, r.id)
    const bugs = projectBugsView(db, r.project_id)
    res.json({ ...runSummary(r.id), items: run.itemsSnapshot, results: run.results,
      bugs: bugs.filter((b) => b.runId === run.id).map((b) => ({ id: b.id, title: b.title, status: b.status, severity: b.severity, itemId: b.itemId })) })
  })
  app.put('/api/runs/:rid/items/:code', (req, res) => {
    const r = loadRun(req, 'tester')
    if (r.status === 'closed') throw new HttpError(409, 'This round is closed. Start a new test round.')
    const code = decodeURIComponent(req.params.code)
    const cur = db.prepare('SELECT * FROM run_items WHERE run_id = ? AND code = ?').get(r.id, code)
    if (!cur) throw notFound('Task is not in this round')
    const b = req.body || {}
    const status = b.status !== undefined ? oneOf(b.status, STATUSES, 'status') : cur.status
    const notes = b.notes !== undefined ? str(b.notes, 4000) : cur.notes
    db.prepare(`UPDATE run_items SET status = ?, notes = ?, tester_id = ?, source = 'manual', updated_at = datetime('now') WHERE run_id = ? AND code = ?`).run(status, notes, req.user.id, r.id, code)
    if (status !== cur.status) db.prepare('INSERT INTO result_history (run_id, code, from_status, to_status, by_user, by_source) VALUES (?,?,?,?,?,?)').run(r.id, code, cur.status, status, req.user.id, 'manual')
    res.json({ code, status, notes, tester: req.user.name })
  })
  app.post('/api/runs/:rid/close', (req, res) => {
    const r = loadRun(req, 'tester')
    if (r.status === 'open') db.prepare(`UPDATE runs SET status = 'closed', closed_at = datetime('now') WHERE id = ?`).run(r.id)
    res.json(runSummary(r.id))
  })

  // bugs
  function createBug({ projectId, runDbId, itemId, title, severity, description, stepsToReproduce, expected, actual, url, reporterId, assigneeId }) {
    const t = str(title, 300); if (!t) throw bad('Bug needs a title')
    const code = bugCodeNext(db, projectId)
    const id = Number(db.prepare(`INSERT INTO bugs (project_id, code, title, severity, description, steps, expected, actual, url, task_code, run_id, reporter_id, assignee_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(projectId, code, t, SEVERITIES.includes(severity) ? severity : 'major', str(description), str(stepsToReproduce), str(expected), str(actual), str(url, 300), str(itemId, 30), runDbId || null, reporterId || null, assigneeId || null).lastInsertRowid)
    db.prepare('INSERT INTO bug_events (bug_id, text, by_user) VALUES (?,?,?)').run(id, 'Bug reported', reporterId || null)
    if (runDbId && itemId) db.prepare('INSERT OR IGNORE INTO run_item_bugs (run_id, code, bug_id) VALUES (?,?,?)').run(runDbId, str(itemId, 30), id)
    return { id: code, dbId: id }
  }
  const autoBugCreate = (b) => createBug({ ...b, reporterId: null })
  app.get('/api/projects/:pid/bugs', (req, res) => { const p = loadProject(req); res.json(projectBugsView(db, p.id)) })
  app.post('/api/projects/:pid/bugs', (req, res) => {
    const p = loadProject(req, 'tester'); const b = req.body || {}
    let runDbId = null
    if (b.runId) { const r = db.prepare('SELECT id FROM runs WHERE id = ? AND project_id = ?').get(Number(b.runId), p.id); if (!r) throw bad('Round not found in this project'); runDbId = r.id }
    const out = createBug({ ...b, projectId: p.id, runDbId, reporterId: req.user.id, assigneeId: b.assigneeId ? Number(b.assigneeId) : null })
    res.status(201).json(projectBugsView(db, p.id).find((x) => x.id === out.id))
  })
  app.patch('/api/bugs/:id', (req, res) => {
    const b = db.prepare('SELECT * FROM bugs WHERE id = ?').get(Number(req.params.id))
    if (!b) throw notFound('Bug not found')
    requireProjectRole(db, req.user, b.project_id, 'tester')
    const p = req.body || {}
    const sets = []; const vals = []; const events = []
    const set = (col, v, label) => { if (v !== undefined && String(v) !== String(b[col] ?? '')) { sets.push(`${col} = ?`); vals.push(v); events.push(`${label}: ${b[col] || '-'} -> ${v || '-'}`) } }
    if (p.status !== undefined) set('status', oneOf(p.status, BUG_STATUSES, 'status'), 'Status')
    if (p.severity !== undefined) set('severity', oneOf(p.severity, SEVERITIES, 'severity'), 'Severity')
    if (p.title !== undefined) set('title', str(p.title, 300) || b.title, 'Title')
    if (p.description !== undefined) set('description', str(p.description), 'Description')
    if (p.actual !== undefined) set('actual', str(p.actual), 'What happened')
    if (p.expected !== undefined) set('expected', str(p.expected), 'Expected')
    if (p.assigneeId !== undefined) {
      const aid = p.assigneeId ? Number(p.assigneeId) : null
      if (aid && !db.prepare('SELECT 1 FROM users WHERE id = ?').get(aid)) throw bad('Unknown assignee')
      set('assignee_id', aid, 'Assignee')
    }
    if (sets.length) {
      db.prepare(`UPDATE bugs SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...vals, b.id)
      for (const e of events) db.prepare('INSERT INTO bug_events (bug_id, text, by_user) VALUES (?,?,?)').run(b.id, e, req.user.id)
    }
    if (p.comment) db.prepare('INSERT INTO bug_events (bug_id, text, by_user) VALUES (?,?,?)').run(b.id, `Comment: ${str(p.comment, 1000)}`, req.user.id)
    res.json(projectBugsView(db, b.project_id).find((x) => x.dbId === b.id))
  })
  app.get('/api/bugs/:id/events', (req, res) => {
    const b = db.prepare('SELECT * FROM bugs WHERE id = ?').get(Number(req.params.id))
    if (!b) throw notFound('Bug not found')
    requireProjectRole(db, req.user, b.project_id, 'viewer')
    res.json(db.prepare(`SELECT e.text, e.at, u.name AS by FROM bug_events e LEFT JOIN users u ON u.id = e.by_user WHERE e.bug_id = ? ORDER BY e.id`).all(b.id))
  })

  // automatic checks
  async function doAutoChecks(runDbId, projectId, baseUrl, browser, reporter) {
    const results = await runHttpChecks(baseUrl)
    let browserSkipped = null
    if (browser) { const b = await runBrowserChecks(baseUrl); if (b.skipped) browserSkipped = b.reason; results.push(...b.results) }
    const store = autoStore(db, runDbId, projectId, autoBugCreate)
    const applied = applyResults(store, runLabel(runDbId), results, { reporter })
    return { applied: applied.map((a) => ({ code: a.itemId, status: a.status, notes: a.notes, bug: a.bug || null })), browserSkipped }
  }
  app.post('/api/runs/:rid/auto-checks', wrap(async (req, res) => {
    const r = loadRun(req, 'tester')
    if (r.status === 'closed') throw new HttpError(409, 'This round is closed.')
    const base = str(req.body?.baseUrl, 300) || r.base_url
    if (!base) throw bad('This round has no website address. Set one on the project or when starting the round.')
    res.json(await doAutoChecks(r.id, r.project_id, base, !!req.body?.browser, 'auto-checks'))
  }))

  // report + final email
  app.get('/api/runs/:rid/report.:ext(html|txt)', (req, res) => {
    const r = loadRun(req)
    const run = runView(db, r.id), bugs = projectBugsView(db, r.project_id), prev = previousRunView(db, run)
    if (req.query.download) res.set('Content-Disposition', `attachment; filename="${run.id}-report.${req.params.ext}"`)
    if (req.params.ext === 'html') res.type('html').send(reportHtml(run, bugs, prev)); else res.type('text').send(reportText(run, bugs, prev))
  })
  app.get('/api/runs/:rid/mail', (req, res) => {
    const r = loadRun(req)
    const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(r.project_id)
    const c = mailSettings(p.report_recipients)
    res.json({ to: c.to, from: c.from, ready: c.ready, missing: c.missing })
  })
  app.post('/api/runs/:rid/finish', wrap(async (req, res) => {
    const r = loadRun(req, 'tester')
    const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(r.project_id)
    if (r.status === 'open') db.prepare(`UPDATE runs SET status = 'closed', closed_at = datetime('now') WHERE id = ?`).run(r.id)
    const run = runView(db, r.id)
    const msg = buildMessage(run, projectBugsView(db, r.project_id), previousRunView(db, run))
    const summary = { verdict: msg.stats.verdict, counts: msg.stats.counts, problems: msg.stats.issuesByGroup.filter((x) => x.Fail.length || x.Blocked.length).length }
    if (!req.body?.send) return res.json({ run: runSummary(r.id), subject: msg.subject, summary, sent: false })
    const cfg = mailSettings(p.report_recipients)
    try {
      const out = await sendMessage(msg, run, cfg)
      res.json({ run: runSummary(r.id), subject: msg.subject, summary, sent: true, to: cfg.to, messageId: out.messageId })
    } catch (e) {
      res.json({ run: runSummary(r.id), subject: msg.subject, summary, sent: false, error: e.message, to: cfg.to })
    }
  }))

  // ------------------------------------------------------------ static client
  const dist = path.join(ROOT, 'client/dist')
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }))
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')))
  }
  app.use('/api', (_req, _res, next) => next(notFound('Not found')))
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof SyntaxError && err.status === 400) return res.status(400).json({ error: 'Invalid JSON' })
    const status = err.status || 500
    if (status >= 500) console.error(err)
    res.status(status).json({ error: status >= 500 ? 'Server error' : err.message })
  })
  return app
}

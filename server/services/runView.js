// Turns database rows into the plain run/bug objects the report and automatic-check code work with.
const pad = (n) => String(n).padStart(4, '0')
export const runLabel = (id) => `R-${pad(id)}`

export function getRunRow(db, runId) {
  return db.prepare(`SELECT r.*, p.name AS project_name, u.name AS created_by_name FROM runs r JOIN projects p ON p.id = r.project_id LEFT JOIN users u ON u.id = r.created_by WHERE r.id = ?`).get(runId)
}
export function runView(db, runId) {
  const r = getRunRow(db, runId)
  if (!r) return null
  const rows = db.prepare(`SELECT ri.*, u.name AS tester_name FROM run_items ri LEFT JOIN users u ON u.id = ri.tester_id WHERE ri.run_id = ? ORDER BY ri.sort, ri.code`).all(runId)
  const bugLinks = db.prepare(`SELECT l.code, b.code AS bug_code FROM run_item_bugs l JOIN bugs b ON b.id = l.bug_id WHERE l.run_id = ?`).all(runId)
  const bugsBy = {}
  for (const l of bugLinks) (bugsBy[l.code] ||= []).push(l.bug_code)
  const itemsSnapshot = [], results = {}
  for (const ri of rows) {
    itemsSnapshot.push({ id: ri.code, area: ri.area, group: ri.group_name, title: ri.title, steps: ri.steps, expected: ri.expected, priority: ri.priority, auto: !!ri.auto, ...JSON.parse(ri.extra || '{}') })
    if (ri.status !== 'Not tested' || ri.notes || bugsBy[ri.code]) {
      results[ri.code] = { status: ri.status, notes: ri.notes, tester: ri.tester_name || '', source: ri.source, updatedAt: ri.updated_at, bugIds: bugsBy[ri.code] || [] }
    }
  }
  return {
    id: runLabel(r.id), dbId: r.id, projectId: r.project_id, projectName: r.project_name, name: r.name, environment: r.environment, baseUrl: r.base_url,
    commit: r.commit_sha, status: r.status, createdAt: r.created_at.replace(' ', 'T') + (r.created_at.includes('T') ? '' : 'Z'), closedAt: r.closed_at, createdBy: r.created_by_name || '',
    itemsSnapshot, results,
  }
}
export function projectBugsView(db, projectId) {
  return db.prepare(`SELECT b.*, a.name AS assignee_name, rp.name AS reporter_name FROM bugs b LEFT JOIN users a ON a.id = b.assignee_id LEFT JOIN users rp ON rp.id = b.reporter_id WHERE b.project_id = ? ORDER BY b.id DESC`).all(projectId)
    .map((b) => ({ id: b.code, dbId: b.id, title: b.title, severity: b.severity, status: b.status, description: b.description, stepsToReproduce: b.steps, expected: b.expected, actual: b.actual,
      url: b.url, itemId: b.task_code, runId: b.run_id ? runLabel(b.run_id) : '', assignee: b.assignee_name || '', reporter: b.reporter_name || '', createdAt: b.created_at, updatedAt: b.updated_at }))
}
export function previousRunView(db, run) {
  const prev = db.prepare(`SELECT id FROM runs WHERE project_id = ? AND environment = ? AND id < ? ORDER BY id DESC LIMIT 1`).get(run.projectId, run.environment, run.dbId)
  return prev ? runView(db, prev.id) : null
}

// Adapter so the shared automatic-check code (written for the single-project app) can write into this database.
export function autoStore(db, runDbId, projectId, bugCreate) {
  return {
    getRun: () => runView(db, runDbId),
    setResult(_run, code, { status, notes, tester, source }) {
      const prev = db.prepare('SELECT status FROM run_items WHERE run_id = ? AND code = ?').get(runDbId, code)
      if (!prev) return
      db.prepare(`UPDATE run_items SET status = ?, notes = ?, source = ?, tester_id = NULL, updated_at = datetime('now') WHERE run_id = ? AND code = ?`).run(status, notes || '', source || 'auto', runDbId, code)
      if (prev.status !== status) db.prepare(`INSERT INTO result_history (run_id, code, from_status, to_status, by_source) VALUES (?,?,?,?,?)`).run(runDbId, code, prev.status, status, source || tester || 'auto')
    },
    listBugs: () => projectBugsView(db, projectId),
    linkBug(_run, code, bugCode) {
      const b = db.prepare('SELECT id FROM bugs WHERE project_id = ? AND code = ?').get(projectId, bugCode)
      if (b) db.prepare('INSERT OR IGNORE INTO run_item_bugs (run_id, code, bug_id) VALUES (?,?,?)').run(runDbId, code, b.id)
    },
    createBug(b) { return bugCreate({ ...b, runDbId, projectId }) },
  }
}

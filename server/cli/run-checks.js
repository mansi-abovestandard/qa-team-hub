// For deployment pipelines (runs on the machine that has the database):
//   npm run run-checks -- --project 1 --name v1.4.0 --env staging --url https://staging.example.dk [--commit SHA] [--browser]
// Creates a NEW test round with all tasks again, runs the automatic checks, prints the verdict.
// Exit code 2 when an automatic check failed. Testers then finish the manual tasks in the app.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDb } from '../db.js'
import { runHttpChecks, runBrowserChecks, applyResults } from '../services/autochecks.js'
import { autoStore, runView, projectBugsView, previousRunView, runLabel } from '../services/runView.js'
import { computeStats } from '../services/report.js'

const a = {}
for (let i = 2; i < process.argv.length; i++) if (process.argv[i].startsWith('--')) { const k = process.argv[i].slice(2); const n = process.argv[i + 1]; a[k] = n === undefined || n.startsWith('--') ? true : (i++, n) }
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const db = openDb(process.env.DATABASE_FILE ? path.resolve(ROOT, process.env.DATABASE_FILE) : path.join(ROOT, 'data/qa-hub.db'))
const p = db.prepare('SELECT * FROM projects WHERE id = ? AND archived = 0').get(Number(a.project))
if (!p || !a.name) { console.error('Usage: npm run run-checks -- --project <id> --name <release> [--env staging] [--url https://...] [--commit sha] [--browser]'); process.exit(1) }
const url = a.url || p.base_url
if (!url) { console.error('No website address: pass --url or set one on the project.'); process.exit(1) }
db.exec('BEGIN')
const rid = Number(db.prepare('INSERT INTO runs (project_id, name, environment, base_url, commit_sha) VALUES (?,?,?,?,?)').run(p.id, String(a.name), String(a.env || 'staging'), url, String(a.commit || '')).lastInsertRowid)
db.prepare(`INSERT INTO run_items (run_id, task_id, code, area, group_name, title, steps, expected, priority, auto, extra, sort)
  SELECT ?, id, code, area, group_name, title, steps, expected, priority, auto, extra, sort FROM tasks WHERE project_id = ? AND active = 1`).run(rid, p.id)
db.exec('COMMIT')
console.log(`Created round ${runLabel(rid)} "${a.name}" for project "${p.name}" with all tasks.`)
const results = await runHttpChecks(url)
if (a.browser) { const b = await runBrowserChecks(url); if (b.skipped) console.log('  browser checks skipped: ' + b.reason); results.push(...b.results) }
const store = autoStore(db, rid, p.id, ({ projectId, runDbId, itemId, title, severity, description, actual, expected, url: u }) => {
  const n = db.prepare('SELECT COUNT(*) c FROM bugs WHERE project_id = ?').get(projectId).c + 1
  const code = `BUG-${String(n).padStart(3, '0')}`
  const id = Number(db.prepare(`INSERT INTO bugs (project_id, code, title, severity, description, expected, actual, url, task_code, run_id) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(projectId, code, title, severity, description || '', expected || '', actual || '', u || '', itemId || '', runDbId).lastInsertRowid)
  db.prepare('INSERT INTO bug_events (bug_id, text) VALUES (?, ?)').run(id, 'Bug reported by automatic checks')
  db.prepare('INSERT OR IGNORE INTO run_item_bugs (run_id, code, bug_id) VALUES (?,?,?)').run(runDbId, itemId, id)
  return { id: code }
})
const applied = applyResults(store, runLabel(rid), results)
for (const r of applied) console.log(`  ${r.status.padEnd(5)} ${r.itemId}  ${r.notes}${r.bug ? `  -> ${r.bug}${r.bugNew ? ' (new)' : ''}` : ''}`)
const run = runView(db, rid)
const s = computeStats(run, projectBugsView(db, p.id), previousRunView(db, run))
console.log(`Verdict so far: ${s.verdict} (${s.counts.Pass} pass, ${s.counts.Fail} fail, ${s.counts['Not tested']} not tested). Testers finish the rest in the app.`)
process.exit(applied.some((r) => r.status === 'Fail') ? 2 : 0)

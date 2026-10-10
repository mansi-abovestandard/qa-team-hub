import test from 'node:test'
import assert from 'node:assert/strict'
import { openDb } from '../server/db.js'
import { createApp } from '../server/app.js'

const db = openDb(':memory:')
const app = createApp(db)
let server, base
test.before(async () => { await new Promise((r) => { server = app.listen(0, '127.0.0.1', r) }); base = `http://127.0.0.1:${server.address().port}` })
test.after(() => server.close())

// tiny client with its own cookie jar
const client = () => {
  let cookie = ''
  return async (method, p, body) => {
    const res = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined })
    const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]
    const text = await res.text()
    let data = null; try { data = JSON.parse(text) } catch { data = text }
    return [res.status, data]
  }
}
const admin = client(), tester = client(), viewer = client(), stranger = client()
const PW = 'correct-horse-9'

test('first start: setup creates the admin, then setup is locked', async () => {
  let [c, d] = await admin('GET', '/api/auth/state'); assert.equal(d.needsSetup, true)
  ;[c, d] = await admin('POST', '/api/auth/setup', { email: 'admin@x.dk', name: 'Ada Admin', password: 'short' }); assert.equal(c, 400)
  ;[c, d] = await admin('POST', '/api/auth/setup', { email: 'admin@x.dk', name: 'Ada Admin', password: PW }); assert.equal(c, 201)
  ;[c, d] = await admin('GET', '/api/auth/state'); assert.equal(d.needsSetup, false); assert.equal(d.user.isAdmin, true)
  ;[c] = await client()('POST', '/api/auth/setup', { email: 'evil@x.dk', name: 'E', password: PW }); assert.equal(c, 403)
})

test('nothing is available without signing in', async () => {
  const anon = client()
  for (const p of ['/api/projects', '/api/users', '/api/templates']) { const [c] = await anon('GET', p); assert.equal(c, 401, p) }
})

test('admin adds users; wrong passwords are rejected; login works', async () => {
  let [c, d] = await admin('POST', '/api/users', { email: 'tess@x.dk', name: 'Tess Tester', password: PW }); assert.equal(c, 201)
  ;[c] = await admin('POST', '/api/users', { email: 'vic@x.dk', name: 'Vic Viewer', password: PW }); assert.equal(c, 201)
  ;[c] = await admin('POST', '/api/users', { email: 'sam@x.dk', name: 'Sam Stranger', password: PW }); assert.equal(c, 201)
  ;[c] = await tester('POST', '/api/auth/login', { email: 'tess@x.dk', password: 'nope-nope-1' }); assert.equal(c, 401)
  ;[c] = await tester('POST', '/api/auth/login', { email: 'tess@x.dk', password: PW }); assert.equal(c, 200)
  await viewer('POST', '/api/auth/login', { email: 'vic@x.dk', password: PW })
  await stranger('POST', '/api/auth/login', { email: 'sam@x.dk', password: PW })
  ;[c] = await tester('POST', '/api/users', { email: 'x@x.dk', name: 'X', password: PW }); assert.equal(c, 403) // not admin
  ;[c, d] = await tester('PATCH', '/api/auth/profile', { name: 'Tess T' }); assert.equal(c, 200); assert.equal(d.user.name, 'Tess T')
  ;[c] = await tester('POST', '/api/auth/password', { current: 'wrong-pass-1', next: 'new-password-2' }); assert.equal(c, 400)
  ;[c] = await tester('POST', '/api/auth/password', { current: PW, next: 'new-password-2' }); assert.equal(c, 200)
  ;[c] = await client()('POST', '/api/auth/login', { email: 'tess@x.dk', password: PW }); assert.equal(c, 401)
  ;[c] = await tester('POST', '/api/auth/login', { email: 'tess@x.dk', password: 'new-password-2' }); assert.equal(c, 200)
  ;[c] = await tester('POST', '/api/auth/password', { current: 'new-password-2', next: PW }); assert.equal(c, 200)
  ;[c] = await tester('PATCH', '/api/auth/profile', { name: 'Tess Tester' }); assert.equal(c, 200)
})

let pid, taskCodes
test('project from the built-in template gets every task; members and roles are enforced', async () => {
  let [c, d] = await admin('GET', '/api/templates'); const tpl = d.find((t) => t.name.startsWith('Website + CMS'))
  assert.ok(tpl.items > 500)
  ;[c, d] = await admin('POST', '/api/projects', { name: 'Lokalnyt', templateId: tpl.id, baseUrl: 'https://example.dk', recipients: 'pm@x.dk, mg@x.dk' }); assert.equal(c, 201)
  pid = d.id
  ;[c] = await admin('POST', '/api/projects', { name: 'Bad', recipients: 'not-an-email' }); assert.equal(c, 400)
  ;[c, d] = await admin('GET', `/api/projects/${pid}/tasks`); assert.ok(d.length > 500); taskCodes = d.map((t) => t.code)
  ;[c] = await tester('GET', `/api/projects/${pid}`); assert.equal(c, 403) // not a member yet
  ;[c, d] = await admin('GET', '/api/users'); const id = (e) => d.find((u) => u.email === e).id
  ;[c] = await admin('PUT', `/api/projects/${pid}/members`, { members: [{ userId: id('admin@x.dk'), role: 'admin' }, { userId: id('tess@x.dk'), role: 'tester' }, { userId: id('vic@x.dk'), role: 'viewer' }] })
  assert.equal(c, 200)
  ;[c] = await tester('GET', `/api/projects/${pid}`); assert.equal(c, 200)
  ;[c, d] = await stranger('GET', '/api/projects'); assert.deepEqual(d, []) // sees nothing
  ;[c] = await stranger('GET', `/api/projects/${pid}/tasks`); assert.equal(c, 403)
})

let rid
test('Start new test round creates ALL tasks again, all Not tested', async () => {
  let [c, d] = await tester('POST', `/api/projects/${pid}/runs`, { name: 'v1.0' }); assert.equal(c, 201)
  rid = d.run.id
  assert.equal(d.run.stats.total, taskCodes.length); assert.equal(d.run.stats.counts['Not tested'], taskCodes.length)
  ;[c, d] = await viewer('POST', `/api/projects/${pid}/runs`, { name: 'x' }); assert.equal(c, 403)
  // click again: a second full round exists and the first one keeps its results
  ;[c] = await tester('PUT', `/api/runs/${rid}/items/Q-01`, { status: 'Pass', notes: 'ok' }); assert.equal(c, 200)
  ;[c, d] = await tester('POST', `/api/projects/${pid}/runs`, { name: 'v1.1' }); assert.equal(d.run.stats.counts.Pass, 0)
  ;[c, d] = await tester('GET', `/api/runs/${rid}`); assert.equal(d.results['Q-01'].status, 'Pass')
  ;[c] = await viewer('PUT', `/api/runs/${rid}/items/Q-01`, { status: 'Fail' }); assert.equal(c, 403)
  ;[c] = await tester('PUT', `/api/runs/${rid}/items/Q-01`, { status: 'Maybe' }); assert.equal(c, 400)
})

test('checklist edits create tasks for the next round only', async () => {
  let [c, d] = await admin('POST', `/api/projects/${pid}/tasks`, { title: 'Newsletter archive page', area: 'Public website', group: 'Archive - /arkiv', priority: 'high', expected: 'Lists past newsletters' }); assert.equal(c, 201)
  const t = d
  ;[c, d] = await tester('POST', `/api/projects/${pid}/tasks`, { title: 'x' }); assert.equal(c, 403)
  ;[c, d] = await admin('GET', `/api/runs/${rid}`); assert.ok(!d.items.some((i) => i.id === t.code))
  ;[c, d] = await tester('POST', `/api/projects/${pid}/runs`, { name: 'v1.2' }); assert.equal(d.run.stats.total, taskCodes.length + 1)
  ;[c] = await admin('DELETE', `/api/tasks/${t.id}`); assert.equal(c, 200)
  ;[c, d] = await admin('POST', `/api/projects/${pid}/tasks/import`, { csv: 'code,area,group,title,expected,priority\nZ-1,Public website,Imported page,Imported check,works,HIGH\n' }); assert.equal(d.added, 1)
  ;[c, d] = await admin('POST', `/api/projects/${pid}/tasks/import`, { csv: 'code,title\nZ-1,again\n' }); assert.equal(d.skipped, 1)
})

test('bugs: created from a check, linked to the round, status flow and history', async () => {
  let [c, d] = await tester('POST', `/api/projects/${pid}/bugs`, { title: 'Hero missing', severity: 'critical', runId: rid, itemId: 'Q-02', actual: 'blank' }); assert.equal(c, 201)
  const bug = d
  assert.match(bug.id, /^BUG-\d{3}$/)
  ;[c, d] = await tester('GET', `/api/runs/${rid}`); assert.deepEqual(d.results['Q-02'].bugIds, [bug.id])
  ;[c] = await tester('PATCH', `/api/bugs/${bug.dbId}`, { status: 'in_progress', comment: 'looking' }); assert.equal(c, 200)
  ;[c] = await tester('PATCH', `/api/bugs/${bug.dbId}`, { status: 'weird' }); assert.equal(c, 400)
  ;[c, d] = await viewer('GET', `/api/bugs/${bug.dbId}/events`); assert.ok(d.length >= 3)
  ;[c] = await viewer('PATCH', `/api/bugs/${bug.dbId}`, { status: 'fixed' }); assert.equal(c, 403)
})

test('report lists problems per page; finish closes the round; email needs settings', async () => {
  await tester('PUT', `/api/runs/${rid}/items/Q-01`, { status: 'Fail', notes: 'Hero missing on phone' })
  const [c, html] = await viewer('GET', `/api/runs/${rid}/report.html`); assert.equal(c, 200); assert.match(html, /Pages and modules with problems/); assert.match(html, /blank/); assert.match(html, /Every checked task/); assert.match(html, /Hero missing on phone/)
  let [c2, txt] = await viewer('GET', `/api/runs/${rid}/report.txt`); assert.match(txt, /NO-GO/)
  const saved = { ...process.env }; for (const k of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS']) delete process.env[k]
  let [c3, d] = await tester('GET', `/api/runs/${rid}/mail`); assert.deepEqual(d.to, ['pm@x.dk', 'mg@x.dk']); assert.equal(d.ready, false)
  ;[c3, d] = await tester('POST', `/api/runs/${rid}/finish`, { send: true })
  Object.assign(process.env, saved)
  assert.equal(c3, 200); assert.equal(d.sent, false); assert.match(d.error, /Missing/); assert.equal(d.run.status, 'closed')
  ;[c3] = await tester('PUT', `/api/runs/${rid}/items/Q-01`, { status: 'Pass' }); assert.equal(c3, 409)
})

test('security: cross-site and non-JSON writes are blocked; last admin is protected', async () => {
  const res = await fetch(base + '/api/projects', { method: 'POST', headers: { 'content-type': 'text/plain', origin: 'https://evil.example' }, body: '{}' })
  assert.ok([403, 415].includes(res.status))
  let [c, d] = await admin('GET', '/api/users'); const me = d.find((u) => u.email === 'admin@x.dk')
  ;[c, d] = await admin('PATCH', `/api/users/${me.id}`, { isAdmin: false }); assert.equal(c, 400)
  ;[c] = await tester('POST', `/api/projects/${pid}/save-as-template`, { name: 'T' }); assert.equal(c, 403)
  ;[c, d] = await admin('POST', `/api/projects/${pid}/save-as-template`, { name: 'My site template' }); assert.equal(c, 201); assert.ok(d.items > 500)
})

test('editor records a branch; production deploy waits for a passed staging test', async () => {
  const editor = client()
  let [c, d] = await admin('POST', '/api/users', { email: 'edi@x.dk', name: 'Ed Editor', password: PW }); assert.equal(c, 201)
  ;[c] = await editor('POST', '/api/auth/login', { email: 'edi@x.dk', password: PW }); assert.equal(c, 200)
  ;[c, d] = await admin('GET', '/api/users'); const id = (e) => d.find((u) => u.email === e).id
  ;[c] = await admin('PUT', `/api/projects/${pid}/members`, { members: [
    { userId: id('admin@x.dk'), role: 'admin' }, { userId: id('tess@x.dk'), role: 'tester' }, { userId: id('vic@x.dk'), role: 'viewer' }, { userId: id('edi@x.dk'), role: 'editor' },
  ] }); assert.equal(c, 200)
  ;[c] = await tester('POST', `/api/projects/${pid}/deployments`, { branchName: 'nope', developer: 'Tess', baseBranch: 'main' }); assert.equal(c, 403)
  ;[c, d] = await editor('POST', `/api/projects/${pid}/deployments`, { branchName: 'fix/logo', baseBranch: 'main', developer: 'Surbhi', description: 'logo centering', branchType: 'issue', stagingDeploy: 'deployed' }); assert.equal(c, 201); assert.equal(d.developer, 'Ed Editor'); assert.equal(d.createdBy, 'Ed Editor')
  const dep = d
  assert.equal(dep.readyForProd, false)
  ;[c] = await editor('PATCH', `/api/deployments/${dep.id}`, { liveDeploy: 'deployed' }); assert.equal(c, 400)
  ;[c] = await tester('PATCH', `/api/deployments/${dep.id}`, { stagingTest: 'complete', stagingResult: 'pass' }); assert.equal(c, 200)
  ;[c, d] = await editor('PATCH', `/api/deployments/${dep.id}`, { liveDeploy: 'deployed' }); assert.equal(c, 200); assert.equal(d.liveDeploy, 'deployed'); assert.equal(d.readyForProd, true)
  ;[c] = await tester('PATCH', `/api/deployments/${dep.id}`, { branchName: 'hijack' }); assert.equal(c, 403)
  ;[c] = await viewer('DELETE', `/api/deployments/${dep.id}`); assert.equal(c, 403)
})

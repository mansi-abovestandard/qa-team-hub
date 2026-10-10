// Builds the numbers, the GO / NO-GO verdict, and the HTML + plain-text report for one run.
const STATUSES = ['Not tested', 'Pass', 'Fail', 'Blocked', 'Not applicable']

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const PRI_RANK = { high: 0, medium: 1, low: 2 }
const SEV_RANK = { critical: 0, major: 1, minor: 2, trivial: 3 }
const OPEN_BUG = (b) => ['open', 'in_progress', 'fixed'].includes(b.status) // fixed but not verified is still open for release purposes
const bugNotes = (b) => [b.actual, b.description].filter(Boolean).join(' — ')

export function computeStats(run, bugs, previousRun = null) {
  const items = run.itemsSnapshot
  const statusOf = (id) => run.results[id]?.status || 'Not tested'
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]))
  const byArea = {}
  const byPriority = {}
  const failed = [], blocked = [], untestedHigh = [], untestedAll = [], checked = []
  for (const it of items) {
    const st = statusOf(it.id)
    counts[st]++
    const a = (byArea[it.area] ||= Object.fromEntries([['total', 0], ...STATUSES.map((s) => [s, 0])]))
    a.total++; a[st]++
    const p = (byPriority[it.priority] ||= Object.fromEntries([['total', 0], ...STATUSES.map((s) => [s, 0])]))
    p.total++; p[st]++
    const r = run.results[it.id] || {}
    const row = { ...it, status: st, notes: r.notes || '', tester: r.tester || '', source: r.source || '', bugIds: r.bugIds || [] }
    if (st !== 'Not tested' || r.notes) checked.push(row)
    if (st === 'Fail') failed.push(row)
    if (st === 'Blocked') blocked.push(row)
    if (st === 'Not tested') { untestedAll.push(row); if (it.priority === 'high') untestedHigh.push(row) }
  }
  const sortP = (a, b) => (PRI_RANK[a.priority] - PRI_RANK[b.priority]) || a.id.localeCompare(b.id)
  failed.sort(sortP); blocked.sort(sortP); untestedHigh.sort(sortP)
  // every page / module with something wrong, so the team sees WHERE problems are
  const groups = new Map()
  for (const it of items) {
    const st = statusOf(it.id)
    if (st === 'Pass' || st === 'Not applicable') continue
    const key = `${it.area}\u0000${it.group}`
    const g = groups.get(key) || { area: it.area, group: it.group, Fail: [], Blocked: [], 'Not tested': [] }
    const rr = run.results[it.id] || {}
    g[st].push({ ...it, status: st, notes: rr.notes || '', bugIds: rr.bugIds || [] })
    groups.set(key, g)
  }
  const issuesByGroup = [...groups.values()].sort((a, b) =>
    (b.Fail.length - a.Fail.length) || (b.Blocked.length - a.Blocked.length) || (b['Not tested'].length - a['Not tested'].length) || a.group.localeCompare(b.group))
  const total = items.length
  const applicable = total - counts['Not applicable']
  const tested = counts['Pass'] + counts['Fail'] + counts['Blocked']
  const passRate = applicable ? counts['Pass'] / applicable : 0
  const progress = applicable ? tested / applicable : 0

  const runBugs = bugs.filter((b) => b.runId === run.id)
  const openBugs = bugs.filter(OPEN_BUG).sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity])
  const blockingBugs = openBugs.filter((b) => ['critical', 'major'].includes(b.severity))

  // regressions: passed in previous run for the same environment, failed now
  const regressions = [], fixedSince = []
  if (previousRun) {
    for (const it of items) {
      const was = previousRun.results[it.id]?.status, now = statusOf(it.id)
      if (was === 'Pass' && now === 'Fail') regressions.push(it)
      if (was === 'Fail' && now === 'Pass') fixedSince.push(it)
    }
  }

  const reasons = []
  const failedHigh = failed.filter((f) => f.priority === 'high')
  if (failedHigh.length) reasons.push(`${failedHigh.length} high-priority check(s) failed`)
  if (blockingBugs.length) reasons.push(`${blockingBugs.length} open critical/major bug(s)`)
  if (untestedHigh.length) reasons.push(`${untestedHigh.length} high-priority check(s) not tested yet`)
  const blockedHigh = blocked.filter((b) => b.priority === 'high')
  if (blockedHigh.length) reasons.push(`${blockedHigh.length} high-priority check(s) blocked`)
  let verdict = 'GO', verdictText = 'Ready to release'
  if (reasons.length) { verdict = 'NO-GO'; verdictText = 'Not ready to release' }
  else if (failed.length || untestedAll.length || blocked.length || openBugs.length) {
    verdict = 'GO WITH RISKS'; verdictText = 'Can be released; known smaller issues remain'
    if (failed.length) reasons.push(`${failed.length} lower-priority check(s) failed`)
    if (untestedAll.length) reasons.push(`${untestedAll.length} lower-priority check(s) not tested`)
    if (openBugs.length) reasons.push(`${openBugs.length} open minor bug(s)`)
  }
  return { total, applicable, tested, counts, passRate, progress, byArea, byPriority, failed, blocked, checked, untestedHigh,
    untestedCount: untestedAll.length, issuesByGroup, openBugs, runBugs, regressions, fixedSince, verdict, verdictText, reasons }
}

const pct = (x) => `${Math.round(x * 100)}%`

export function reportText(run, bugs, previousRun) {
  const s = computeStats(run, bugs, previousRun)
  const L = []
  L.push(`QA REPORT - ${run.name} (${run.environment})`)
  L.push(`Run ${run.id} | started ${run.createdAt.slice(0, 16).replace('T', ' ')} UTC${run.commit ? ` | commit ${run.commit}` : ''}${run.baseUrl ? ` | ${run.baseUrl}` : ''}`)
  L.push('')
  L.push(`VERDICT: ${s.verdict} - ${s.verdictText}`)
  for (const r of s.reasons) L.push(`  - ${r}`)
  L.push('')
  L.push(`Progress: ${s.tested}/${s.applicable} checked (${pct(s.progress)}) | Pass rate: ${pct(s.passRate)}`)
  L.push(`Pass ${s.counts['Pass']} | Fail ${s.counts['Fail']} | Blocked ${s.counts['Blocked']} | Not tested ${s.counts['Not tested']} | Not applicable ${s.counts['Not applicable']}`)
  L.push('')
  L.push('BY AREA')
  for (const [a, v] of Object.entries(s.byArea)) L.push(`  ${a.padEnd(18)} pass ${String(v['Pass']).padStart(3)} / fail ${String(v['Fail']).padStart(3)} / blocked ${String(v['Blocked']).padStart(3)} / not tested ${String(v['Not tested']).padStart(3)}  (total ${v.total})`)
  if (s.regressions.length) { L.push(''); L.push(`REGRESSIONS (passed last run, failing now): ${s.regressions.length}`); s.regressions.slice(0, 15).forEach((r) => L.push(`  - ${r.id} ${r.title}`)) }
  if (s.fixedSince.length) { L.push(''); L.push(`FIXED SINCE LAST RUN: ${s.fixedSince.length}`) }
  const bad = s.issuesByGroup.filter((g) => g.Fail.length || g.Blocked.length)
  L.push(''); L.push(`PAGES / MODULES WITH PROBLEMS: ${bad.length} (of ${s.issuesByGroup.length} with anything not passed)`)
  for (const g of bad.slice(0, 40)) {
    L.push(`  ${g.group}  [${g.area}]  - ${g.Fail.length} failed, ${g.Blocked.length} blocked, ${g['Not tested'].length} not tested`)
    for (const f of [...g.Fail, ...g.Blocked].slice(0, 6)) L.push(`      ${f.status === 'Fail' ? 'FAIL   ' : 'BLOCKED'} ${f.id} ${f.title}${f.notes ? ' - ' + f.notes.replace(/\s+/g, ' ').slice(0, 140) : ''}${f.bugIds.length ? ' (' + f.bugIds.join(', ') + ')' : ''}`)
  }
  if (bad.length > 40) L.push(`  ... and ${bad.length - 40} more (see the HTML report)`)
  const clean = s.issuesByGroup.filter((g) => !g.Fail.length && !g.Blocked.length)
  if (clean.length) L.push(`  (${clean.length} more page(s)/module(s) have checks not tested yet but nothing failed)`)
  if (s.failed.length) {
    L.push(''); L.push(`FAILED CHECKS (${s.failed.length})`)
    s.failed.slice(0, 25).forEach((f) => L.push(`  [${f.priority.toUpperCase()}] ${f.id} ${f.group} > ${f.title}${f.notes ? `\n      ${f.notes.replace(/\s+/g, ' ').slice(0, 200)}` : ''}${f.bugIds.length ? `\n      bugs: ${f.bugIds.join(', ')}` : ''}`))
    if (s.failed.length > 25) L.push(`  ... and ${s.failed.length - 25} more (see the HTML report)`)
  }
  if (s.openBugs.length) {
    L.push(''); L.push(`OPEN BUGS (${s.openBugs.length})`)
    s.openBugs.forEach((b) => L.push(`  ${b.id} [${b.severity}] ${b.title} - ${b.status}${b.itemId ? ` - ${b.itemId}` : ''}${b.assignee ? ` - ${b.assignee}` : ''}${bugNotes(b) ? `\n      ${bugNotes(b).replace(/\s+/g, ' ')}` : ''}`))
  }
  if (s.checked.length) {
    L.push(''); L.push(`EVERY CHECKED TASK (${s.checked.length}) — pass, fail, blocked and n/a, with notes`)
    s.checked.forEach((f) => L.push(`  ${f.status.toUpperCase().padEnd(14)} ${f.id} ${f.group} > ${f.title}${f.notes ? `\n      note: ${f.notes.replace(/\s+/g, ' ')}` : ''}${f.bugIds.length ? `\n      bugs: ${f.bugIds.join(', ')}` : ''}`))
  }
  if (s.untestedHigh.length) { L.push(''); L.push(`HIGH-PRIORITY NOT TESTED (${s.untestedHigh.length})`); s.untestedHigh.slice(0, 15).forEach((u) => L.push(`  - ${u.id} ${u.title}`)) }
  return L.join('\n')
}

export function reportHtml(run, bugs, previousRun) {
  const s = computeStats(run, bugs, previousRun)
  const col = { GO: '#1a7f37', 'GO WITH RISKS': '#b7791f', 'NO-GO': '#c0262d' }[s.verdict]
  const table = (head, rows) => `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${head.length}">None</td></tr>`}</tbody></table>`
  const areaRows = Object.entries(s.byArea).map(([a, v]) => [esc(a), v.total, v['Pass'], v['Fail'], v['Blocked'], v['Not tested'], v['Not applicable']])
  const failRows = s.failed.map((f) => [esc(f.id), esc(f.priority), esc(f.group), esc(f.title), esc(f.notes), esc(f.bugIds.join(', '))])
  const blockedRows = s.blocked.map((f) => [esc(f.id), esc(f.priority), esc(f.group), esc(f.title), esc(f.notes)])
  const bugRows = s.openBugs.map((b) => [esc(b.id), esc(b.severity), esc(b.status), esc(b.title), esc(b.itemId), esc(bugNotes(b)), esc(b.expected), esc(b.assignee)])
  const checkedRows = s.checked.map((f) => [esc(f.status), esc(f.id), esc(f.group), esc(f.title), esc(f.notes), esc(f.bugIds.join(', '))])
  const untested = s.untestedHigh.map((u) => [esc(u.id), esc(u.group), esc(u.title)])
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>QA report - ${esc(run.name)}</title>
<style>
html{color-scheme:light}body{font:15px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#fff;color:#1c2430;max-width:1000px;margin:24px auto;padding:0 16px}
h1{font-size:24px;margin:0 0 4px} h2{font-size:18px;margin:28px 0 8px;border-bottom:2px solid #e3e8ef;padding-bottom:4px}
.meta{color:#5b6675;font-size:13px}.verdict{border-radius:10px;padding:16px 20px;color:#fff;margin:16px 0;background:${col}}
.verdict b{font-size:22px}.cards{display:flex;gap:10px;flex-wrap:wrap}.card{flex:1;min-width:120px;border:1px solid #e3e8ef;border-radius:8px;padding:10px 12px}
.card .n{font-size:26px;font-weight:700}.pass .n{color:#1a7f37}.fail .n{color:#c0262d}.blocked .n{color:#b7791f}
table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #e3e8ef;padding:6px 8px;text-align:left;vertical-align:top}th{background:#f2f6fc}
.bar{height:10px;background:#e3e8ef;border-radius:6px;overflow:hidden}.bar i{display:block;height:100%;background:#1a7f37}
</style></head><body>
<h1>QA report - ${esc(run.name)}</h1>
<div class="meta">${esc(run.environment)} | run ${esc(run.id)} | started ${esc(run.createdAt.slice(0, 16).replace('T', ' '))} UTC${run.commit ? ` | commit ${esc(run.commit)}` : ''}${run.baseUrl ? ` | ${esc(run.baseUrl)}` : ''}${run.status === 'closed' ? ' | closed' : ' | still open'}</div>
<div class="verdict"><b>${esc(s.verdict)}</b> &nbsp; ${esc(s.verdictText)}<ul>${s.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul></div>
<div class="cards">
<div class="card pass"><div class="n">${s.counts['Pass']}</div>Pass</div>
<div class="card fail"><div class="n">${s.counts['Fail']}</div>Fail</div>
<div class="card blocked"><div class="n">${s.counts['Blocked']}</div>Blocked</div>
<div class="card"><div class="n">${s.counts['Not tested']}</div>Not tested</div>
<div class="card"><div class="n">${pct(s.passRate)}</div>Pass rate</div></div>
<p>Progress: ${s.tested} of ${s.applicable} checked (${pct(s.progress)})</p><div class="bar"><i style="width:${Math.round(s.progress * 100)}%"></i></div>
<h2>By area</h2>${table(['Area', 'Total', 'Pass', 'Fail', 'Blocked', 'Not tested', 'N/A'], areaRows)}
${s.regressions.length ? `<h2>Regressions (passed last run, failing now)</h2>${table(['ID', 'Area', 'Check'], s.regressions.map((r) => [esc(r.id), esc(r.area), esc(r.title)]))}` : ''}
<h2>Pages and modules with problems</h2>${table(['Area', 'Page / module', 'Failed', 'Blocked', 'Not tested', 'What failed'],
  s.issuesByGroup.map((g) => [esc(g.area), esc(g.group), g.Fail.length, g.Blocked.length, g['Not tested'].length,
    esc([...g.Fail, ...g.Blocked].slice(0, 8).map((f) => `${f.status === 'Fail' ? 'FAIL' : 'BLOCKED'} ${f.id} ${f.title}${f.notes ? ' - ' + f.notes.slice(0, 120) : ''}`).join('\n')).replace(/\n/g, '<br>')]))}
<h2>Failed checks (${s.failed.length})</h2>${table(['ID', 'Priority', 'Where', 'Check', 'Notes', 'Bugs'], failRows)}
<h2>Blocked checks (${s.blocked.length})</h2>${table(['ID', 'Priority', 'Where', 'Check', 'Notes'], blockedRows)}
<h2>Open bugs (${s.openBugs.length})</h2>${table(['Bug', 'Severity', 'Status', 'Title', 'Check', 'What happened', 'Expected', 'Assignee'], bugRows)}
<h2>Every checked task (${s.checked.length})</h2><p class="meta">Pass, fail, blocked and not applicable, including the note written on each task and any bug linked to it. Tasks still marked "Not tested" are not repeated here.</p>${table(['Status', 'ID', 'Where', 'Check', 'Notes', 'Bugs'], checkedRows)}
<h2>High-priority checks not tested (${s.untestedHigh.length})</h2>${table(['ID', 'Where', 'Check'], untested)}
<p class="meta">Verdict rules: NO-GO if any high-priority check failed, is blocked or untested, or a critical/major bug is open. GO WITH RISKS if only lower-priority issues remain. Otherwise GO.</p>
</body></html>`
}

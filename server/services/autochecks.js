// Automated checks. They write results into a run so nobody has to set these statuses by hand.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const TECH_ERROR = /(stack ?trace|at \S+ \(.*:\d+:\d+\)|Internal Server Error|TypeError|ReferenceError|ECONNREFUSED|undefined is not)/i

async function get(fetchImpl, url, opts = {}) {
  const t0 = Date.now()
  const res = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(opts.timeout ?? 15000), headers: { 'user-agent': 'lokalnyt-qa-tracker/1.0' } })
  const body = await res.text()
  return { status: res.status, body, ms: Date.now() - t0, type: res.headers.get('content-type') || '' }
}
const ok = (itemId, notes) => ({ itemId, status: 'Pass', notes: `Automated: ${notes}` })
const bad = (itemId, notes) => ({ itemId, status: 'Fail', notes: `Automated: ${notes}` })
const guard = async (itemId, fn) => {
  try { return await fn() } catch (e) { return bad(itemId, `could not complete the check (${e.cause?.code || e.message})`) }
}

export function loadUrlPaths() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'urls.json'), 'utf8')).paths }
  catch { return ['/'] }
}

export async function runHttpChecks(baseUrl, { fetchImpl = fetch, paths = loadUrlPaths() } = {}) {
  const base = baseUrl.replace(/\/+$/, '')
  const results = []

  results.push(await guard('AUTO-01', async () => {
    const r = await get(fetchImpl, base + '/')
    if (r.status !== 200) return bad('AUTO-01', `home page returned HTTP ${r.status}`)
    if (!/<title>[^<]{2,}<\/title>/i.test(r.body)) return bad('AUTO-01', 'home page has no <title>')
    if (r.ms > 5000) return bad('AUTO-01', `home page took ${r.ms} ms (limit 5000 ms)`)
    if (TECH_ERROR.test(r.body)) return bad('AUTO-01', 'home page shows technical error text')
    return ok('AUTO-01', `HTTP 200, title present, ${r.ms} ms`)
  }))

  results.push(await guard('AUTO-02', async () => {
    const robots = await get(fetchImpl, base + '/robots.txt')
    if (robots.status !== 200) return bad('AUTO-02', `robots.txt returned HTTP ${robots.status}`)
    let map = await get(fetchImpl, base + '/sitemap.xml')
    if (map.status !== 200) return bad('AUTO-02', `sitemap.xml returned HTTP ${map.status}`)
    if (!/<(urlset|sitemapindex)[\s>]/i.test(map.body)) return bad('AUTO-02', 'sitemap.xml is not valid sitemap XML')
    let locs = [...map.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1])
    if (/<sitemapindex/i.test(map.body) && locs[0]) {
      map = await get(fetchImpl, locs[0])
      locs = [...map.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1])
    }
    if (!locs.length) return bad('AUTO-02', 'sitemap lists no URLs')
    const step = Math.max(1, Math.floor(locs.length / 5))
    const sample = locs.filter((_, i) => i % step === 0).slice(0, 5)
    const failed = []
    for (const u of sample) {
      const r = await get(fetchImpl, u).catch((e) => ({ status: e.message }))
      if (r.status !== 200) failed.push(`${u} -> ${r.status}`)
    }
    if (failed.length) return bad('AUTO-02', `sitemap URLs failing: ${failed.join('; ')}`)
    return ok('AUTO-02', `robots.txt and sitemap.xml fine, ${locs.length} URLs listed, ${sample.length} sampled OK`)
  }))

  results.push(await guard('AUTO-03', async () => {
    const failed = []
    for (const p of paths) {
      const r = await get(fetchImpl, base + p).catch((e) => ({ status: e.message, type: '' }))
      if (r.status !== 200 || !/html/i.test(r.type || 'html')) failed.push(`${p} -> ${r.status}`)
    }
    if (failed.length) return bad('AUTO-03', `${failed.length}/${paths.length} pages failing: ${failed.join('; ')}`)
    return ok('AUTO-03', `${paths.length} pages returned 200`)
  }))

  results.push(await guard('AUTO-04', async () => {
    const r = await get(fetchImpl, `${base}/qa-does-not-exist-${Date.now()}`)
    if (r.status !== 404) return bad('AUTO-04', `unknown address returned HTTP ${r.status} instead of 404`)
    if (TECH_ERROR.test(r.body)) return bad('AUTO-04', '404 page shows technical error text')
    return ok('AUTO-04', 'unknown address gives a clean 404 page')
  }))

  results.push(await guard('AUTO-05', async () => {
    const r = await get(fetchImpl, base + '/api/health')
    return r.status === 200 ? ok('AUTO-05', 'health endpoint returned 200') : bad('AUTO-05', `health endpoint returned HTTP ${r.status}`)
  }))
  return results
}

// Browser checks need Playwright (optional dependency + `npx playwright install chromium`).
export async function runBrowserChecks(baseUrl) {
  let chromium
  try { ({ chromium } = await import('playwright')) }
  catch { return { skipped: true, reason: 'Playwright is not installed (npm install playwright && npx playwright install chromium)', results: [] } }
  const base = baseUrl.replace(/\/+$/, '')
  const results = []
  const browser = await chromium.launch()
  try {
    // AUTO-06 console errors + AUTO-07 cookie banner (fresh context = first visit)
    const ctx = await browser.newContext({ locale: 'da-DK' })
    const page = await ctx.newPage()
    const errors = []
    const origin = new URL(base).origin
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 160)}`) })
    page.on('pageerror', (e) => errors.push(`script error: ${String(e.message).slice(0, 160)}`))
    page.on('response', (r) => { if (r.status() >= 400 && r.url().startsWith(origin)) errors.push(`${r.status()} ${r.url().slice(0, 140)}`) })
    await page.goto(base + '/', { waitUntil: 'networkidle', timeout: 45000 })
    await page.waitForTimeout(1500)
    results.push(errors.length ? { itemId: 'AUTO-06', status: 'Fail', notes: `Automated: ${errors.length} problem(s): ${errors.slice(0, 5).join(' | ')}` }
                              : { itemId: 'AUTO-06', status: 'Pass', notes: 'Automated: no console errors, no failed same-site requests' })
    const banner = page.locator('.cmp-banner')
    const showed = await banner.first().isVisible().catch(() => false)
    if (!showed) results.push({ itemId: 'AUTO-07', status: 'Fail', notes: 'Automated: cookie banner (.cmp-banner) not visible on first visit' })
    else {
      await page.locator('[data-cmp="accept"]').first().click()
      await page.reload({ waitUntil: 'networkidle' })
      await page.waitForTimeout(800)
      const again = await page.locator('.cmp-banner').first().isVisible().catch(() => false)
      results.push(again ? { itemId: 'AUTO-07', status: 'Fail', notes: 'Automated: banner shown again after accepting and reloading' }
                         : { itemId: 'AUTO-07', status: 'Pass', notes: 'Automated: banner shown on first visit, gone after accept + reload' })
    }
    // AUTO-08 header menu links
    const links = await page.$$eval('nav.main-navigation a[href]', (as) => [...new Set(as.map((a) => a.href))])
    const internal = links.filter((l) => l.startsWith(origin) && !l.includes('#')).slice(0, 40)
    if (!internal.length) results.push({ itemId: 'AUTO-08', status: 'Fail', notes: 'Automated: no menu links found in nav.main-navigation' })
    else {
      const failed = []
      for (const l of internal) {
        const r = await ctx.request.get(l).catch((e) => ({ status: () => e.message }))
        if (r.status() !== 200) failed.push(`${l} -> ${r.status()}`)
      }
      results.push(failed.length ? { itemId: 'AUTO-08', status: 'Fail', notes: `Automated: ${failed.length}/${internal.length} menu links failing: ${failed.slice(0, 5).join('; ')}` }
                                 : { itemId: 'AUTO-08', status: 'Pass', notes: `Automated: ${internal.length} menu links returned 200` })
    }
    await ctx.close()
  } finally { await browser.close() }
  return { skipped: false, results }
}

// Writes results into the run. A failed automatic check files (or re-uses) a bug.
export function applyResults(store, runId, results, { reporter = 'auto-checks' } = {}) {
  const applied = []
  for (const r of results) {
    const run = store.getRun(runId)
    if (!run.itemsSnapshot.some((i) => i.id === r.itemId)) continue
    store.setResult(runId, r.itemId, { status: r.status, notes: r.notes, tester: reporter, source: 'auto' })
    if (r.status === 'Fail') {
      const existing = store.listBugs().find((b) => b.itemId === r.itemId && ['open', 'in_progress', 'fixed'].includes(b.status))
      if (existing) { store.linkBug(runId, r.itemId, existing.id); applied.push({ ...r, bug: existing.id, bugNew: false }) }
      else {
        const item = run.itemsSnapshot.find((i) => i.id === r.itemId)
        const bug = store.createBug({ title: `${item.title} failed (${run.name})`, severity: item.priority === 'high' ? 'major' : 'minor',
          description: r.notes, actual: r.notes, expected: item.expected, itemId: r.itemId, runId, url: run.baseUrl, reporter })
        applied.push({ ...r, bug: bug.id, bugNew: true })
      }
    } else applied.push(r)
  }
  return applied
}

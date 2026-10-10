import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { tx } from '../db.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const rowToItem = (r) => ({ code: r.code, area: r.area, group: r.group_name, title: r.title, steps: r.steps, expected: r.expected, priority: r.priority, auto: !!r.auto, extra: JSON.parse(r.extra || '{}') })

// keep the extra descriptive fields (when it appears, source...) without a column for each
function packItem(it, i) {
  const { id, code, area, group, title, steps, expected, priority, auto, ...rest } = it
  return { code: String(code || id), area: String(area || 'General'), group: String(group || 'General'), title: String(title), steps: String(steps || ''),
    expected: String(expected || ''), priority: ['high', 'medium', 'low'].includes(priority) ? priority : 'medium', auto: auto ? 1 : 0, extra: JSON.stringify(rest), sort: i }
}
export const packItems = (items) => items.map(packItem)

export function seedTemplates(db) {
  const has = (name) => db.prepare('SELECT id FROM templates WHERE name = ?').get(name)
  tx(db, () => {
    if (!has('Blank (only the automatic website checks)')) {
      const t = db.prepare('INSERT INTO templates (name, description, builtin) VALUES (?, ?, 1)').run('Blank (only the automatic website checks)', 'Start empty and add your own tasks. Includes the 8 automatic website checks.').lastInsertRowid
      const items = JSON.parse(fs.readFileSync(path.join(ROOT, 'seed/lokalnyt-website-cms.json'), 'utf8')).items.filter((i) => i.auto)
      insertTemplateItems(db, t, packItems(items))
    }
    if (!has('Website + CMS (Lokalnyt full checklist)')) {
      const t = db.prepare('INSERT INTO templates (name, description, builtin) VALUES (?, ?, 1)').run('Website + CMS (Lokalnyt full checklist)',
        'Every public page and section, every CMS screen, every-page checks, background jobs and automatic checks. Good starting point for any website with an admin.').lastInsertRowid
      const items = JSON.parse(fs.readFileSync(path.join(ROOT, 'seed/lokalnyt-website-cms.json'), 'utf8')).items
      insertTemplateItems(db, t, packItems(items))
    }
  })
}
function insertTemplateItems(db, templateId, packed) {
  const st = db.prepare('INSERT INTO template_items (template_id, code, area, group_name, title, steps, expected, priority, auto, extra, sort) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
  for (const p of packed) st.run(templateId, p.code, p.area, p.group, p.title, p.steps, p.expected, p.priority, p.auto, p.extra, p.sort)
}
export function insertTasks(db, projectId, packed) {
  const st = db.prepare('INSERT INTO tasks (project_id, code, area, group_name, title, steps, expected, priority, auto, extra, sort) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
  let n = 0
  for (const p of packed) { st.run(projectId, p.code, p.area, p.group, p.title, p.steps, p.expected, p.priority, p.auto, p.extra, p.sort); n++ }
  return n
}
export function copyTemplateToProject(db, templateId, projectId) {
  const rows = db.prepare('SELECT * FROM template_items WHERE template_id = ? ORDER BY sort, id').all(templateId)
  const st = db.prepare('INSERT INTO tasks (project_id, code, area, group_name, title, steps, expected, priority, auto, extra, sort) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
  for (const r of rows) st.run(projectId, r.code, r.area, r.group_name, r.title, r.steps, r.expected, r.priority, r.auto, r.extra, r.sort)
  return rows.length
}
export function saveProjectAsTemplate(db, projectId, name, description = '') {
  return tx(db, () => {
    const t = db.prepare('INSERT INTO templates (name, description, builtin) VALUES (?, ?, 0)').run(name, description).lastInsertRowid
    const rows = db.prepare('SELECT * FROM tasks WHERE project_id = ? AND active = 1 ORDER BY sort, id').all(projectId)
    const st = db.prepare('INSERT INTO template_items (template_id, code, area, group_name, title, steps, expected, priority, auto, extra, sort) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    for (const r of rows) st.run(t, r.code, r.area, r.group_name, r.title, r.steps, r.expected, r.priority, r.auto, r.extra, r.sort)
    return { id: Number(t), items: rows.length }
  })
}

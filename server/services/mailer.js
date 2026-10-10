import { reportHtml, reportText, computeStats } from './report.js'

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
export function parseRecipients(text) {
  return String(text || '').split(/[,;\s]+/).filter(Boolean)
}
export function mailSettings(recipientsText) {
  const to = parseRecipients(recipientsText).filter((e) => EMAIL_RE.test(e))
  const from = process.env.REPORT_FROM || process.env.SMTP_USER || ''
  const missing = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS'].filter((k) => !process.env[k])
  if (!to.length) missing.push('project report recipients')
  if (!from) missing.push('REPORT_FROM')
  return { to, from, missing, ready: missing.length === 0 }
}
export function buildMessage(run, bugs, prev) {
  const s = computeStats(run, bugs, prev)
  const problems = s.issuesByGroup.filter((g) => g.Fail.length || g.Blocked.length).length
  const subject = `[QA] ${run.projectName}: ${s.verdict} - ${run.name} (${run.environment}) - ${s.counts.Pass} pass / ${s.counts.Fail} fail / ${s.counts['Not tested']} not tested` +
    (problems ? ` - ${problems} page(s)/module(s) with problems` : '')
  return { subject, text: reportText(run, bugs, prev), html: reportHtml(run, bugs, prev), stats: s }
}
export async function sendMessage(msg, run, cfg) {
  if (!cfg.ready) { const e = new Error(`Cannot send. Missing: ${cfg.missing.join(', ')}`); e.status = 400; throw e }
  const { default: nodemailer } = await import('nodemailer')
  const transport = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT),
    secure: process.env.SMTP_SECURE === 'true' || Number(process.env.SMTP_PORT) === 465, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } })
  const info = await transport.sendMail({ from: cfg.from, to: cfg.to, subject: msg.subject, text: msg.text, html: msg.html,
    attachments: [{ filename: `qa-report-${run.projectName.replace(/\W+/g, '_')}-${run.id}.html`, content: msg.html, contentType: 'text/html' }] })
  return { messageId: info.messageId, accepted: info.accepted }
}

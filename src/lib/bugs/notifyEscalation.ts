/**
 * The push half of the bug box: one email when the triage agent decides a
 * report is Wes's, not the board's.
 *
 * Wes 2026-09-18: "the agent can determine whether to escalate to Wes or to
 * fix it on its own." Escalation is deliberately narrow — blockers, real
 * money, signed documents, anything a client can see, and judgment calls
 * that are his. Everything else lands on /admin/bugs and waits, because a
 * channel that pushes every typo stops being read by the third week.
 *
 * Audience is the `bug-escalations` channel (defaults to Wes alone), so it
 * is re-pointable at /admin/notifications without a deploy — and silenceable
 * by saving an empty list there.
 *
 * Fire-and-forget: a mail failure must never fail the submission. The person
 * reporting a bug is doing us a favour; their box says "sent" either way,
 * and the report is on the board regardless.
 */
import type { BugReport } from '@prisma/client'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { channelRecipients } from '@/lib/email/notificationChannels'
import { renderEmailShell, renderEmailText, p, detailTable, calloutBox } from '@/lib/email/templates/shell'
import { KIND_LABEL, SEVERITY_LABEL } from '@/lib/bugs/vocab'

const HQ_APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://hq.sirreel.com').replace(/\/$/, '')
const TZ = 'America/Los_Angeles'

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export async function notifyBugEscalation(report: BugReport): Promise<{ sent: boolean; reason?: string }> {
  try {
    const to = await channelRecipients('bug-escalations')
    if (to.length === 0) return { sent: false, reason: 'channel silenced' }

    const boardUrl = `${HQ_APP_URL}/admin/bugs?id=${report.id}`
    const title = report.title || 'A problem in HQ'
    const subject =
      report.severity === 'BLOCKER'
        ? `Blocking: ${title}`
        : `Bug escalated: ${title}`

    const rows: Array<{ label: string; value: string }> = [
      { label: 'Reported by', value: `${report.reportedByName}${report.reportedByRole ? ` (${report.reportedByRole})` : ''}` },
      { label: 'Severity', value: SEVERITY_LABEL[report.severity] },
      { label: 'Kind', value: KIND_LABEL[report.kind] },
      { label: 'Area', value: report.area || 'not identified' },
      { label: 'From page', value: report.pagePath || 'not recorded' },
      {
        label: 'When',
        value: new Intl.DateTimeFormat('en-US', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' }).format(report.createdAt),
      },
    ]

    // Their words first, unedited and clearly marked as theirs. The agent's
    // read comes after — Wes should be able to disagree with the triage
    // without having to go and find what was actually said.
    const html = renderEmailShell({
      eyebrow: report.severity === 'BLOCKER' ? 'Blocking issue' : 'Escalated bug report',
      heading: title,
      preheader: `${report.reportedByName} · ${SEVERITY_LABEL[report.severity]} · ${report.area || 'HQ'}`,
      bodyHtml: [
        p(`<strong>${esc(report.reportedByName)}</strong> reported this from HQ Help. The triage agent sent it straight to you rather than the board.`),
        calloutBox(`<strong>In their words:</strong><br>${esc(report.body).replace(/\n/g, '<br>')}`),
        detailTable(rows),
        report.reasoning ? p(`<strong>Why it was escalated:</strong> ${esc(report.reasoning)}`) : '',
        report.response ? p(`<strong>What the agent thinks the fix is:</strong> ${esc(report.response)}`) : '',
        report.suspects.length
          ? p(`<strong>Where it might live:</strong> ${report.suspects.map((s) => `<code>${esc(s)}</code>`).join(', ')}`)
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
      cta: { label: 'Open it on the board', href: boardUrl },
      footNote:
        'You are getting this because the triage agent judged this report urgent. Everything it could handle itself stays on /admin/bugs. Change who receives these at /admin/notifications.',
    })

    const text = renderEmailText([
      `${report.reportedByName} reported this from HQ Help:`,
      '',
      report.body,
      '',
      ...rows.map((r) => `${r.label}: ${r.value}`),
      '',
      report.reasoning ? `Why escalated: ${report.reasoning}` : '',
      report.response ? `Likely fix: ${report.response}` : '',
      '',
      `Open it: ${boardUrl}`,
    ].filter(Boolean))

    const res = await sendAgreementEmail({
      to,
      subject,
      html,
      text,
      label: 'bug-escalation',
      // Replies go to the person who found it, not to a shared inbox —
      // the fastest fix for a vague report is one question back.
      replyTo: report.reportedByEmail,
      replyToExact: true,
    })
    return res.ok ? { sent: true } : { sent: false, reason: res.reason }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[bug-escalation] failed:', msg)
    return { sent: false, reason: msg }
  }
}

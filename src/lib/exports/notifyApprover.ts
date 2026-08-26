/**
 * Tell Wes an export is waiting on him.
 *
 * Two channels, deliberately:
 *   - An Alert row (the in-app action queue). expires_at is null — a pending
 *     request for the client book must not quietly age out of the queue.
 *   - An email, because a request can be time-sensitive and Wes is the only
 *     person who can clear it.
 *
 * FIRE AND FORGET — callers must NOT await. The request row is already
 * committed; a Resend outage must never fail the requester's submit, and a
 * failed notification degrades to "Wes sees it in the queue", not to a lost
 * request.
 */

import { prisma } from '@/lib/prisma'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { EXPORT_APPROVERS_DISPLAY } from '@/lib/exports/approverDisplay'

const HQ_APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://hq.sirreel.com').replace(/\/$/, '')

export interface ExportRequestNotice {
  requestId: string
  requesterName: string
  requesterEmail: string
  scopeLabel: string
  rowCount: number
  reason: string
}

export function notifyExportApprover(notice: ExportRequestNotice): void {
  void (async () => {
    const link = `${HQ_APP_URL}/exec/exports`
    const title = `${notice.requesterName} requested a client-list export`
    const body =
      `${notice.rowCount} client rows (${notice.scopeLabel}). ` +
      `Reason: ${notice.reason}`

    try {
      await prisma.alert.create({
        data: {
          type: 'data_export_request',
          title,
          body,
          severity: 'high',
          link,
          // expires_at intentionally null — must not auto-vanish.
        },
      })
    } catch (err) {
      console.error('[data-export] approval alert failed:', err)
    }

    try {
      await sendAgreementEmail({
        to: EXPORT_APPROVERS_DISPLAY,
        replyTo: notice.requesterEmail,
        subject: `Approval needed — client-list export (${notice.rowCount} rows)`,
        html:
          `<p><strong>${escapeHtml(notice.requesterName)}</strong> ` +
          `(${escapeHtml(notice.requesterEmail)}) requested a CSV export of the client list.</p>` +
          `<p><strong>Scope:</strong> ${escapeHtml(notice.scopeLabel)}<br/>` +
          `<strong>Rows:</strong> ${notice.rowCount}<br/>` +
          `<strong>Reason:</strong> ${escapeHtml(notice.reason)}</p>` +
          `<p>Nothing is downloadable until you approve it.</p>` +
          `<p><a href="${link}">Review the request</a></p>`,
        text:
          `${notice.requesterName} (${notice.requesterEmail}) requested a CSV export of the client list.\n\n` +
          `Scope: ${notice.scopeLabel}\nRows: ${notice.rowCount}\nReason: ${notice.reason}\n\n` +
          `Nothing is downloadable until you approve it.\n${link}\n`,
      })
    } catch (err) {
      console.error('[data-export] approval email failed:', err)
    }
  })()
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

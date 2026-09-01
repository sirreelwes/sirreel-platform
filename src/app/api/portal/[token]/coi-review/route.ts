import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { prisma } from '@/lib/prisma'
// One canonical review for every COI surface — see src/lib/coi/reviewCoi.ts.
// This route used to carry its own copy of the prompt; it was the FULLEST of
// the three copies, and the review desk's copy was the thinnest. Everything
// reads through the shared one now.
import { runCoiAiReview } from '@/lib/coi/reviewCoi'
import { coiCheckWriteFields, coiFlags } from '@/lib/coi/checks'
import { uploadCoiDocument } from '@/lib/coi/uploadCoiDocument'
import { channelRecipients, dedupeEmails } from '@/lib/email/notificationChannels'
import { evaluateInsuredMatch } from '@/lib/coi/insuredMatch'

const resend = new Resend(process.env.RESEND_API_KEY)

function buildEmailHtml(
  companyName: string,
  jobName: string,
  review: any,
  reviewUrl: string
): string {
  const criticalItems = [
    { label: 'Certificate Holder: SirReel', item: review.certificateHolder },
    { label: 'Named Insured matches company', item: review.insuredName },
    { label: 'General Liability ($1M/$2M)', item: review.generalLiability },
    { label: 'Auto Liability ($1M, Hired & Non-Owned)', item: review.autoLiability },
    { label: 'Hired Auto Physical Damage', item: review.autoPhysicalDamage },
    { label: 'Additional Insured: SirReel', item: review.additionalInsured },
    { label: 'Loss Payee: SirReel', item: review.lossPayee },
    { label: 'Coverage Dates', item: review.coverageDates },
    { label: 'Policy Not Expired', item: review.policyExpiry },
  ]

  const alertItems = [
    { label: 'Primary & Non-Contributory', item: review.primaryNonContributory },
    { label: 'Waiver of Subrogation', item: review.waiverOfSubrogation },
    { label: 'Umbrella/Excess Liability', item: review.umbrella },
    { label: 'Workers Compensation', item: review.workersComp },
    { label: '30-Day Cancellation Notice', item: review.cancellationNotice },
    { label: 'Independent Contractor Coverage', item: review.contractorCoverage },
  ]

  // Three states now, not two: a clean certificate used to email nobody
  // at all (Wes 2026-09-01), so "no news" meant either all-clear or a
  // send that silently failed — indistinguishable from an inbox.
  const statusColor = review.overallPass ? '#16a34a' : review.criticalPass ? '#f59e0b' : '#dc2626'
  const statusText = review.overallPass
    ? 'ALL CHECKS PASSED — NOTHING TO CHASE'
    : review.criticalPass
      ? 'ALERT ITEMS NEED REVIEW'
      : 'CRITICAL ISSUES — ACTION REQUIRED'

  const renderRow = (label: string, item: any, isCritical: boolean) => {
    if (!item) return ''
    const pass = item.pass ?? true
    if (pass) return ''
    const color = isCritical ? '#dc2626' : '#d97706'
    const badge = isCritical ? '🔴 CRITICAL' : '🟡 ALERT'
    return `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;">
          <span style="color:${color};font-weight:600;font-size:12px;">${badge}</span>
        </td>
        <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;color:#374151;">${label}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;font-size:12px;color:#6b7280;">${item.note || item.found || ''}</td>
      </tr>`
  }

  const issueRows = [
    ...criticalItems.map(i => renderRow(i.label, i.item, true)),
    ...alertItems.map(i => renderRow(i.label, i.item, false)),
  ].filter(Boolean).join('')

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;background:#f9fafb;margin:0;padding:20px;">
  <div style="max-width:600px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    
    <div style="background:#1a1a1a;padding:24px;text-align:center;">
      <div style="color:white;font-size:20px;font-weight:bold;">SirReel HQ</div>
      <div style="color:#bfd7ff;font-size:13px;margin-top:4px;">COI Review Notification</div>
    </div>

    <div style="background:${statusColor};padding:16px 24px;">
      <div style="color:white;font-weight:bold;font-size:15px;">${review.overallPass ? '✅' : '⚠️'} ${statusText}</div>
    </div>

    <div style="padding:24px;">
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
        <tr>
          <td style="padding:6px 0;color:#6b7280;font-size:13px;width:120px;">Company</td>
          <td style="padding:6px 0;font-weight:600;font-size:13px;">${companyName}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#6b7280;font-size:13px;">Job</td>
          <td style="padding:6px 0;font-weight:600;font-size:13px;">${jobName}</td>
        </tr>
      </table>

      <div style="font-size:13px;font-weight:600;color:#374151;margin-bottom:8px;">${review.overallPass ? 'Checks' : 'Issues Found:'}</div>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
        <thead>
          <tr style="background:#f9fafb;">
            <th style="padding:8px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;">Severity</th>
            <th style="padding:8px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;">Item</th>
            <th style="padding:8px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;">Note</th>
          </tr>
        </thead>
        <tbody>
          ${issueRows || `<tr><td colspan="3" style="padding:12px;text-align:center;color:#6b7280;font-size:13px;">${review.overallPass ? 'Every check passed — nothing to chase. Filed on the job; no action needed.' : 'No issues found'}</td></tr>`}
        </tbody>
      </table>

      <div style="margin-top:24px;text-align:center;">
        <a href="${reviewUrl}" style="display:inline-block;background:#1a1a1a;color:white;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">
          ${review.overallPass ? 'View COI in SirReel HQ' : 'Review COI in SirReel HQ'} &rarr;
        </a>
      </div>

      ${review.notes ? `<div style="margin-top:16px;padding:12px;background:#f9fafb;border-radius:8px;font-size:12px;color:#6b7280;"><strong>AI Notes:</strong> ${review.notes}</div>` : ''}
    </div>

    <div style="padding:16px 24px;background:#f9fafb;text-align:center;font-size:11px;color:#9ca3af;">
      SirReel Studio Services · 8500 Lankershim Blvd, Sun Valley, CA 91352 · (888) 477-7335
    </div>
  </div>
</body>
</html>`
}

export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  try {
    const request = await prisma.paperworkRequest.findUnique({
      where: { token: params.token },
      include: { booking: { include: { company: true, agent: true, job: { select: { id: true } } } } }
    })
    if (!request) return NextResponse.json({ error: 'Invalid token' }, { status: 404 })

    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 })

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    const companyName = request.booking?.company?.name || ''
    const jobName = request.booking?.jobName || ''

    const review: Record<string, any> = await runCoiAiReview(buffer, file.type)

    // Does the certificate insure the company we papered the booking under?
    // Computed here rather than asked of the model, so correcting a wrong
    // company name clears the flag without re-reading the PDF — the same
    // rule the review desk follows (src/lib/coi/insuredMatch.ts).
    const match = evaluateInsuredMatch(review.namedInsured ?? null, [companyName])
    review.insuredName = {
      pass: !match.needsAttention,
      found: match.namedInsured || '',
      note: match.needsAttention ? match.message : '',
    }

    // A Workers Comp certificate filed on this same paperwork request
    // satisfies the COI's WC check — WC commonly sits on a payroll
    // company's own paper. Same rule as the review desk, so the email and
    // the desk cannot disagree about whether anything is outstanding.
    const wcReview = (request.wcAiReview ?? null) as Record<string, unknown> | null
    const wcCtx =
      wcReview?.pass === true && wcReview?.expired !== true
        ? {
            workersCompCoveredElsewhere: true,
            workersCompNote: `Covered by ${request.wcOriginalFilename || 'a separate Workers Comp certificate'} filed on this job`,
          }
        : undefined

    const flags = coiFlags(review, wcCtx)
    if (wcCtx) {
      // Reflect it in the stored review too, so every later reader (the
      // job page, the review desk, this email's own checklist) sees the
      // same verdict rather than re-deriving it from the PDF alone.
      review.workersComp = {
        ...(review.workersComp ?? {}),
        pass: true,
        found: wcCtx.workersCompNote,
      }
    }
    review.criticalPass = flags.criticalPass && !match.needsAttention
    review.alertPass = flags.alertPass
    review.overallPass = review.criticalPass && review.alertPass
    review.riskLevel = !review.criticalPass ? 'high' : !review.alertPass ? 'medium' : 'low'

    // Legacy keys some older readers still look for.
    review.hardPass = review.criticalPass
    review.requiresAdminApproval = review.criticalPass && !review.alertPass

    // ── Keep the certificate ───────────────────────────────────────
    //
    // Wes, 2026-08-31: "the language on the jobs page is misleading. It
    // looks like they haven't uploaded a COI."
    //
    // It was not misleading — it was true, and that was the bug. This
    // route analysed the client's PDF, emailed the team about it, and
    // then threw the file away. No blob, no CoiCheck: the only trace was
    // the AI's verdict on a JSONB column nothing renders. So the job page
    // said "No certificate on file" about a certificate that had been
    // uploaded, read, and reported on.
    //
    // Storing it as a CoiCheck is also the whole fix for the link Wes
    // asked for: the job page already renders a Review button per COI,
    // and a stored row simply appears there.
    //
    // Best-effort: a blob or row failure must not lose the review the
    // client is waiting on, so it is logged and the response still
    // succeeds. The AI verdict below is written either way.
    let coiId: string | null = null
    try {
      const originalFilename = file.name || 'coi.pdf'
      const stored = await uploadCoiDocument({
        filename: originalFilename,
        contentType: file.type || 'application/pdf',
        data: buffer,
      })
      const created = await prisma.coiCheck.create({
        data: {
          fileKey: stored.blobKey,
          fileUrl: stored.fileUrl,
          originalFilename,
          fileSize: file.size,
          mimeType: file.type || 'application/pdf',
          jobId: request.booking?.job?.id ?? null,
          companyId: request.booking?.companyId ?? null,
          source: 'CLIENT_UPLOAD',
          ...coiCheckWriteFields(review as never),
        },
        select: { id: true },
      })
      coiId = created.id
    } catch (err) {
      console.error('[coi-review] failed to file the certificate:', err instanceof Error ? err.message : err)
    }

    // Save to DB
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE paperwork_requests ADD COLUMN IF NOT EXISTS coi_ai_review JSONB`)
      await prisma.$executeRawUnsafe(`ALTER TABLE paperwork_requests ADD COLUMN IF NOT EXISTS coi_review_at TIMESTAMP`)
    } catch {}

    await prisma.$executeRawUnsafe(
      `UPDATE paperwork_requests SET coi_ai_review=$1::jsonb, coi_review_at=$2, coi_received=$3 WHERE token=$4`,
      JSON.stringify(review), new Date(), review.criticalPass, params.token
    )

    // Received = every CRITICAL requirement is met. An open ALERT item (no
    // umbrella, no 30-day notice) is a judgment call for the team, and it
    // still emails them below — it does not hold the certificate hostage.
    if (review.criticalPass) {
      await prisma.booking.update({ where: { id: request.bookingId }, data: { coiReceived: true } })
    }

    // Email the team on EVERY reviewed certificate — including a clean
    // one (Wes 2026-09-01: "add an all-clear notification for clean COIs
    // too"). Silence used to mean two different things, all-clear and a
    // send that failed, and an inbox cannot tell them apart.
    if (process.env.RESEND_API_KEY) {
      // Subject splits on criticalPass: red = we cannot accept this,
      // yellow = acceptable but someone should look.
      // Was `/jobs/${request.bookingId}` — a BOOKING id in a JOB url, so
      // every one of these emails linked to a 404. Points at the job's
      // COI section now, and falls back to the review desk when the
      // booking has no job attached.
      const jobId = request.booking?.job?.id ?? null
      const reviewUrl = jobId
        ? `https://hq.sirreel.com/jobs/${jobId}#coi`
        : 'https://hq.sirreel.com/paperwork'
      const html = buildEmailHtml(companyName, jobName, review, reviewUrl)
      const subject = review.overallPass
        ? `🟢 COI Clear — ${companyName} · ${jobName}`
        : review.criticalPass
          ? `🟡 COI Alert — ${companyName} · ${jobName}`
          : `🔴 COI Critical Issues — ${companyName} · ${jobName}`

      // The audience is a DB-backed channel, not a hardcoded list — this
      // one still named four individuals while a 'coi-team' channel
      // existed and was editable at /admin/notifications, so changing who
      // gets COI alerts silently did nothing here.
      //
      // BOTH channels, matching the drop link (/api/coi/[token]). They
      // had drifted apart: a certificate arriving through the client
      // PORTAL emailed coi-team only, while the same certificate through
      // the drop LINK emailed coi-team + hq-documents. So whether HQ
      // heard about a COI depended on which door the client happened to
      // walk through — Neko Studio's Unscripted certificate (2026-09-01)
      // reached rentals@ and oliver@ and nobody on hq@.
      const to = dedupeEmails([
        ...(await channelRecipients('coi-team')),
        ...(await channelRecipients('hq-documents')),
      ])
      if (to.length > 0) {
        await resend.emails.send({
          from: 'SirReel HQ <notifications@sirreel.com>',
          to,
          subject,
          html,
        })
      }
    }

    return NextResponse.json({ ok: true, review, coiId })
  } catch (err: any) {
    console.error('[coi-review]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

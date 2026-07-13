import { NextRequest, NextResponse } from 'next/server'
import { put } from '@vercel/blob'
import { prisma } from '@/lib/prisma'
import { renderStrykerPlainText } from '@/lib/contracts/strykerAgreement'
import { renderStageSignedCopyPdf } from '@/lib/contracts/renderStageSignedCopy'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { internalCopyRecipients } from '@/lib/email/copyRecipients'
import { portalBaseUrl } from '@/lib/portal/portalUrl'
import {
  stageAreaContractLabel,
  STRYKER_TRIGGER_KEY,
  includedComplexAreaLabels,
  stageTermsReady,
  ledWallSelected,
  LED_WALL_TECH_LABELS,
  type LedWallTech,
} from '@/lib/contracts/stageAreas'

export const dynamic = 'force-dynamic'

/**
 * Portal v2 studio-contract signing.
 *
 * Additive replacement for the legacy `step: 'studio'` branch of
 * POST /api/portal/[token]/sign (which stays untouched), adding the two
 * things v2 requires:
 *
 *  1. Server-side GATE: the contract is only signable after a SirReel
 *     agent has prepared the negotiated stage terms — at minimum the
 *     areas (sets) and the day rate — in PaperworkRequest.stageDetails.
 *  2. Stryker Master Media Use Agreement: when the hospital set is among
 *     the areas, the FULL agreement (rendered from the single-source
 *     template in @/lib/contracts/strykerAgreement) must be separately
 *     acknowledged AND separately signed. The Stryker signature, printed
 *     name, timestamp, and an exact populated-text snapshot are persisted
 *     alongside the studio-contract signature.
 *
 * The signoff (signer, signatures, Stryker block, and a snapshot of the
 * terms as signed) is merged into the stageDetails JSON under `signoff`
 * — extra keys there are ignored by every other reader of the column.
 * Completion flags mirror the legacy studio step exactly.
 */
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const request = await prisma.paperworkRequest.findUnique({
      where: { token: params.token },
      include: { booking: { include: { company: true, agent: true } } },
    })
    if (!request) return NextResponse.json({ error: 'Invalid token' }, { status: 404 })

    let sd: any = null
    try {
      sd = request.stageDetails ? JSON.parse(request.stageDetails) : null
    } catch {
      sd = null
    }

    const sets: string[] = Array.isArray(sd?.sets) ? sd.sets : []
    if (!stageTermsReady(sd)) {
      return NextResponse.json(
        { error: 'Stage terms are not finalized yet. Your SirReel agent must set the rate and areas before this contract can be signed.' },
        { status: 409 },
      )
    }

    const body = await req.json().catch(() => ({}))
    if (!body.studioAgreed) {
      return NextResponse.json({ error: 'Terms must be accepted' }, { status: 400 })
    }
    const requiresStryker = sets.includes(STRYKER_TRIGGER_KEY)
    const strykerSignature = typeof body.strykerSignatureData === 'string' ? body.strykerSignatureData : ''
    if (requiresStryker && (!body.strykerAcknowledged || !strykerSignature.trim())) {
      return NextResponse.json(
        { error: 'The Stryker Master Media Use Agreement must be acknowledged and separately signed for hospital-set bookings' },
        { status: 400 },
      )
    }

    const now = new Date()
    const ip = req.headers.get('x-forwarded-for') || 'unknown'

    // Rebuild the populated Stryker text server-side so the persisted
    // snapshot is exactly what the template renders for this job — the
    // client never supplies contract text.
    const fmtLong = (d: Date) => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    // endDate is a date-only column (UTC midnight) — format in UTC so the
    // return date never rolls back a day on servers in other timezones.
    const fmtLongUTC = (d: Date) =>
      d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    const strykerFields = requiresStryker
      ? {
          producerName: request.booking?.company?.name || 'Producer',
          producerAddress: request.booking?.company?.billingAddress || '',
          projectTitle: request.booking?.jobName || '',
          agreementDate: fmtLong(now),
          returnDate: request.booking?.endDate ? fmtLongUTC(new Date(request.booking.endDate)) : '',
        }
      : null

    const signoff = {
      signerName: typeof body.signerName === 'string' ? body.signerName.slice(0, 200) : '',
      strykerRequired: requiresStryker,
      signatureData: typeof body.signatureData === 'string' ? body.signatureData : '',
      signedAt: now.toISOString(),
      ip,
      stryker: strykerFields
        ? {
            acknowledged: !!body.strykerAcknowledged,
            printedName: typeof body.strykerPrintedName === 'string' ? body.strykerPrintedName.slice(0, 200) : '',
            signatureData: strykerSignature,
            signedAt: now.toISOString(),
            fields: strykerFields,
            textSnapshot: renderStrykerPlainText(strykerFields),
          }
        : null,
      termsSnapshot: {
        sets,
        // Labels frozen at signing time — if the area list is ever
        // relabeled later, the signed record (and its PDF) keeps
        // showing exactly what the client saw when they signed.
        setLabels: Object.fromEntries(sets.map((k) => [k, stageAreaContractLabel(k, sd)])),
        // Included complex amenities frozen at signing — the signed PDF
        // renders these, never the live standing list.
        complexAreasIncluded: includedComplexAreaLabels(sd?.complexAreas),
        // LED Wall add-on + required technician fork, frozen at signing.
        ledWall: ledWallSelected(sd)
          ? { on: true, tech: sd.ledWallTech, techLabel: LED_WALL_TECH_LABELS[sd.ledWallTech as LedWallTech] || '' }
          : null,
        prelitSets: sd?.prelitSets || [],
        // Scheduled calendar dates per day type (picked slots only),
        // frozen at signing like every other term.
        dayDates: Object.fromEntries(
          ['prep', 'shoot', 'strike', 'dark'].map((k) => [k, (sd?.dayDates?.[k] || []).filter(Boolean)]),
        ),
        ratePerDay: sd?.ratePerDay,
        otRate: sd?.otRate || '300',
        prepDays: sd?.prepDays || '',
        shootDays: sd?.shootDays || '',
        strikeDays: sd?.strikeDays || '',
        darkDays: sd?.darkDays || '',
        notes: sd?.notes || '',
      },
    }

    await prisma.$executeRawUnsafe(
      `UPDATE paperwork_requests SET
         stage_details=$1,
         studio_contract_signed=true,
         rental_agreement=true,
         completed_at=$2
       WHERE token=$3`,
      JSON.stringify({ ...sd, signoff }),
      now,
      params.token,
    )

    // ── Post-signing distribution (STRICTLY best-effort) ──────────────
    // The signing above is already committed; everything below logs and
    // continues on failure — it must never block, corrupt, or roll back
    // the client's completed signing. Renders the signed PDF ONCE via
    // the same shared renderer the download endpoint uses, then:
    //   1. uploads it to private Blob (durable artifact) and stamps
    //      signoff.signedPdfUrl,
    //   2. emails it to the internal roster + the job's agent.
    try {
      const pdfBuffer = await renderStageSignedCopyPdf(request, signoff)

      // 1. Durable Blob artifact — same private-blob pattern as the
      //    rental flow's signed-agreements/ store.
      let signedPdfUrl: string | null = null
      try {
        const uploaded = await put(`signed-stage-contracts/${params.token}/${now.getTime()}.pdf`, pdfBuffer, {
          access: 'private',
          contentType: 'application/pdf',
        })
        signedPdfUrl = uploaded.url
        await prisma.$executeRawUnsafe(
          `UPDATE paperwork_requests SET stage_details=$1 WHERE token=$2`,
          JSON.stringify({ ...sd, signoff: { ...signoff, signedPdfUrl } }),
          params.token,
        )
      } catch (err) {
        console.error('[portal/v2/stage-sign] blob upload failed (signing unaffected):', err)
      }

      // 2. Internal staff copy — sales + billing roster + the job's
      //    assigned agent. NOT sent to the client (their copy lives in
      //    the portal's Download button).
      try {
        const jobName = request.booking?.jobName || '—'
        const companyName = request.booking?.company?.name || '—'
        const agentEmail = request.booking?.agent?.email || null
        const setLabels: string[] = Object.values(signoff.termsSnapshot.setLabels || {})
        const strykerLine = requiresStryker ? 'Yes — signed separately' : 'No'
        const pdfLink = `${portalBaseUrl()}/api/portal/v2/${params.token}/stage-contract-pdf`
        const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        const html = `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#f3f4f6;font-family:Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
    <div style="background:#111827;padding:18px 20px;">
      <div style="color:white;font-size:18px;font-weight:bold;">SirReel HQ</div>
      <div style="color:#bfd7ff;font-size:12px;margin-top:4px;">Signed Stage Contract</div>
    </div>
    <div style="padding:20px;color:#374151;font-size:14px;line-height:1.5;">
      <p>The <strong>Stage Contract</strong> for <strong>${esc(companyName)}</strong> has been signed.</p>
      <table style="width:100%;border-collapse:collapse;margin:12px 0;">
        <tr><td style="padding:4px 0;color:#6b7280;width:140px;">Job</td><td style="padding:4px 0;font-weight:600;">${esc(jobName)}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;">Company</td><td style="padding:4px 0;font-weight:600;">${esc(companyName)}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;">Stages / areas</td><td style="padding:4px 0;font-weight:600;">${esc(setLabels.join(', ') || '—')}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;">Rate</td><td style="padding:4px 0;font-weight:600;">$${esc(String(signoff.termsSnapshot.ratePerDay || '—'))}/day</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;">Stryker MMA</td><td style="padding:4px 0;font-weight:600;">${strykerLine}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;">Signer</td><td style="padding:4px 0;font-weight:600;">${esc(signoff.signerName || '—')}</td></tr>
      </table>
      <p style="font-size:13px;color:#6b7280;">The signed PDF is attached. It's also always available at
        <a href="${pdfLink}" style="color:#2563eb;">the signed-copy link</a> and in HQ → Paperwork → Stage Contract Terms.</p>
    </div>
    <div style="padding:14px 20px;background:#f9fafb;text-align:center;font-size:11px;color:#9ca3af;">
      SirReel Studio Services &middot; (888) 477-7335
    </div>
  </div>
</body></html>`
        const result = await sendAgreementEmail({
          label: 'portal/v2/stage-sign internal copy',
          to: internalCopyRecipients(),
          cc: agentEmail ? [agentEmail] : undefined,
          subject: `Signed: ${companyName} · Stage Contract${requiresStryker ? ' + Stryker MMA' : ''}`,
          html,
          text: `The Stage Contract for ${companyName} (${jobName}) has been signed by ${signoff.signerName || '—'}. Stryker MMA: ${strykerLine}. Signed PDF: ${pdfLink}`,
          attachments: [
            {
              filename: `sirreel-stage-contract-${(jobName || 'signed').replace(/[^a-zA-Z0-9-_ ]/g, '').slice(0, 60)}.pdf`,
              content: pdfBuffer,
            },
          ],
        })
        if (!result.ok) console.error('[portal/v2/stage-sign] internal email failed (signing unaffected):', result.reason)
      } catch (err) {
        console.error('[portal/v2/stage-sign] internal email threw (signing unaffected):', err)
      }
    } catch (err) {
      console.error('[portal/v2/stage-sign] post-sign PDF render failed (signing unaffected):', err)
    }

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error('[portal/v2/stage-sign]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

/**
 * /api/sub-rentals/vehicles/[id]/estimate
 *
 *   GET  → compose the estimate WITHOUT sending. Backs the preview modal so
 *          the rep reads exactly what the client will get.
 *   POST → compose again from the same composer, then send.
 *
 * Composing twice (rather than trusting HTML posted back from the browser)
 * means the client can never be mailed markup the client-side handed us —
 * the only thing POST takes from the browser is the recipient, the greeting
 * name, and the rep's own message.
 *
 * Auth: requireSubVehicleAccess. Reading the rate card and quoting from it
 * are the same privilege.
 *
 * replyTo is the SENDING REP, never notifications@ — a client answering an
 * estimate is answering a person, and every client-facing send in this app
 * sets it (see the 2026-08-28 replyTo audit).
 *
 * rentals@ is CC'd on every estimate (Wes 2026-08-28), through the same
 * withTeamCc helper Quick Reply uses rather than a second hardcoded address:
 * a sub-rental quote commits a partner's unit, so the desk needs to see it
 * went out — otherwise two people quote the same coach. CC and Reply-To
 * deliberately differ: rentals@ is a Google Group, which is why it's right
 * for CC and wrong for Reply-To (groups bounce non-member mail). Unsetting
 * TEAM_INBOX_EMAIL retires the CC everywhere at once, no deploy.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireSubVehicleAccess } from '@/lib/sub-rentals/auth'
import { composeEstimateEmail } from '@/lib/sub-rentals/estimateEmail'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { withTeamCc, agentReplyTo } from '@/lib/email/teamVisibility'
import { createPotentialSubRental, vendorPagePath } from '@/lib/sub-rentals/potentialSubRental'
import { buildVendorEstimateNotice } from '@/lib/sub-rentals/vendorNotice'
import { PUBLIC_SITE_ORIGIN } from '@/lib/site/publicUrl'

export const dynamic = 'force-dynamic'

type Params = { params: { id: string } }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function GET(req: NextRequest, { params }: Params) {
  const gate = await requireSubVehicleAccess()
  if (gate instanceof NextResponse) return gate
  const { user } = gate

  const url = new URL(req.url)
  const composed = await composeEstimateEmail({
    vehicleId: params.id,
    message: url.searchParams.get('message'),
    clientFirstName: url.searchParams.get('firstName'),
    agentName: user.name ?? 'SirReel',
  })
  if (!composed.ok) {
    return NextResponse.json({ error: composed.error }, { status: composed.status })
  }
  return NextResponse.json({
    subject: composed.subject,
    html: composed.html,
    text: composed.text,
    defaultBody: composed.defaultBody,
    unitUrl: composed.unitUrl,
    vehicle: composed.vehicle,
    replyTo: agentReplyTo(user.email),
    // Display-only: the channel-resolved copy list, joined for the modal's
    // "CC ..." line. May be several individual addresses under an admin
    // override rather than the one group.
    teamCc: (await withTeamCc([])).join(', ') || null,
  })
}

export async function POST(req: NextRequest, { params }: Params) {
  const gate = await requireSubVehicleAccess()
  if (gate instanceof NextResponse) return gate
  const { user } = gate

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const to = typeof body.to === 'string' ? body.to.trim() : ''
  const jobId = typeof body.jobId === 'string' && body.jobId ? body.jobId : null
  const startDate = typeof body.startDate === 'string' && body.startDate ? body.startDate : null
  const endDate = typeof body.endDate === 'string' && body.endDate ? body.endDate : null
  if (!EMAIL_RE.test(to)) {
    return NextResponse.json({ error: 'A valid recipient email is required.' }, { status: 400 })
  }

  const composed = await composeEstimateEmail({
    vehicleId: params.id,
    message: typeof body.message === 'string' ? body.message : null,
    clientFirstName: typeof body.firstName === 'string' ? body.firstName : null,
    agentName: user.name ?? 'SirReel',
  })
  if (!composed.ok) {
    return NextResponse.json({ error: composed.error }, { status: composed.status })
  }

  const teamCc = await withTeamCc([], to)
  const result = await sendAgreementEmail({
    to: [to],
    cc: teamCc,
    // agentReplyTo, not user.email raw — it restricts to our own domain so a
    // session with an odd address can't redirect a client's reply off-domain.
    replyTo: agentReplyTo(user.email) ?? undefined,
    subject: composed.subject,
    html: composed.html,
    text: composed.text,
    label: 'sub-rental-estimate',
  })
  if (!result.ok) {
    return NextResponse.json({ error: `Send failed: ${result.reason}` }, { status: 502 })
  }

  await prisma.auditLog.create({
    data: {
      action: 'sub_vehicle.estimate_sent',
      entityType: 'SubcontractedVehicle',
      entityId: params.id,
      userId: user.id,
      newValues: { to, cc: teamCc, vehicleName: composed.vehicle.name, resendMessageId: result.id },
    },
  })

  // ── The partner's side ───────────────────────────────────────────────────
  // Quoting someone's unit creates a "potential" sub-rental on the job and
  // tells the owner their dates have been pitched. Deliberately AFTER the
  // client send and non-fatal: the estimate has already left, so a failure
  // here must be reported, not swallowed and not allowed to look like the
  // whole send failed.
  let vendorNotice: { created: boolean; notified: boolean; warning?: string } = {
    created: false,
    notified: false,
  }
  if (jobId && startDate && endDate) {
    const potential = await createPotentialSubRental({
      vehicleId: params.id,
      jobId,
      startDate,
      endDate,
      createdByUserId: user.id,
    })
    if ('error' in potential) {
      vendorNotice.warning = `Estimate sent, but the sub-rental record failed: ${potential.error}`
    } else {
      vendorNotice.created = true
      const job = await prisma.job.findUnique({ where: { id: jobId }, select: { jobCode: true } })
      if (potential.vendorEmail) {
        const notice = buildVendorEstimateNotice({
          vendorName: potential.vendorName,
          vehicleName: potential.vehicleName,
          startDate,
          endDate,
          reference: job?.jobCode ?? null,
          vendorUrl: `${PUBLIC_SITE_ORIGIN}${vendorPagePath(potential.vendorToken)}`,
          agentName: user.name ?? 'SirReel',
        })
        const vres = await sendAgreementEmail({
          to: [potential.vendorEmail],
          replyTo: agentReplyTo(user.email) ?? undefined,
          subject: notice.subject,
          html: notice.html,
          text: notice.text,
          label: 'sub-rental-vendor-notice',
        })
        if (vres.ok) {
          vendorNotice.notified = true
          await prisma.subRental.update({
            where: { id: potential.subRentalId },
            data: { vendorNotifiedAt: new Date() },
          })
        } else {
          vendorNotice.warning = `Estimate sent and the sub-rental was created, but ${potential.vendorName} could not be notified: ${vres.reason}`
        }
      } else {
        vendorNotice.warning = `Estimate sent and the sub-rental was created, but ${potential.vendorName} has no email on file, so they were not notified.`
      }
    }
  }

  return NextResponse.json({ ok: true, id: result.id, ...vendorNotice })
}

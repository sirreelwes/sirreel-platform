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
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireSubVehicleAccess } from '@/lib/sub-rentals/auth'
import { composeEstimateEmail } from '@/lib/sub-rentals/estimateEmail'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'

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
    replyTo: user.email,
  })
}

export async function POST(req: NextRequest, { params }: Params) {
  const gate = await requireSubVehicleAccess()
  if (gate instanceof NextResponse) return gate
  const { user } = gate

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const to = typeof body.to === 'string' ? body.to.trim() : ''
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

  const result = await sendAgreementEmail({
    to: [to],
    replyTo: user.email,
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
      newValues: { to, vehicleName: composed.vehicle.name, resendMessageId: result.id },
    },
  })

  return NextResponse.json({ ok: true, id: result.id })
}

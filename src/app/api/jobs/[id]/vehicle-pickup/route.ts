/**
 * /api/jobs/[id]/vehicle-pickup — the staff side of the after-hours
 * VEHICLE pickup email (Wes 2026-09-10: "an easy button for sales to send
 * this summary to clients on the job detail page").
 *
 *   GET  → the job's live units with plate + lock box code, the contacts
 *          the email could go to, whether the gate code is on file, and
 *          the last send. Read before sending.
 *   POST → { personId?, extraEmails?, assetIds?, note? } — sends it.
 *
 * GET returns lock box codes and the gate code to STAFF. Same codes the
 * fleet page and /admin/assistant already show; a staff session is
 * required like every other job route.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { afterHoursPayload } from '@/lib/afterHours/instructions'
import { pickPrimaryContact } from '@/lib/jobs/primaryContact'
import {
  jobPickupVehicles,
  lastVehiclePickupSend,
  sendVehiclePickupInstructions,
  MAX_EXTRA_RECIPIENTS,
} from '@/lib/afterHours/vehiclePickup'

export const dynamic = 'force-dynamic'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  const userId = (session?.user as { id?: string } | undefined)?.id || null
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const job = await prisma.job.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      jobContacts: {
        select: {
          role: true,
          isPrimary: true,
          person: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      },
    },
  })
  if (!job) return NextResponse.json({ error: 'job not found' }, { status: 404 })

  const [payload, vehicles, last] = await Promise.all([
    afterHoursPayload(),
    jobPickupVehicles(job.id),
    lastVehiclePickupSend(job.id),
  ])
  const mailable = job.jobContacts.filter((c) => EMAIL_RE.test(c.person.email || ''))
  const primary = pickPrimaryContact(mailable)
  const contactRow = (c: (typeof mailable)[number]) => ({
    personId: c.person.id,
    name: [c.person.firstName, c.person.lastName]
      .filter((s) => s && s !== '—')
      .join(' ')
      .trim(),
    email: c.person.email,
    role: c.role,
  })

  return NextResponse.json({
    gateCode: payload.gateCode,
    lockboxInstructionsUrl: payload.lockboxInstructionsUrl,
    vehicles,
    recipient: primary ? contactRow(primary) : null,
    contacts: mailable.map(contactRow),
    last,
    maxExtraRecipients: MAX_EXTRA_RECIPIENTS,
  })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  const userId = (session?.user as { id?: string } | undefined)?.id || null
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    personId?: unknown
    extraEmails?: unknown
    assetIds?: unknown
    note?: unknown
  }
  const strs = (x: unknown) =>
    Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : []

  const result = await sendVehiclePickupInstructions({
    jobId: params.id,
    userId,
    personId: typeof body.personId === 'string' && body.personId ? body.personId : null,
    extraEmails: strs(body.extraEmails).slice(0, MAX_EXTRA_RECIPIENTS),
    assetIds: strs(body.assetIds),
    note: typeof body.note === 'string' ? body.note.slice(0, 2000) : null,
  })
  if (!result.ok) {
    const status =
      result.reason === 'job_not_found' ? 404 : result.reason === 'send_failed' ? 502 : 409
    return NextResponse.json({ error: result.message }, { status })
  }
  return NextResponse.json({ ok: true, sentTo: result.sentTo, vehicles: result.vehicles })
}

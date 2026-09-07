/**
 * /api/jobs/[id]/sms — the staff Text button on the job page.
 *
 *   GET  ?phone=   → consent state for that number + the last few texts
 *                    exchanged with it on this job, so the agent sees what
 *                    was already said.
 *   POST { phone, body, subRentalId? } → send as the signed-in agent via
 *                    sendTracked (logged on the job with the Twilio id,
 *                    opted-out numbers refused, quiet hours overridden
 *                    because a human chose to send now).
 *
 * Wes 2026-09-07: texts are for "non-normal situations — last-minute
 * changes", so this is a plain composer with no templates. The STOP line is
 * appended server-side. Any signed-in staff session may send; the row
 * records who.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { toE164 } from '@/lib/sms/sendSms'
import { consentState, sendTracked } from '@/lib/sms/threads'

export const dynamic = 'force-dynamic'

type Params = { params: { id: string } }

async function staff() {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email ?? null
  if (!email) return null
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, name: true } })
  return user ? { id: user.id, name: user.name ?? email } : null
}

export async function GET(req: NextRequest, { params }: Params) {
  const me = await staff()
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const phoneRaw = req.nextUrl.searchParams.get('phone') || ''
  const phone = toE164(phoneRaw)
  const consent = await consentState(phoneRaw)
  const recent = phone
    ? await prisma.smsMessage.findMany({
        where: { thread: { phone }, jobId: params.id },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { direction: true, body: true, status: true, createdAt: true, source: true },
      })
    : []
  return NextResponse.json({ ok: true, consent, recent: recent.reverse() })
}

export async function POST(req: NextRequest, { params }: Params) {
  const me = await staff()
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const job = await prisma.job.findUnique({ where: { id: params.id }, select: { id: true } })
  if (!job) return NextResponse.json({ error: 'job not found' }, { status: 404 })

  const body = (await req.json().catch(() => null)) as { phone?: unknown; body?: unknown; subRentalId?: unknown } | null
  const phone = typeof body?.phone === 'string' ? toE164(body.phone) : null
  const text = typeof body?.body === 'string' ? body.body.trim().slice(0, 480) : ''
  const subRentalId = typeof body?.subRentalId === 'string' && body.subRentalId ? body.subRentalId : null
  if (!phone) return NextResponse.json({ ok: false, error: 'That number can’t receive texts.' }, { status: 400 })
  if (!text) return NextResponse.json({ ok: false, error: 'Write the message first.' }, { status: 400 })

  const r = await sendTracked({ to: phone, body: text, source: 'staff', jobId: job.id, subRentalId, sentById: me.id, overrideQuietHours: true })
  await prisma.auditLog.create({
    data: { action: 'sms.staff_send', entityType: 'Job', entityId: job.id, userId: me.id, newValues: { phoneTail: phone.slice(-4), status: r.status, subRentalId } },
  }).catch(() => {})

  if (!r.ok) {
    const why =
      r.status === 'skipped-opted-out' ? 'This number replied STOP — texting is off for it. Call them instead.'
      : r.status === 'skipped-unconfigured' ? 'Texting isn’t configured on this server yet.'
      : r.error || 'Not sent.'
    return NextResponse.json({ ok: false, status: r.status, error: why }, { status: 409 })
  }
  return NextResponse.json({ ok: true, status: r.status })
}

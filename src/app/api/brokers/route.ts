import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth-admin'
import { listBrokers, normalizeBrokerFacts, mergeBrokerFacts } from '@/lib/coi/brokerDirectory'

export const dynamic = 'force-dynamic'

/**
 * /api/brokers — the broker directory (Wes 2026-09-17: "Please start keeping
 * a list of brokers").
 *
 * GET    — the list, optionally filtered by ?q=
 * POST   — add one by hand
 * PATCH  — edit one, or set it inactive
 *
 * Staff-gated, not ADMIN-only: the people who chase certificates are sales
 * and billing, and this is the list they chase them with. A broker is a
 * business contact, not a credential — nothing here reads a certificate, a
 * job or a rate.
 *
 * Every write goes through the same normalizer and merge rule the automatic
 * recording uses (brokerDirectory.ts), so a typed row and an extracted one
 * cannot end up shaped differently. A hand edit is `MANUAL`, which is the
 * one source allowed to REPLACE a field rather than only fill a blank.
 */

const missingTablesResponse = () =>
  NextResponse.json(
    {
      error:
        'The broker directory tables are not in the database yet. Run "Create the broker directory tables" on /admin/maintenance.',
      missingTables: true,
    },
    { status: 503 },
  )

function isMissingTable(err: unknown): boolean {
  const code = (err as { code?: string })?.code
  return code === 'P2021' || code === 'P2022'
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const q = req.nextUrl.searchParams.get('q')
  const includeInactive = req.nextUrl.searchParams.get('all') === '1'
  const { brokers, missingTables } = await listBrokers({ q, includeInactive })
  return NextResponse.json({ ok: true, brokers, missingTables })
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const facts = normalizeBrokerFacts({
    email: typeof body.email === 'string' ? body.email : '',
    name: typeof body.name === 'string' ? body.name : null,
    agency: typeof body.agency === 'string' ? body.agency : null,
    phone: typeof body.phone === 'string' ? body.phone : null,
    address: typeof body.address === 'string' ? body.address : null,
  })
  if (!facts) {
    return NextResponse.json({ error: 'A valid email address is required — it is how a broker is identified.' }, { status: 400 })
  }
  const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 2000) || null : null

  try {
    const existing = await prisma.broker.findUnique({
      where: { email: facts.email },
      select: { id: true, name: true, agency: true, phone: true, address: true },
    })
    if (existing) {
      // The email is the identity, so "add" on one we hold is an edit —
      // better than a duplicate row or a dead-end error.
      const broker = await prisma.broker.update({
        where: { id: existing.id },
        data: {
          ...mergeBrokerFacts(existing, facts, 'MANUAL'),
          ...(notes ? { notes } : {}),
          isActive: true,
        },
        select: { id: true, email: true },
      })
      return NextResponse.json({ ok: true, broker, merged: true })
    }
    const broker = await prisma.broker.create({
      data: { ...facts, notes, createdByUserId: user.id },
      select: { id: true, email: true },
    })
    return NextResponse.json({ ok: true, broker, merged: false })
  } catch (err) {
    if (isMissingTable(err)) return missingTablesResponse()
    console.error('[api/brokers] create failed:', err)
    return NextResponse.json({ error: 'Could not save that broker.' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const id = typeof body.id === 'string' ? body.id : ''
  if (!id) return NextResponse.json({ error: 'Which broker?' }, { status: 400 })

  const str = (v: unknown, max: number) =>
    typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) || null : undefined

  try {
    const existing = await prisma.broker.findUnique({
      where: { id },
      select: { id: true, name: true, agency: true, phone: true, address: true },
    })
    if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 })

    const data: Record<string, unknown> = {}
    // A hand edit may CLEAR a field (null) as well as set it — that is the
    // point of a person opening the row. Automatic recording never can.
    for (const [key, max] of [['name', 200], ['agency', 200], ['phone', 40], ['address', 300], ['notes', 2000]] as const) {
      const v = str(body[key], max)
      if (v !== undefined) data[key] = v
    }
    if (typeof body.isActive === 'boolean') data.isActive = body.isActive
    if (!Object.keys(data).length) return NextResponse.json({ error: 'Nothing to change.' }, { status: 400 })

    const broker = await prisma.broker.update({ where: { id }, data, select: { id: true, email: true } })
    return NextResponse.json({ ok: true, broker })
  } catch (err) {
    if (isMissingTable(err)) return missingTablesResponse()
    console.error('[api/brokers] update failed:', err)
    return NextResponse.json({ error: 'Could not save that change.' }, { status: 500 })
  }
}

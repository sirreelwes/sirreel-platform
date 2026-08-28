/**
 * POST /api/crm/outreach/bulk — log one outreach touch against many
 * contacts at once.
 *
 * The after-a-mixer workflow. A rep comes back from an event having met
 * fifteen people and, until now, had to open the quick-log sheet fifteen
 * times. Same OutreachActivity rows the single-contact path writes, so
 * every one still lands on its contact's timeline and still counts
 * toward the FOLLOW-UPS DUE card.
 *
 * This is deliberately the FIRST bulk action on the CRM. It writes only
 * to our own activity log — nothing leaves the building, nobody gets
 * emailed. The send path (Phase 3) does not exist yet and must not be
 * reachable before the consent spine (Phase 2) ships.
 *
 * Contract:
 *   - createMany in one statement, so 200 contacts is one round trip
 *     rather than 200.
 *   - Ids are FILTERED against the database first. A stale selection —
 *     a contact merged or deleted while the bar sat open — would
 *     otherwise fail the whole insert on a foreign key and lose the
 *     rep's notes. Missing ids are reported, not fatal.
 *   - Capped at MAX_TARGETS. A rep did not personally meet 600 people;
 *     a request that large is a select-all misfire, and logging it would
 *     put a fake touch on every one of their timelines.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { OutreachType } from '@prisma/client'
import { BULK_OUTREACH_MAX_TARGETS } from '@/lib/crm/bulkOutreach'

export const dynamic = 'force-dynamic'

const TYPE_VALUES = new Set<string>(Object.values(OutreachType))
// Imported, not declared: a route file may only export handlers and
// Next's own config keys. See src/lib/crm/bulkOutreach.ts.
const MAX_TARGETS = BULK_OUTREACH_MAX_TARGETS

export async function POST(req: NextRequest) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as {
    type?: string
    personIds?: unknown
    notes?: string
    occurredAt?: string
    followUpAt?: string | null
  } | null
  if (!body) return NextResponse.json({ error: 'invalid body' }, { status: 400 })

  if (!body.type || !TYPE_VALUES.has(body.type)) {
    return NextResponse.json({ error: 'invalid or missing type' }, { status: 400 })
  }
  if (!body.notes || !body.notes.trim()) {
    return NextResponse.json({ error: 'notes required' }, { status: 400 })
  }

  const requestedIds = Array.isArray(body.personIds)
    ? Array.from(new Set(body.personIds.filter((v): v is string => typeof v === 'string' && !!v)))
    : []
  if (requestedIds.length === 0) {
    return NextResponse.json({ error: 'no contacts selected' }, { status: 400 })
  }
  if (requestedIds.length > MAX_TARGETS) {
    return NextResponse.json(
      {
        error: `That is ${requestedIds.length} contacts. Bulk outreach is capped at ${MAX_TARGETS} — narrow the segment first.`,
      },
      { status: 400 },
    )
  }

  const occurredAt = body.occurredAt ? new Date(body.occurredAt) : new Date()
  if (!Number.isFinite(occurredAt.getTime())) {
    return NextResponse.json({ error: 'invalid occurredAt' }, { status: 400 })
  }
  const followUpAt = body.followUpAt ? new Date(body.followUpAt) : null
  if (followUpAt && !Number.isFinite(followUpAt.getTime())) {
    return NextResponse.json({ error: 'invalid followUpAt' }, { status: 400 })
  }

  // Only log against contacts that actually exist right now.
  const existing = await prisma.person.findMany({
    where: { id: { in: requestedIds } },
    select: { id: true },
  })
  const validIds = existing.map((p) => p.id)
  const missing = requestedIds.length - validIds.length
  if (validIds.length === 0) {
    return NextResponse.json(
      { error: 'None of those contacts still exist — refresh the list and try again.' },
      { status: 409 },
    )
  }

  const notes = body.notes.trim()
  const result = await prisma.outreachActivity.createMany({
    data: validIds.map((personId) => ({
      type: body.type as OutreachType,
      personId,
      notes,
      occurredAt,
      followUpAt,
      createdById: user.id,
    })),
  })

  return NextResponse.json({
    ok: true,
    logged: result.count,
    // Surfaced so the UI can say "logged 14 — 1 contact no longer
    // exists" instead of silently reporting a smaller number than the
    // rep selected.
    skippedMissing: missing,
  })
}

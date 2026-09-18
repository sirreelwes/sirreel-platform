import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * POST /api/drivers/[id]/license-details — a human corrects what the
 * extraction read off the card.
 *
 * Why this exists: the AI read is the ONLY writer of expiry, state, class
 * and number, and it reads a phone photo. On 2026-09-16 a Class A CDL
 * good through 07/08/2029 — photographed sideways, on top of a check-out
 * sheet — came back as expiring 02/08/2025, and the roster called it
 * Expired in red. There was no way to fix it: "Mark checked" only flips a
 * boolean, and re-uploading just re-runs the same read. A driver with a
 * current licence was unbookable, and the driver's own page withheld the
 * gate code. Staff reading the card must be able to overrule the model.
 *
 * What this does NOT do: sign the licence off. Correcting the printed
 * values and accepting the images are separate acts —
 * /verify-license stays the only thing that means "a person looked".
 *
 * Body (every field optional; omitted fields are left alone):
 *   { expiry: 'YYYY-MM-DD' | null, dateOfBirth: 'YYYY-MM-DD' | null,
 *     state: 'CA', licenseClass: 'A', licenseNumber: 'E2571075' }
 */

/** Date-only, stored at UTC midnight — every licence date screen reads UTC. */
function parseDay(v: unknown): Date | null | undefined {
  if (v === null) return null
  if (typeof v !== 'string' || !v.trim()) return undefined
  const m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return undefined
  const year = Number(m[1])
  if (year < 1900 || year > 2100) return undefined
  const d = new Date(Date.UTC(year, Number(m[2]) - 1, Number(m[3])))
  return Number.isNaN(d.getTime()) ? undefined : d
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }
  const { id } = await params
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'bad request' }, { status: 400 })
  }

  const before = await prisma.driver.findUnique({
    where: { id },
    select: {
      id: true, licenseExpiry: true, licenseExpired: true, licenseState: true,
      licenseClass: true, licenseNumber: true, dateOfBirth: true,
    },
  })
  if (!before) return NextResponse.json({ error: 'driver not found' }, { status: 404 })

  const data: Record<string, unknown> = {}

  if ('expiry' in body) {
    const d = parseDay(body.expiry)
    if (d === undefined && body.expiry !== undefined) {
      return NextResponse.json({ error: 'expiry must be YYYY-MM-DD' }, { status: 400 })
    }
    data.licenseExpiry = d
    // The stored flag is only ever a cache of "has this date passed".
    // Recompute it here or the row keeps the red chip with a 2029 date.
    data.licenseExpired = d ? d.getTime() + 24 * 60 * 60 * 1000 - 1 < Date.now() : null
  }
  if ('dateOfBirth' in body) {
    const d = parseDay(body.dateOfBirth)
    if (d === undefined && body.dateOfBirth !== undefined) {
      return NextResponse.json({ error: 'dateOfBirth must be YYYY-MM-DD' }, { status: 400 })
    }
    data.dateOfBirth = d
  }
  if (typeof body.state === 'string') {
    const v = body.state.trim().toUpperCase()
    data.licenseState = v ? v.slice(0, 5) : null
  }
  if (typeof body.licenseClass === 'string') {
    const v = body.licenseClass.trim().toUpperCase()
    data.licenseClass = v ? v.slice(0, 10) : null
  }
  if (typeof body.licenseNumber === 'string') {
    const v = body.licenseNumber.trim().toUpperCase()
    data.licenseNumber = v ? v.slice(0, 30) : null
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'nothing to change' }, { status: 400 })
  }

  const driver = await prisma.driver.update({
    where: { id },
    data,
    select: {
      id: true, licenseExpiry: true, licenseExpired: true, licenseState: true,
      licenseClass: true, dateOfBirth: true, licenseVerified: true,
    },
  })

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })
  // The model's read stays in licenseAiReview untouched; the audit row is
  // what says a person overruled it, and with what.
  await prisma.auditLog.create({
    data: {
      userId: user?.id ?? null,
      action: 'driver.license_details_corrected',
      entityType: 'driver',
      entityId: id,
      oldValues: {
        licenseExpiry: before.licenseExpiry?.toISOString() ?? null,
        licenseExpired: before.licenseExpired,
        licenseState: before.licenseState,
        licenseClass: before.licenseClass,
        dateOfBirth: before.dateOfBirth?.toISOString() ?? null,
        licenseNumberOnFile: !!before.licenseNumber,
      },
      newValues: {
        licenseExpiry: driver.licenseExpiry?.toISOString() ?? null,
        licenseExpired: driver.licenseExpired,
        licenseState: driver.licenseState,
        licenseClass: driver.licenseClass,
        dateOfBirth: driver.dateOfBirth?.toISOString() ?? null,
        // Never the number itself — the audit table is read far more
        // widely than the licence images are.
        licenseNumberChanged: typeof body.licenseNumber === 'string',
      },
    },
  })

  return NextResponse.json({ ok: true, driver })
}

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * GET /api/persons?q=...
 *
 * Typeahead used by the ContactPicker on the Create & Send Portal Link
 * modal. The previous implementation matched firstName / lastName /
 * email but had three sharp edges:
 *
 *   1. Multi-word queries ("Wes Bailey") failed because no single
 *      column contains the whole phrase. Tokenized here — each
 *      whitespace-separated piece must match SOMEWHERE (first / last
 *      / email).
 *   2. Hard `take: 8` cap. With ~4k persons and a common surname,
 *      the row the user wanted was getting cut off the bottom. Bumped
 *      to 25 — still small enough for a dropdown.
 *   3. Alphabetical-by-firstName ordering buried freshly created
 *      contacts behind decades-old imports (a Person created moments
 *      ago landed below dozens of identically-named rows). Order is
 *      now createdAt desc so the just-added contact shows up first.
 *
 * Returns each hit with primary company (via the Person → Affiliation
 * join) so the picker can render "Name · Company" without a second
 * round trip.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q') || ''
  if (q.trim().length < 1) return NextResponse.json({ persons: [] })

  // Tokenize on whitespace so "Wes Bailey" actually matches a row whose
  // firstName="Wes" and lastName="Bailey". Each token must match against
  // firstName OR lastName OR email; tokens are AND-ed.
  const tokens = q
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)

  const persons = await prisma.person.findMany({
    where: {
      AND: tokens.map((t) => ({
        OR: [
          { firstName: { contains: t, mode: 'insensitive' as const } },
          { lastName: { contains: t, mode: 'insensitive' as const } },
          { email: { contains: t, mode: 'insensitive' as const } },
        ],
      })),
    },
    orderBy: { createdAt: 'desc' },
    take: 25,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      // Person has two columns for telephone: `phone` (rarely populated —
      // only 29/4094 rows as of May 2026) and `mobile` (the actual canonical
      // field — 2,819 rows). Surface both, and prefer mobile when phone is
      // null so the picker shows something useful for most contacts.
      mobile: true,
      affiliations: {
        select: { company: { select: { id: true, name: true } } },
        take: 1,
      },
    },
  })

  // Flatten the first affiliation onto `company` so the ContactPicker
  // doesn't need to know about the join shape. Coalesce phone || mobile
  // so legacy `mobile`-only rows still surface a number.
  const shaped = persons.map((p) => ({
    id: p.id,
    firstName: p.firstName,
    lastName: p.lastName,
    email: p.email,
    phone: p.phone || p.mobile || null,
    company: p.affiliations[0]?.company || null,
  }))

  return NextResponse.json({ persons: shaped })
}

/**
 * GET /api/crm/people/[id]/history
 *
 * Compact "header strip" for the new-quote person-first anchor.
 * Returns live counts (NOT the stale Person.totalBookings/totalSpend/
 * lastBookingAt denorms — those aren't maintained by the booking
 * flow today), the person's role, their last project, and their
 * current company affiliations + recently-touched companies for
 * STEP 1B's company-suggestion ranking.
 *
 * One round-trip per matched person. Cheap — pure aggregate counts +
 * a couple of compact lookups.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const person = await prisma.person.findUnique({
    where: { id },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      role: true,
      rawTitle: true,
      lastKnownProject: true,
      // Live counts via _count — NOT the denorms. The booking flow
      // doesn't maintain totalBookings/totalSpend/lastBookingAt; these
      // _count queries are the truth.
      _count: {
        select: {
          jobContacts: true,
          bookings: true,
          referredBookings: true,
          orderContacts: true,
        },
      },
      // Current affiliations + companies — drives the company-suggestion
      // ranking in STEP 1B.
      affiliations: {
        where: { isCurrent: true },
        select: {
          company: { select: { id: true, name: true, tier: true } },
          productionName: true,
        },
        take: 10,
      },
    },
  })

  if (!person) {
    return NextResponse.json({ error: 'person not found' }, { status: 404 })
  }

  // Most recent Orders this person was the jobContact on — gives the
  // "last seen on" + recently-touched companies signal that's stronger
  // than the affiliations row alone.
  const recentOrders = await prisma.order.findMany({
    where: { jobContactId: id },
    select: {
      id: true,
      orderNumber: true,
      createdAt: true,
      company: { select: { id: true, name: true } },
      job: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 5,
  })

  // Companies surfaced from the email domain — if the person's email
  // is at @rema-films.com and a Company has website rema-films.com,
  // that's a strong "this is their current shop" suggestion.
  const emailDomain = person.email.split('@')[1] ?? null
  const domainCompanies = emailDomain
    ? await prisma.company.findMany({
        where: {
          OR: [
            { website: { contains: emailDomain, mode: 'insensitive' } },
            { billingEmail: { contains: `@${emailDomain}`, mode: 'insensitive' } },
          ],
        },
        select: { id: true, name: true, tier: true },
        take: 3,
      })
    : []

  // Roll the three signal sources (affiliations, recent orders, domain)
  // into one ordered suggested-company list. Dedupe by id, rank by
  // (a) recency of orders, (b) affiliation presence, (c) domain match.
  type Suggestion = { id: string; name: string; tier: string; reason: string }
  const suggestedCompanies: Suggestion[] = []
  const seen = new Set<string>()
  for (const o of recentOrders) {
    if (o.company && !seen.has(o.company.id)) {
      suggestedCompanies.push({
        id: o.company.id, name: o.company.name, tier: 'STANDARD',
        reason: `last order ${o.createdAt.toISOString().slice(0, 10)}`,
      })
      seen.add(o.company.id)
    }
  }
  for (const a of person.affiliations) {
    if (!seen.has(a.company.id)) {
      suggestedCompanies.push({
        id: a.company.id, name: a.company.name, tier: a.company.tier,
        reason: a.productionName ? `affiliated · ${a.productionName}` : 'affiliated',
      })
      seen.add(a.company.id)
    }
  }
  for (const c of domainCompanies) {
    if (!seen.has(c.id)) {
      suggestedCompanies.push({
        id: c.id, name: c.name, tier: c.tier,
        reason: `domain match (@${emailDomain})`,
      })
      seen.add(c.id)
    }
  }

  return NextResponse.json({
    person: {
      id: person.id,
      name: `${person.firstName} ${person.lastName}`.trim(),
      email: person.email,
      role: person.role,
      rawTitle: person.rawTitle,
      lastKnownProject: person.lastKnownProject,
      counts: {
        // The user-facing "N prior orders" — sum of the four signals
        // that mean "this person has done business with us." Live
        // counts, not stale denorms.
        priorOrders: person._count.orderContacts,
        jobContacts: person._count.jobContacts,
        bookings: person._count.bookings,
        referredBookings: person._count.referredBookings,
      },
    },
    recentOrders: recentOrders.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      companyName: o.company?.name ?? null,
      jobName: o.job?.name ?? null,
      createdAt: o.createdAt.toISOString(),
    })),
    suggestedCompanies,
  })
}

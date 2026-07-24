import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * Link an HQ Company to a RentalWorks CUSTOMER — the prerequisite for any
 * RW invoice/AR to attach to that client (and thence to its jobs).
 *
 * Company.rentalworksCustomerId is already 97% populated from a historical
 * import; this is for the tail that isn't. Candidate customers come from the
 * invoice mirror (every RW customer that has billed appears there), ranked
 * by name similarity to the HQ company — with a nudge for customers whose
 * deal names overlap this company's job names, and a penalty for customers
 * already claimed by a different HQ company.
 *
 * GET    → current link + ranked candidates
 * POST   { rwCustomerId } → set the link
 * DELETE → clear it
 */

function norm(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/\b(llc|inc|ltd|co|corp|company|productions?|studios?|media|films?|group|the)\b/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
function tokenSet(s: string): Set<string> {
  return new Set(norm(s).split(' ').filter((t) => t.length > 1))
}
/** Jaccard similarity of the significant tokens, 0..1. */
function similarity(a: string, b: string): number {
  const A = tokenSet(a), B = tokenSet(b)
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const t of A) if (B.has(t)) inter++
  return inter / (A.size + B.size - inter)
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const company = await prisma.company.findUnique({
    where: { id: params.id },
    select: {
      name: true, rentalworksCustomerId: true,
      jobs: { select: { name: true }, take: 50 },
    },
  })
  if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 })

  // Distinct RW customers present in the mirror.
  const grouped = await prisma.rwInvoice.groupBy({
    by: ['rwCustomerId', 'customerName'],
    where: { rwCustomerId: { not: null } },
    _count: { _all: true },
    _sum: { remainingTotal: true },
  })

  // Which RW customer ids are already claimed by SOME company (so we can
  // warn when a suggestion is already taken elsewhere).
  const claimedRows = await prisma.company.findMany({
    where: { rentalworksCustomerId: { not: null } },
    select: { id: true, name: true, rentalworksCustomerId: true },
  })
  const claimed = new Map(claimedRows.map((c) => [c.rentalworksCustomerId as string, c]))

  const jobNames = company.jobs.map((j) => norm(j.name)).filter(Boolean)

  const candidates = grouped
    .map((g) => {
      const rwCustomerId = g.rwCustomerId as string
      const name = g.customerName ?? ''
      let score = similarity(company.name, name)
      // Nudge: any of this company's job names appear as this customer's deal?
      // (cheap heuristic via name tokens — the reconcile step confirms orders)
      const nameTokens = tokenSet(name)
      const dealHit = jobNames.some((jn) => {
        const jt = jn.split(' ')
        return jt.some((t) => t.length > 3 && nameTokens.has(t))
      })
      if (dealHit) score += 0.1
      const takenBy = claimed.get(rwCustomerId)
      return {
        rwCustomerId,
        name,
        invoiceCount: g._count._all,
        outstanding: Number(g._sum.remainingTotal ?? 0),
        score: Math.round(score * 100) / 100,
        takenByOtherCompany: takenBy && takenBy.id !== params.id ? takenBy.name : null,
        isCurrent: rwCustomerId === company.rentalworksCustomerId,
      }
    })
    .filter((c) => c.score >= 0.15 || c.isCurrent)
    .sort((a, b) => b.score - a.score)
    .slice(0, 15)

  return NextResponse.json({
    companyName: company.name,
    currentRwCustomerId: company.rentalworksCustomerId,
    candidates,
  })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { rwCustomerId?: unknown }
  const rwCustomerId = String(body.rwCustomerId ?? '').trim().slice(0, 60)
  if (!rwCustomerId) return NextResponse.json({ error: 'rwCustomerId required' }, { status: 400 })

  const company = await prisma.company.findUnique({ where: { id: params.id }, select: { id: true } })
  if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 })

  await prisma.company.update({ where: { id: params.id }, data: { rentalworksCustomerId: rwCustomerId } })
  return NextResponse.json({ ok: true, rwCustomerId })
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await prisma.company.update({ where: { id: params.id }, data: { rentalworksCustomerId: null } })
  return NextResponse.json({ ok: true })
}

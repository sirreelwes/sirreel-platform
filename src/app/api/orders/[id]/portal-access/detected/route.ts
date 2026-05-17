import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const LOOKBACK_DAYS = 30
const PAGE_SIZE = 25

/**
 * GET /api/orders/[id]/portal-access/detected
 *
 * Returns inbound email addresses that surfaced on this order's company in
 * the last 30 days but DON'T have a PortalAccess on the order yet. Powers
 * the "new contact detected" panel on the rep-side Order page.
 *
 * Linkage today: filters EmailMessage.companyId — accurate but coarse.
 * A future commit can refine to thread→order matching once that exists.
 *
 * SirReel-internal addresses (sirreel.com) are filtered out — those aren't
 * client contacts, they're rep replies / cc'd ops people.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const order = await prisma.order.findUnique({
    where: { id: params.id },
    select: { id: true, companyId: true },
  })
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000)

  const [emails, existing] = await Promise.all([
    prisma.emailMessage.findMany({
      where: {
        direction: 'inbound',
        duplicateOfId: null,
        companyId: order.companyId,
        sentAt: { gte: since },
      },
      select: {
        fromAddress: true,
        subject: true,
        sentAt: true,
        person: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
      orderBy: { sentAt: 'desc' },
      take: 200,
    }),
    prisma.portalAccess.findMany({
      where: { orderId: order.id },
      select: { contact: { select: { email: true } } },
    }),
  ])

  const existingEmails = new Set(existing.map((a) => a.contact?.email?.toLowerCase()).filter(Boolean) as string[])
  const sirreelInternal = /@sirreel\.com$/i

  // Group by from-address normalised. Keep the most recent subject/sentAt.
  type Detected = {
    email: string
    displayName: string
    person: { id: string; firstName: string; lastName: string } | null
    mostRecentSubject: string
    mostRecentAt: string
  }
  const byEmail = new Map<string, Detected>()
  for (const e of emails) {
    const parsed = parseFromAddress(e.fromAddress)
    if (!parsed) continue
    if (sirreelInternal.test(parsed.email)) continue
    if (existingEmails.has(parsed.email)) continue
    if (!byEmail.has(parsed.email)) {
      byEmail.set(parsed.email, {
        email: parsed.email,
        displayName: parsed.name || parsed.email,
        person: e.person
          ? { id: e.person.id, firstName: e.person.firstName, lastName: e.person.lastName }
          : null,
        mostRecentSubject: e.subject || '(no subject)',
        mostRecentAt: e.sentAt.toISOString(),
      })
    }
  }

  return NextResponse.json({
    detected: Array.from(byEmail.values()).slice(0, PAGE_SIZE),
    windowDays: LOOKBACK_DAYS,
  })
}

function parseFromAddress(raw: string): { name: string; email: string } | null {
  // Accepts "Name <email@addr>" or just "email@addr"
  const trimmed = raw.trim()
  const m = trimmed.match(/^(.*)<\s*([^>]+)\s*>$/)
  if (m) {
    return { name: m[1].trim().replace(/^"|"$/g, ''), email: m[2].trim().toLowerCase() }
  }
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { name: '', email: trimmed.toLowerCase() }
  }
  return null
}

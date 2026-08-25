import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { parseInboundCc } from '@/lib/email/inboundCc'

export const dynamic = 'force-dynamic'

/**
 * GET /api/email-messages/[id]/cc — who else was on the inbound email.
 *
 * Feeds the reply's CC box so everyone the client looped in stays looped
 * in (Wes 2026-08-25). `?exclude=` (comma-separated) drops addresses
 * already on the reply — normally the To: recipient, who would otherwise
 * appear twice.
 *
 * Our own @sirreel.com people are returned SEPARATELY and never mixed
 * into `clients`: they're common on these threads, and echoing them onto
 * a client-facing reply is noise.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }
  const { id } = await params
  const msg = await prisma.emailMessage.findUnique({
    where: { id },
    select: { routingHeaders: true, fromAddress: true, toAddresses: true },
  })
  if (!msg) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const rawCc = (msg.routingHeaders as { cc?: string } | null)?.cc ?? null
  const exclude = (req.nextUrl.searchParams.get('exclude') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  const { clients, internal } = parseInboundCc(rawCc, exclude)
  return NextResponse.json({ ok: true, clients, internal, hadHeader: !!rawCc })
}

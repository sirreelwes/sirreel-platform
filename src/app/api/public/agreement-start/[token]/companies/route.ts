import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkRateLimit, clientIp } from '@/lib/portal/publicRateLimit'

export const dynamic = 'force-dynamic'

/**
 * GET /api/public/agreement-start/[token]/companies?q= — company typeahead
 * for the public "new job" form.
 *
 * THIS RETURNS CLIENT COMPANY NAMES ON A PUBLIC SURFACE. That is a
 * deliberate product decision by Wes (2026-08-05), taken with the tradeoff
 * stated: a START_NEW token is minted for EVERY address that hits the
 * rental-agreement gate, including addresses we don't recognise, so
 * possession of a token proves control of a mailbox and nothing more. The
 * chosen benefit is that a first-time contact at an existing client can
 * pick the right company instead of typing a variant that spawns a
 * duplicate.
 *
 * Given that, this endpoint is built to serve a typeahead and to be a poor
 * scraping tool:
 *
 *   - MIN_Q characters required. A single letter returns nothing, so the
 *     list can't be walked a–z.
 *   - Substring match, capped at LIMIT rows, ordered by name — no paging,
 *     no cursor, no way to ask for "the rest".
 *   - NAMES ONLY. No ids, no contacts, no addresses, no counts. The submit
 *     path still resolves the typed string through companyNameKey, so a
 *     caller can't target a company row directly by id.
 *   - Token must be a live, unused START_NEW entry.
 *   - Per-IP rate limit shared with the other public intakes.
 *
 * None of that makes the client list secret. It stops casual bulk export.
 * If the list should be secret, the answer is to scope suggestions to the
 * requester's own companies — not to add more filters here.
 */

const MIN_Q = 3
const LIMIT = 8

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const ip = clientIp(req)
  const rl = checkRateLimit(`company-suggest:${ip}`)
  if (!rl.ok) return NextResponse.json({ companies: [] }, { status: 429 })

  const entry = await prisma.agreementEntry.findUnique({
    where: { token: params.token || '' },
    select: { kind: true, expiresAt: true, usedAt: true },
  })
  // Same validity window the form page uses, minus the already-submitted
  // case — a used token has no more typing to do.
  if (!entry || entry.kind !== 'START_NEW' || entry.usedAt || entry.expiresAt < new Date()) {
    return NextResponse.json({ companies: [] })
  }

  const q = (req.nextUrl.searchParams.get('q') || '').trim()
  if (q.length < MIN_Q) return NextResponse.json({ companies: [] })

  const rows = await prisma.company.findMany({
    where: { name: { contains: q, mode: 'insensitive' } },
    select: { name: true },
    orderBy: { name: 'asc' },
    take: LIMIT,
  })
  return NextResponse.json({ companies: rows.map((r) => r.name) })
}

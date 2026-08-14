/**
 * GET /api/admin/cardpointe-calls — the recorded CardPointe gateway traffic.
 *
 * Admin-only. Exists because the answer to "what did we actually send Fiserv"
 * used to live only on Fiserv's side: their validation review caught a CVV on
 * a merchant-initiated charge and incomplete stored-credential fields, and we
 * had no way to see either, check the rest, or confirm a fix.
 *
 * Every row is already redacted at write time (see recordGatewayCall) — tokens
 * masked to last 4, CVV/PIN/track/PAN dropped. Nothing here needs further
 * scrubbing before display, and nothing here is cardholder data.
 *
 * Query params:
 *   ?operation=auth|void|refund|inquire
 *   ?retref=<id>            exact match
 *   ?flagged=1              only calls with a compliance flag
 *   ?declined=1             only calls the gateway did not approve
 *   ?limit=<n>              default 50, max 200
 *   ?cursor=<id>            keyset pagination, older than this row
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth-admin'
import { prisma } from '@/lib/prisma'
import { flagsForCall } from '@/lib/cardpointe/callFlags'
import { isApproved } from '@/lib/cardpointe/client'

export const dynamic = 'force-dynamic'

const OPERATIONS = new Set(['auth', 'void', 'refund', 'inquire'])

export async function GET(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate instanceof NextResponse) return gate

  const sp = req.nextUrl.searchParams
  const operation = sp.get('operation')
  const retref = sp.get('retref')?.trim()
  const onlyFlagged = sp.get('flagged') === '1'
  const onlyDeclined = sp.get('declined') === '1'
  const limit = Math.min(Math.max(parseInt(sp.get('limit') || '50', 10) || 50, 1), 200)
  const cursor = sp.get('cursor')

  const where: Record<string, unknown> = {}
  if (operation && OPERATIONS.has(operation)) where.operation = operation
  if (retref) where.retref = retref

  // Flags are derived from the JSON payloads, so they cannot be a SQL filter.
  // Over-fetch and narrow in memory; the multiplier is bounded so a page of
  // flagged rows never scans the whole table.
  const take = onlyFlagged || onlyDeclined ? limit * 10 : limit + 1

  const rows = await prisma.cardpointeGatewayCall.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  })

  const decorated = rows.map((r) => {
    const flags = flagsForCall({
      operation: r.operation,
      request: r.request as Record<string, unknown> | null,
      response: r.response as Record<string, unknown> | null,
      cvvresp: r.cvvresp,
    })
    return {
      id: r.id,
      operation: r.operation,
      merchid: r.merchid,
      retref: r.retref,
      respstat: r.respstat,
      respcode: r.respcode,
      resptext: r.resptext,
      amount: r.amount,
      cvvresp: r.cvvresp,
      avsresp: r.avsresp,
      httpStatus: r.httpStatus,
      createdAt: r.createdAt.toISOString(),
      // inquire is a status read, not an approval decision — calling it
      // "declined" because it lacks an approval code would be noise.
      approved:
        r.operation === 'inquire'
          ? null
          : isApproved({ respstat: r.respstat ?? undefined, respcode: r.respcode ?? undefined }),
      request: r.request,
      response: r.response,
      flags,
    }
  })

  let calls = decorated
  if (onlyFlagged) calls = calls.filter((c) => c.flags.length > 0)
  if (onlyDeclined) calls = calls.filter((c) => c.approved === false)
  const hasMore = calls.length > limit
  calls = calls.slice(0, limit)

  // Summary is computed over the whole table, not the page — the question
  // "are we clean right now" must not depend on how far someone scrolled.
  const [total, byOperation, latest] = await Promise.all([
    prisma.cardpointeGatewayCall.count(),
    prisma.cardpointeGatewayCall.groupBy({ by: ['operation'], _count: { _all: true } }),
    prisma.cardpointeGatewayCall.findFirst({ orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
  ])

  // Flag totals need the payloads, so this reads recent rows rather than the
  // full history. Bounded deliberately: an unbounded scan of a table that
  // grows with every charge would eventually time out the page it feeds.
  const SUMMARY_WINDOW = 1000
  const recent = await prisma.cardpointeGatewayCall.findMany({
    orderBy: { createdAt: 'desc' },
    take: SUMMARY_WINDOW,
    select: { operation: true, request: true, response: true, cvvresp: true },
  })
  const flagCounts: Record<string, number> = {}
  for (const r of recent) {
    for (const f of flagsForCall({
      operation: r.operation,
      request: r.request as Record<string, unknown> | null,
      response: r.response as Record<string, unknown> | null,
      cvvresp: r.cvvresp,
    })) {
      flagCounts[f.code] = (flagCounts[f.code] || 0) + 1
    }
  }

  return NextResponse.json({
    calls,
    hasMore,
    nextCursor: hasMore && calls.length > 0 ? calls[calls.length - 1].id : null,
    summary: {
      total,
      lastCallAt: latest?.createdAt.toISOString() ?? null,
      byOperation: Object.fromEntries(byOperation.map((g) => [g.operation, g._count._all])),
      flagCounts,
      flagWindow: Math.min(total, SUMMARY_WINDOW),
    },
  })
}

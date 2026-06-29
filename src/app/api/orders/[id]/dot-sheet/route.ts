/**
 * POST /api/orders/[id]/dot-sheet        — generate the DOT packet, store on the Order.
 * GET  /api/orders/[id]/dot-sheet         — stream the stored DOT PDF (gated proxy).
 * GET  /api/orders/[id]/dot-sheet?check=1 — readiness check (units + what's missing)
 *                                            for the pre-send warning; no generation.
 *
 * The PDF lives on a PRIVATE blob and is served only through this proxy
 * (and the portal proxy for clients) — never a public CDN URL.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireDispatchAccess } from '@/lib/fleet/requireDispatchAccess'
import { streamPrivateBlobAsResponse } from '@/lib/claims/streamBlob'
import { gatherDotUnits, generateAndStoreDotSheet } from '@/lib/fleet/dotSheet'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const auth = await requireDispatchAccess()
  if (!auth.ok) return auth.response
  const { id } = await params

  if (req.nextUrl.searchParams.get('check') === '1') {
    const { units, jobName, jobCode, company } = await gatherDotUnits(id)
    const order = await prisma.order.findUnique({ where: { id }, select: { dotSheetGeneratedAt: true } })
    return NextResponse.json({
      ok: true,
      company, jobName, jobCode,
      unitCount: units.length,
      incompleteUnits: units.filter((u) => u.missing.length > 0).map((u) => ({ unitName: u.unitName, missing: u.missing })),
      hasSheet: !!order?.dotSheetGeneratedAt,
      generatedAt: order?.dotSheetGeneratedAt ?? null,
    })
  }

  const order = await prisma.order.findUnique({ where: { id }, select: { dotSheetPdfUrl: true, job: { select: { jobCode: true } } } })
  if (!order?.dotSheetPdfUrl) return NextResponse.json({ error: 'no DOT sheet generated yet' }, { status: 404 })
  return streamPrivateBlobAsResponse({ fileUrl: order.dotSheetPdfUrl, filename: `DOT-${order.job?.jobCode ?? id}.pdf` })
}

export async function POST(_req: NextRequest, { params }: Params) {
  const auth = await requireDispatchAccess()
  if (!auth.ok) return auth.response
  const { id } = await params

  const result = await generateAndStoreDotSheet(id)
  if (!result.ok) return NextResponse.json({ ok: false, error: result.reason }, { status: 400 })
  return NextResponse.json({
    ok: true,
    unitCount: result.units.length,
    incompleteUnits: result.incompleteUnits,
    generatedAt: result.generatedAt,
  })
}

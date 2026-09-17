/**
 * GET  /api/orders/[id]/dot-sheet         — the DOT packet for this order's
 *                                            CURRENT units, rendered fresh.
 * GET  /api/orders/[id]/dot-sheet?check=1 — readiness: units, what is missing,
 *                                            and whether the client can see it.
 * POST /api/orders/[id]/dot-sheet         — the "send it anyway" override:
 *                                            records that a human chose to
 *                                            publish an INCOMPLETE record.
 *
 * The GET no longer streams a stored blob. A sheet built when the rep pressed
 * publish went on naming a van that had since been swapped off the order, so
 * the bytes are built from the order's units at the moment of the request —
 * see src/lib/fleet/dotSheetPublish.ts. Staff may pull it in any state; the
 * client's copy is gated (api/portal/job/dot-sheet).
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireDispatchAccess } from '@/lib/fleet/requireDispatchAccess'
import { dotSheetForOrder, generateAndStoreDotSheet, renderDotSheet } from '@/lib/fleet/dotSheet'
import { deskBlockerSentence } from '@/lib/fleet/dotSheetPublish'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const auth = await requireDispatchAccess()
  if (!auth.ok) return auth.response
  const { id } = await params

  const sheet = await dotSheetForOrder(id)

  if (req.nextUrl.searchParams.get('check') === '1') {
    return NextResponse.json({
      ok: true,
      company: sheet.company,
      jobName: sheet.jobName,
      jobCode: sheet.jobCode,
      unitCount: sheet.state.unitCount,
      incompleteUnits: sheet.state.gaps,
      // What the CLIENT can see right now, and whether it got there without
      // anyone pressing anything. The modal's copy reads these directly —
      // "hasSheet" used to mean "a PDF exists", which stopped being the
      // question once the sheet became derived.
      clientCanSee: sheet.state.available,
      automatic: sheet.state.automatic,
      reason: sheet.state.reason,
      blocker: deskBlockerSentence(sheet.state),
    })
  }

  if (sheet.state.unitCount === 0) {
    return NextResponse.json({ error: 'no assigned vehicle units on this order' }, { status: 404 })
  }
  const pdf = await renderDotSheet(sheet)
  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="DOT-${sheet.jobCode ?? id}.pdf"`,
      'Cache-Control': 'no-store',
    },
  })
}

export async function POST(_req: NextRequest, { params }: Params) {
  const auth = await requireDispatchAccess()
  if (!auth.ok) return auth.response
  const { id } = await params

  // Still stores a PDF — an artifact of exactly what was approved. What it is
  // FOR is the `dotSheetGeneratedAt` stamp: the record of a human deciding an
  // incomplete sheet should go to the client anyway. A complete record needs
  // no press at all and never reaches here.
  const result = await generateAndStoreDotSheet(id)
  if (!result.ok) return NextResponse.json({ ok: false, error: result.reason }, { status: 400 })
  return NextResponse.json({
    ok: true,
    unitCount: result.units.length,
    incompleteUnits: result.incompleteUnits,
    generatedAt: result.generatedAt,
  })
}

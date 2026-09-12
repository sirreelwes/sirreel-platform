import React from 'react'
import { NextRequest, NextResponse } from 'next/server'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import { requireLabelAccess } from '@/lib/warehouse/labelAccess'
import { unitsForLabels, markLabelsPrinted } from '@/lib/warehouse/mintUnits'
import { LabelSheetDocument } from '@/lib/warehouse/LabelSheetDocument'
import { DEFAULT_STOCK, LABEL_STOCKS, isLabelStockId } from '@/lib/warehouse/unitLabels'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/warehouse/units/labels?codes=SR900001,SR900002&stock=avery5160&skip=0
 *
 * A PDF sheet of Code 39 labels for those register units — freshly
 * minted or RW's own (a reprint for a worn label is the same sheet).
 * Codes the register does not know are refused by name rather than
 * silently left off: a sheet with a hole in it is how one piece goes
 * out unlabelled.
 *
 * `skip` leaves that many cells empty at the top of the first sheet so a
 * part-used sheet can be run again. `?check=1` returns the resolution as
 * JSON without rendering, for the page to preview.
 */
export async function GET(req: NextRequest) {
  const auth = await requireLabelAccess()
  if (!auth.ok) return auth.response

  const params = new URL(req.url).searchParams
  const codes = (params.get('codes') ?? '').split(/[\s,]+/).filter(Boolean)
  if (!codes.length) return NextResponse.json({ error: 'codes is required' }, { status: 400 })
  const stockParam = params.get('stock') ?? DEFAULT_STOCK
  if (!isLabelStockId(stockParam)) {
    return NextResponse.json({ error: `unknown stock; one of ${Object.keys(LABEL_STOCKS).join(', ')}` }, { status: 400 })
  }
  const skipRaw = Number(params.get('skip') ?? 0)
  const perPage = LABEL_STOCKS[stockParam].cols * LABEL_STOCKS[stockParam].rows
  const skip = Number.isFinite(skipRaw) ? Math.max(0, Math.min(perPage - 1, Math.floor(skipRaw))) : 0

  const found = await unitsForLabels(codes)
  if (params.get('check') === '1') {
    return NextResponse.json({ units: found.units, missing: found.missing, stock: stockParam, skip })
  }
  if (found.missing.length) {
    return NextResponse.json(
      { error: `not in the register: ${found.missing.join(', ')}`, missing: found.missing },
      { status: 404 },
    )
  }
  if (!found.units.length) return NextResponse.json({ error: 'nothing to print' }, { status: 400 })

  const element = React.createElement(LabelSheetDocument, {
    stock: stockParam, skip, units: found.units,
  }) as React.ReactElement<DocumentProps>
  const pdf = await renderToBuffer(element)
  await markLabelsPrinted(found.units.map((u) => u.id))

  const first = found.units[0].barcode
  const last = found.units[found.units.length - 1].barcode
  const stem = found.units.length === 1 ? `label-${first}` : `labels-${first}-${last}`
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${stem}.pdf"`,
      'Cache-Control': 'no-store',
    },
  })
}

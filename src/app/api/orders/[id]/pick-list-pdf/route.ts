import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { renderPickListPdf } from '@/lib/warehouse/renderPickListPdf'

export const dynamic = 'force-dynamic'
export const maxDuration = 15

// Warehouse Pick List PDF — rendered on demand and streamed inline,
// NEVER stored in Blob. The document prints the live pick state
// (Out / Remaining move as the picking floor scans items), so a stored
// copy would go stale the moment anyone picked an item.
//
// The rendering itself lives in lib/warehouse/renderPickListPdf.ts so
// this route and the send-to-warehouse email produce the SAME sheet.
// `?lines=<id,id,…>` renders a partial pull; `?download=1` attaches.
//
// `?added=1` prints ONLY the gear added since the check-out sheet was
// filed (Wes, 2026-09-18) — a mid-job add is a new pull for the floor,
// not a reprint of an order they have already worked.
//
// `?receipt=1` prints the DRIVER'S COPY instead (Oliver, 2026-09-13) —
// the same document with the counts filled in from the filed check-out
// sheet and a line for the driver to sign, which is what a driver
// leaving the yard is owed. It 400s until a check-out report exists,
// because the counts are the only thing it has to say.
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rendered = await renderPickListPdf(params.id, {
    lineIds: (req.nextUrl.searchParams.get('lines') ?? '').split(','),
    receipt: req.nextUrl.searchParams.get('receipt') === '1',
    addedOnly: req.nextUrl.searchParams.get('added') === '1',
  })
  if (!rendered.ok) {
    return NextResponse.json({ error: rendered.error }, { status: rendered.status })
  }

  const { pdf, stem } = rendered.result
  const wantDownload = req.nextUrl.searchParams.get('download') === '1'
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${wantDownload ? 'attachment' : 'inline'}; filename="${stem}.pdf"`,
      'Content-Length': String(pdf.length),
      'Cache-Control': 'private, no-store',
    },
  })
}

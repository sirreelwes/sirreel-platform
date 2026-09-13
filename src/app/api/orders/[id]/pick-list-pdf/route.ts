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
// `?filed=OUT` renders the DRIVER'S COPY — the sheet with the counts the
// filed check-out report recorded in the Picked column (Wes 2026-09-12:
// "it's the driver's receipt"); 404 until that report is on file.
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
    filed: req.nextUrl.searchParams.get('filed') === 'OUT' ? 'OUT' : undefined,
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

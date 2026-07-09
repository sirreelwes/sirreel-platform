import { NextResponse } from 'next/server'
import { generateCounterPdf } from '@/lib/contracts/generateCounterPdf'

export const dynamic = 'force-dynamic'

/**
 * GET /api/public/rental-agreement/pdf — the UNSIGNED rental agreement as a
 * downloadable PDF for the public /rental-agreement review page ("Download
 * PDF" button + the FORMS nav flow).
 *
 * Generated on demand from the SAME single source the on-screen page renders —
 * contractClauses.ts via ContractDocument (the exact baseline doc-to-sign path
 * the portal uses: generateCounterPdf with no changes/decisions) — so the PDF
 * and the page can never drift. No company/job context (generic public copy),
 * no signature, no schema. Public by design (sits under /api/public/, already
 * on both host allow-lists).
 */
export async function GET() {
  try {
    const pdf = await generateCounterPdf({
      company: null,
      job: null,
      aiChanges: [],
      decisions: [],
      generatedAt: new Date(),
      grantedScope: null,
      // Baseline document — NOT a counter proposal.
      documentTitle: 'Rental Agreement',
    })
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="sirreel-rental-agreement.pdf"',
        // Regenerated per request; never let a CDN pin a stale copy after a
        // clause-source update ships.
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('[public/rental-agreement/pdf] render failed:', err)
    return NextResponse.json({ error: 'PDF generation failed' }, { status: 500 })
  }
}

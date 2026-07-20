import { NextResponse } from 'next/server'
import { generateStageContractPdf } from '@/lib/contracts/generateStageContractPdf'

export const dynamic = 'force-dynamic'

/**
 * GET /api/public/stage-contract/pdf — the UNSIGNED stage booking contract
 * as a downloadable PDF for the public /stage-contract review page
 * ("Download PDF" button + the FORMS nav flow).
 *
 * Generated on demand from the SAME single source the on-screen page renders
 * — stageContractClauses.ts via StageContractDocument — so the PDF and the
 * page can never drift. Blank party/terms (generic public copy), no
 * signature, no schema. Public by design (sits under /api/public/).
 */
export async function GET() {
  try {
    const pdf = await generateStageContractPdf({
      party: {
        clientCompany: '',
        projectName: '',
        clientAddress: '',
        producerName: '',
        producerPhone: '',
        producerEmail: '',
        contactName: '',
        contactPhone: '',
        contactEmail: '',
      },
      terms: {
        rentalDates: [],
        dailyRate: '',
        productionOfficeRental: false,
        specificSpaces: [],
        securityGuardRequired: false,
      },
      generatedAt: new Date(),
    })
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="sirreel-stage-contract.pdf"',
        // Regenerated per request; never let a CDN pin a stale copy after a
        // clause-source update ships.
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('[public/stage-contract/pdf] render failed:', err)
    return NextResponse.json({ error: 'PDF generation failed' }, { status: 500 })
  }
}

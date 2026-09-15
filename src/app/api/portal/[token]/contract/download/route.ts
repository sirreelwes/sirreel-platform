/**
 * GET /api/portal/[token]/contract/download — the rental agreement a quote
 * portal hands its client to read, print or sign.
 *
 * TWO documents, and picking the right one is the whole job:
 *
 *  1. A company with a CURRENT negotiated/annual master (Wes 2026-09-15:
 *     "turns out this is a negotiated agreement between this company") is
 *     served THAT document. Graduation Day Productions redlined our standard
 *     agreement, we agreed it, and the quote portal went on handing them the
 *     standard terms anyway — asking them to sign back the very language they
 *     negotiated away. The master is resolved fresh from the token's booking,
 *     never from a client-supplied id, and streamed from the private blob
 *     store exactly like /api/portal/job/agreement/annual does.
 *
 *  2. Everyone else gets the baseline, rendered from
 *     `src/lib/contracts/contractClauses.ts` — the SAME source the signed
 *     copy, the AI review and the counter-proposal read.
 *
 * Rule 2 is not a refactor, it is the bug (Wes 2026-09-15: "make sure our
 * standard agreement is exactly what we worked on — that one looks really
 * short"). This route used to carry its own hand-typed `TERMS` array, and it
 * had drifted badly from the agreement it claimed to be: 24 of the 30 clauses
 * differed, clause 30 (Third-Party Equipment) was absent, the Fleet Agreement
 * section was absent, and the LCDW addendum was one paragraph with none of
 * its exclusions — so clients were accepting a per-day waiver whose terms
 * appeared nowhere in the document they signed, the overhead-clearance
 * exclusion included. Several clauses were quietly narrower than canonical
 * (20 dropped death and third-party property damage; 24 dropped incorporation
 * of the schedules; 26 dropped breach; 27 dropped as-applied invalidity).
 *
 * So: nothing here states contract language. Any wording change happens in
 * contractClauses.ts, which stays in lockstep with
 * public/contracts/sirreel-rental-agreement.pdf, and reaches every surface at
 * once. A second copy of a contract is a contract that will be wrong.
 */
import { formatCalendarDate } from '@/lib/dates/calendarDate'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveDisplayJobName } from '@/lib/jobs/displayName'
import {
  CANONICAL_CLAUSES,
  RENTAL_POLICIES,
  FLEET_AGREEMENT,
  LCDW_ADDENDUM,
} from '@/lib/contracts/contractClauses'
import { findCompanyAnnualCoverage, annualCoverageTitle } from '@/lib/orders/annualCoverage'
import { streamPrivateBlobAsResponse } from '@/lib/claims/streamBlob'

export const dynamic = 'force-dynamic'

/** Contract text is data, not markup — escape it before it meets the page. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function buildHtml(booking: any) {
  const company = booking?.company?.name || ''
  // The production title printed on a signed rental agreement. Never a
  // cart placeholder — see lib/jobs/displayName.
  const jobName = resolveDisplayJobName({
    jobName: booking?.job?.name,
    bookingJobName: booking?.jobName,
    companyName: booking?.company?.name,
  })
  // Calendar dates — UTC, never the server's zone. This is a signed rental
  // agreement; a day-early date here is a contract that states the wrong term.
  const LONG = { month: 'long', day: 'numeric', year: 'numeric' } as const
  const startDate = formatCalendarDate(booking?.startDate, LONG, '')
  const endDate = formatCalendarDate(booking?.endDate, LONG, '')
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

  const policiesHtml = RENTAL_POLICIES.map(
    (p) => `
    <p class="policy-text"><strong>${esc(p.title)}:</strong> ${esc(p.body)}</p>
  `,
  ).join('')

  const termsHtml = CANONICAL_CLAUSES.map(
    (t) => `
    <p style="margin-bottom:12px;font-size:11pt;line-height:1.6;">
      <strong>${esc(t.ref)}. ${esc(t.title)}.</strong> ${esc(t.body)}
    </p>
  `,
  ).join('')

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>SirReel Studio Services — Equipment &amp; Vehicle Rental Agreement</title>
<style>
  body { font-family: 'Times New Roman', serif; margin: 0; padding: 20px 40px; color: #111; }
  .header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 20px; margin-bottom: 30px; }
  .logo img { height: 60px; width: auto; }
  .subtitle { font-size: 10pt; color: #555; margin-top: 4px; }
  h1 { font-size: 18pt; text-align: center; margin: 20px 0; text-transform: uppercase; letter-spacing: 1px; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 24px 0; border: 1px solid #ccc; padding: 16px; }
  .info-item { }
  .info-label { font-size: 8pt; font-weight: bold; text-transform: uppercase; color: #666; margin-bottom: 4px; }
  .info-value { font-size: 11pt; font-weight: bold; }
  .section-title { font-size: 13pt; font-weight: bold; text-transform: uppercase; border-bottom: 1px solid #000; padding-bottom: 6px; margin: 24px 0 16px 0; letter-spacing: 1px; }
  .policy-text { font-size: 11pt; line-height: 1.6; margin-bottom: 12px; }
  .signature-block { margin-top: 40px; display: grid; grid-template-columns: 1fr 1fr; gap: 40px; }
  .sig-line { border-top: 1px solid #000; padding-top: 8px; font-size: 10pt; }
  .sig-label { font-size: 8pt; color: #666; text-transform: uppercase; }
  .footer { margin-top: 40px; text-align: center; font-size: 9pt; color: #666; border-top: 1px solid #ccc; padding-top: 16px; }
  /* A contract must not end mid-sentence because a section broke across a
     page (2026-09-15: a client's printed copy stopped at "By accepting
     LCDW, you"). Keep headings with their text and clauses whole. */
  .section-title { break-after: avoid; page-break-after: avoid; }
  .policy-text, .clause { break-inside: avoid; page-break-inside: avoid; }
  @media print { body { margin: 0; padding: 20px; } }
</style>
</head>
<body>
  <div class="header">
    <div class="logo"><img src="https://hq.sirreel.com/sirreel-logo.png" alt="SirReel Studio Services" style="height:60px;width:auto;" /></div>
    <div class="subtitle">Studio Services · 8500 Lankershim Blvd, Sun Valley, CA 91352 · (818) 515-2389 · info@sirreel.com</div>
  </div>

  <h1>Equipment &amp; Vehicle Rental Agreement</h1>
  <p style="text-align:center;font-size:10pt;color:#666;">Date: ${esc(today)}</p>

  <div class="info-grid">
    <div class="info-item">
      <div class="info-label">Company / Lessee</div>
      <div class="info-value">${esc(company)}</div>
    </div>
    <div class="info-item">
      <div class="info-label">Production / Job</div>
      <div class="info-value">${esc(jobName)}</div>
    </div>
    <div class="info-item">
      <div class="info-label">Rental Start Date</div>
      <div class="info-value">${esc(startDate)}</div>
    </div>
    <div class="info-item">
      <div class="info-label">Rental End Date</div>
      <div class="info-value">${esc(endDate)}</div>
    </div>
    <div class="info-item">
      <div class="info-label">Booking Number</div>
      <div class="info-value">${esc(booking?.bookingNumber || '')}</div>
    </div>
    <div class="info-item">
      <div class="info-label">Lessor</div>
      <div class="info-value">SirReel Production Vehicles, Inc.</div>
    </div>
  </div>

  <div class="section-title">Rental Policies</div>
${policiesHtml}

  <div class="section-title">Equipment and Vehicle Terms &amp; Conditions</div>

  <p style="font-style:italic;font-size:10pt;margin-bottom:16px;">Please read carefully. You are liable for our equipment and vehicles from the time they leave our premises until the time they are returned to us and we sign for them.</p>

  ${termsHtml}

  <div class="section-title">${esc(FLEET_AGREEMENT.title)}</div>

  <p style="font-style:italic;font-size:10pt;margin-bottom:12px;">${esc(FLEET_AGREEMENT.intro)}</p>
  <p class="policy-text">${esc(FLEET_AGREEMENT.fuelPolicy)}</p>

  <div class="section-title">${esc(LCDW_ADDENDUM.title)}</div>

  <p class="policy-text"><strong>${esc(LCDW_ADDENDUM.rate)}</strong></p>
  <p class="policy-text">${esc(LCDW_ADDENDUM.coverage)}</p>
  <p class="policy-text"><strong>${esc(LCDW_ADDENDUM.exclusions)}</strong></p>
  <p class="policy-text">${esc(LCDW_ADDENDUM.scope)}</p>
  <p class="policy-text">${esc(LCDW_ADDENDUM.note)}</p>

  <div class="section-title">Agreement &amp; Signature</div>

  <p class="policy-text">I have read, understood, and agree to the terms and conditions above. I am an Authorized Representative of the Lessee and I understand and accept the terms and conditions in this contract.</p>

  <div class="signature-block">
    <div>
      <div style="height:60px;border-bottom:1px solid #000;margin-bottom:8px;"></div>
      <div class="sig-label">Signature of Authorized Representative</div>
      <div style="height:36px;border-bottom:1px solid #ccc;margin:12px 0 4px 0;"></div>
      <div class="sig-label">Printed Name</div>
      <div style="height:36px;border-bottom:1px solid #ccc;margin:12px 0 4px 0;"></div>
      <div class="sig-label">Title</div>
      <div style="height:36px;border-bottom:1px solid #ccc;margin:12px 0 4px 0;"></div>
      <div class="sig-label">Date</div>
    </div>
    <div>
      <div style="height:60px;border-bottom:1px solid #000;margin-bottom:8px;"></div>
      <div class="sig-label">SirReel Representative Signature</div>
      <div style="height:36px;border-bottom:1px solid #ccc;margin:12px 0 4px 0;"></div>
      <div class="sig-label">Printed Name</div>
      <div style="height:36px;border-bottom:1px solid #ccc;margin:12px 0 4px 0;"></div>
      <div class="sig-label">Date</div>
    </div>
  </div>

  <div class="footer">
    SirReel Production Vehicles, Inc. dba SirReel Studio Services<br>
    8500 Lankershim Blvd, Sun Valley, CA 91352 · (818) 515-2389 · info@sirreel.com · www.sirreel.com
  </div>
</body>
</html>`
}

export async function GET(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  try {
    const format = req.nextUrl.searchParams.get('format') || 'pdf'

    const request = await prisma.paperworkRequest.findUnique({
      where: { token: params.token },
      include: { booking: { include: { company: true, job: { select: { name: true } } } } }
    })
    if (!request) return NextResponse.json({ error: 'Invalid token' }, { status: 404 })

    // A negotiated master on file IS this client's agreement. Resolved from
    // the token's own booking — a portal token can never name an agreement.
    const companyId = request.booking?.company?.id
    if (companyId) {
      const coverage = await findCompanyAnnualCoverage(companyId)
      if (coverage) {
        const master = await prisma.companyAgreement.findUnique({
          where: { id: coverage.companyAgreementId },
          select: { fileUrl: true },
        })
        if (master) {
          return streamPrivateBlobAsResponse({
            fileUrl: master.fileUrl,
            filename: `${annualCoverageTitle(coverage).replace(/[^A-Za-z0-9 ._-]+/g, '')}.pdf`,
            forceDownload: format === 'docx',
          })
        }
      }
    }

    const html = buildHtml(request.booking)

    if (format === 'html') {
      // Return HTML that browser can print-to-PDF
      return new NextResponse(html, {
        headers: {
          'Content-Type': 'text/html',
          'Content-Disposition': `inline; filename="rental-agreement-${request.booking?.bookingNumber || 'sirreel'}.html"`,
        }
      })
    }

    // For docx: return HTML with docx mime type hint — client opens in Word
    // In production, replace with proper docx generation using docx npm package
    const filename = `SirReel-Rental-Agreement-${request.booking?.bookingNumber || 'draft'}`

    if (format === 'docx') {
      // Wrap HTML in MHTML for Word compatibility
      const mhtml = `MIME-Version: 1.0
Content-Type: multipart/related; boundary="----=_NextPart_01"

------=_NextPart_01
Content-Type: text/html; charset="utf-8"
Content-Transfer-Encoding: quoted-printable

${html}

------=_NextPart_01--`

      return new NextResponse(mhtml, {
        headers: {
          'Content-Type': 'application/msword',
          'Content-Disposition': `attachment; filename="${filename}.doc"`,
        }
      })
    }

    // PDF — return HTML for browser print dialog
    const printHtml = html.replace('</head>', `
      <script>
        window.onload = function() { window.print(); }
      </script>
      <style>
        @media print {
          @page { margin: 1in; }
        }
      </style>
    </head>`)

    return new NextResponse(printHtml, {
      headers: {
        'Content-Type': 'text/html',
        'Content-Disposition': `inline; filename="${filename}.html"`,
      }
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

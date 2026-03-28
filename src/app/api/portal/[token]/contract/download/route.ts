import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

const TERMS = [
  { n: 1, title: 'Indemnity', text: 'Lessee/Renter ("You") agree to defend, indemnify, and hold SirReel Production Vehicles, Inc. dba SirReel Studio Rentals our agents, employees, assignees, suppliers, sub-lessors and sub-renters ("Us" or "We") harmless from and against any and all claims, actions, causes of action, demands, rights, damages of any kind, costs, loss of profit, expenses and compensation whatsoever including court costs and attorneys\' fees, in any way arising from, or in connection with the Vehicles and Equipment rented/leased, including, without limitation, as a result of its use, maintenance, or possession, irrespective of the cause of the Claim, except as the result of our sole negligence or willful act, from the time the Equipment leaves our place of business until the Equipment is returned to us during normal business hours and we sign a written receipt for it.' },
  { n: 2, title: 'Loss of or Damage to Equipment', text: 'You are responsible for loss, damage or destruction of the Equipment, including but not limited to losses while in transit, while loading and unloading, while at any and all locations, while in storage and while on your premises, except that you are not responsible for damage to or loss of the Equipment caused by our sole negligence or willful misconduct.' },
  { n: 3, title: 'Protection of Others', text: 'You will take reasonable precautions in regard to the use of the Equipment to protect all persons and property from injury or damage. The Equipment shall be used only by your employees or agents qualified to use the Equipment.' },
  { n: 4, title: 'Equipment in Working Order', text: 'We have tested the Equipment in accordance with reasonable industry standards and found it to be in working order immediately prior to the inception of this Agreement. You acknowledge that the Equipment is rented/leased without warranty, or guarantee, except as required by law.' },
  { n: 5, title: 'Property Insurance', text: 'You shall, at your own expense, maintain all risk perils property insurance covering the Equipment. The Property Insurance shall name us as an additional insured and as the loss payee. Coverage shall be sufficient to cover the Equipment at its replacement value but shall in no event be less than $1,000,000. The Property Insurance shall be primary & Non-Contributory coverage.' },
  { n: 6, title: 'Workers Compensation & Employers Liability Insurance', text: 'You shall, at your own expense, maintain worker\'s compensation/employer\'s liability insurance during the course of the Equipment rental with minimum limits of $1,000,000, including coverage for the use of any volunteers, interns, or independent contractors working on your behalf.' },
  { n: 7, title: 'Liability Insurance', text: 'You shall maintain commercial general liability insurance naming us as an additional insured with general liability aggregate limits of not less than $2,000,000 and not less than $1,000,000 per occurrence. Said insurance shall be primary & Non-Contributory coverage.' },
  { n: 8, title: 'Vehicle Insurance', text: 'You shall maintain business motor vehicle liability insurance including coverage for loading and unloading Equipment and hired motor vehicle physical damage insurance. We shall be named as an additional insured. The Vehicle Insurance shall provide not less than $1,000,000 in combined single limits liability coverage.' },
  { n: 9, title: 'Insurance Generally', text: 'All insurance maintained by you shall contain a waiver of subrogation rights. You shall hold us harmless from and shall bear the expense of any applicable deductible amounts. Lapse, reduction in coverage or cancellation of the required insurance shall be deemed to be an immediate and automatic default of this agreement.' },
  { n: 10, title: 'Cancellation of Insurance', text: 'You and your insurance company shall provide us with not less than 30 days written notice prior to the effective date of any cancellation or material change to any insurance maintained by you.' },
  { n: 11, title: 'Certificates of Insurance', text: 'Before obtaining possession of the Equipment you shall provide to us Certificates of Insurance confirming the coverages specified above. All certificates shall be signed by an authorized agent or representative of the insurance carrier.' },
  { n: 12, title: 'Drivers', text: 'Any and all drivers who drive the Vehicles you are renting/leasing from us shall be duly licensed, trained and qualified to drive vehicles of this type. You must supply and employ any driver who drives our Vehicles, and that driver shall be deemed to be your employee or covered independent contracted driver for all purposes and shall be covered as an additional insured on all of your applicable insurance policies.' },
  { n: 13, title: 'Compliance With Law and Regulations', text: 'You agree to comply with the laws of all states in which the Equipment is transported and/or used as well as all federal and local state laws, regulations, and ordinances pertaining to the transportation and use of such Equipment.' },
  { n: 14, title: 'Valuation of Loss/Our Liability is Limited', text: 'You shall be responsible to us for the replacement cost value or repair cost of the Equipment, whichever is less. In the event of loss for which we are responsible, our liability will be limited to the contract price and WE WILL, IN NO EVENT, BE LIABLE FOR ANY CONSEQUENTIAL, SPECIAL OR INCIDENTAL DAMAGES.' },
  { n: 15, title: 'Subrogation', text: 'You hereby agree that we shall be allowed to subrogate for any recovery rights you may have for damage to the Equipment.' },
  { n: 16, title: 'Bailment', text: 'This agreement constitutes an Agreement of bailment of the Equipment and is not a sale or the creation of a security interest. You will not have, or at any time acquire, any right, title, or interest in the Equipment, except the right to possession and use as provided for in this Agreement.' },
  { n: 17, title: 'Condition of Equipment', text: 'You assume all obligation and liability with respect to the possession of Equipment, and for its use, condition and storage during the term of this Agreement. You will, at your own expense, maintain the Equipment in good mechanical condition and running order.' },
  { n: 18, title: 'Identity', text: 'We will have the right to place and maintain on the exterior or interior of each piece of property covered by this Agreement the inscription: Property of SirReel. You will not remove, obscure, or deface the inscription.' },
  { n: 19, title: 'Expenses', text: 'You will be responsible for all expenses, including but not limited to fuel, lubricants, and all other charges in connection with the operation of the Equipment.' },
  { n: 20, title: 'Accident Reports', text: 'If any of the Equipment is damaged, lost, stolen, or destroyed, or if any person is injured, you will promptly notify us of the occurrence, and will file all necessary accident reports. You, your employees, and agents will cooperate fully with us and all insurers.' },
  { n: 21, title: 'Default', text: 'If you fail to pay any portion of the total fees payable hereunder or otherwise materially breach this Agreement, such failure or breach shall constitute a Default. Upon any Default, we shall have the right to terminate this Agreement and cease performance hereunder.' },
  { n: 22, title: 'Return', text: 'Upon the expiration date of this Agreement, you will return the property to us, together with all accessories, free from all damage and in the same condition and appearance as when received by you.' },
  { n: 23, title: 'Additional Equipment', text: 'Additional Equipment may from time to time be added as the subject matter of this Agreement as agreed on by the parties. All amendments must be in writing and signed by both parties.' },
  { n: 24, title: 'Entire Agreement', text: 'This Agreement and any attached schedules constitute the entire agreement between the parties. No agreements, representations, or warranties other than those specifically set forth in this Agreement will be binding on any of the parties unless set forth in writing and signed by both parties.' },
  { n: 25, title: 'Applicable Law', text: 'This Agreement will be deemed to be executed and delivered in Los Angeles, California and governed by the laws of the State of California.' },
  { n: 26, title: 'Arbitration', text: 'Any controversy or claim arising out of or related to this Agreement will be settled by arbitration in Los Angeles, California, under the auspices of JAMS. The decision and award of the arbitrator will be final and binding.' },
  { n: 27, title: 'Severability', text: 'If any provision of this Agreement is held invalid or unenforceable, the remainder of this Agreement will remain valid and in full force and effect.' },
  { n: 28, title: 'Facsimile Signature', text: 'This Agreement may be executed by facsimile signature and such signature shall be deemed a valid and binding original signature.' },
  { n: 29, title: 'Non-smoking Policy', text: 'All vehicles are non-smoking vehicles and lessee is responsible for all damages caused from smoking in or near the vehicles. A $250 per day fee may be charged in addition to the cost to repair any damaged items if the smoking policy is not observed.' },
]

function buildHtml(booking: any, format: string) {
  const company = booking.company?.name || ''
  const jobName = booking.jobName || ''
  const startDate = booking.startDate ? new Date(booking.startDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : ''
  const endDate = booking.endDate ? new Date(booking.endDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : ''
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

  const termsHtml = TERMS.map(t => `
    <p style="margin-bottom:12px;font-size:11pt;line-height:1.6;">
      <strong>${t.n}. ${t.title}.</strong> ${t.text}
    </p>
  `).join('')

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { font-family: 'Times New Roman', serif; margin: 0; padding: 40px; color: #111; }
  .header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 20px; margin-bottom: 30px; }
  .logo { font-size: 24pt; font-weight: bold; letter-spacing: 2px; }
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
  @media print { body { margin: 0; padding: 20px; } }
</style>
</head>
<body>
  <div class="header">
    <div class="logo">SIRREEL</div>
    <div class="subtitle">Studio Services · 8500 Lankershim Blvd, Sun Valley, CA 91352 · (818) 515-2389 · info@sirreel.com</div>
  </div>

  <h1>Equipment & Vehicle Rental Agreement</h1>
  <p style="text-align:center;font-size:10pt;color:#666;">Date: ${today}</p>

  <div class="info-grid">
    <div class="info-item">
      <div class="info-label">Company / Lessee</div>
      <div class="info-value">${company}</div>
    </div>
    <div class="info-item">
      <div class="info-label">Production / Job</div>
      <div class="info-value">${jobName}</div>
    </div>
    <div class="info-item">
      <div class="info-label">Rental Start Date</div>
      <div class="info-value">${startDate}</div>
    </div>
    <div class="info-item">
      <div class="info-label">Rental End Date</div>
      <div class="info-value">${endDate}</div>
    </div>
    <div class="info-item">
      <div class="info-label">Booking Number</div>
      <div class="info-value">${booking.bookingNumber || ''}</div>
    </div>
    <div class="info-item">
      <div class="info-label">Lessor</div>
      <div class="info-value">SirReel Production Vehicles, Inc.</div>
    </div>
  </div>

  <div class="section-title">Rental Policies</div>

  <p class="policy-text"><strong>Cancellation Policy:</strong> If notice of cancellation is provided less than 24hrs from the date of pickup, you agree to pay (1) daily rate for all equipment and vehicles booked. Notice of cancellation must be provided in writing via email to your SirReel account representative.</p>

  <p class="policy-text"><strong>Missing Equipment Return Policy:</strong> Any equipment missing from an order return will be billed as a loss. Loss invoices are Net15 (due 15 days from receipt). Any missing equipment returned within the 15 day payment period will be removed from the invoice.</p>

  <p class="policy-text"><strong>Administrative Fee:</strong> SirReel applies a ten percent administrative fee to all loss, theft, or damage charges.</p>

  <p class="policy-text"><strong>Discounts Policy:</strong> All discounts are on Quickpay terms and invoices must be paid via credit card within 5 days. After 5 days the discounts will expire and will not be reinstated.</p>

  <p class="policy-text"><strong>Payment Terms:</strong> Long-term projects (spanning more than 14 days) require payment in full before the first day of rental. Rentals used for any type of event must be paid in full before the first day of rental.</p>

  <div class="section-title">Equipment and Vehicle Terms & Conditions</div>

  <p style="font-style:italic;font-size:10pt;margin-bottom:16px;">Please read carefully. You are liable for our equipment and vehicles from the time they leave our premises until the time they are returned to us and we sign for them.</p>

  ${termsHtml}

  <div class="section-title">Limited Collision Damage Waiver (LCDW)</div>

  <p class="policy-text"><strong>$24.00 per day per vehicle.</strong> The Limited Collision Damage Waiver limits your liability for physical damage to SirReel vehicles during your rental period. By accepting LCDW, you agree to pay $24.00 per day per vehicle rented. You acknowledge that you will be charged $10.00 for each gallon necessary to return the vehicle to the fuel level it went out with.</p>

  <div style="margin:20px 0;padding:12px;border:1px solid #ccc;">
    <p style="font-size:11pt;margin:0;"><strong>☐ I accept LCDW</strong> for all fleet vehicle rentals at $24.00/day/vehicle</p>
    <p style="font-size:11pt;margin:8px 0 0 0;"><strong>☐ I acknowledge</strong> the $10.00/gallon fuel return policy</p>
  </div>

  <div class="section-title">Agreement & Signature</div>

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
      include: { booking: { include: { company: true } } }
    })
    if (!request) return NextResponse.json({ error: 'Invalid token' }, { status: 404 })

    const html = buildHtml(request.booking, format)

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

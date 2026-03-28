import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const COI_PROMPT = `You are reviewing a Certificate of Insurance (COI) for SirReel Production Vehicles Inc.

CERTIFICATE HOLDER REQUIRED:
- SirReel Production Vehicles Inc. (also: SirReel Production Vehicles, Inc. dba SirReel Studio Rentals)
- 8500 Lankershim Blvd, Sun Valley, CA 91352

HARD REQUIREMENTS (cannot be waived - must all pass):
1. Certificate Holder = SirReel with correct address
2. General Liability - Each Occurrence min $1,000,000 AND General Aggregate min $2,000,000
3. Automobile Liability - CSL min $1,000,000, must cover Hired AND Non-Owned Autos
4. Additional Insured - SirReel named as Additional Insured
5. Loss Payee - SirReel named as Loss Payee
6. Primary & Non-Contributory coverage
7. Policy not expired

MANAGEABLE REQUIREMENTS (SirReel management may approve exceptions):
A. Umbrella/Excess Liability $1M - preferred but not always required for smaller productions
B. Waiver of Subrogation - if the SUBR WVD column shows "Y" on ANY policy row, this passes. Present on GL only is sufficient.
C. Entertainment Package or Rented Equipment $1M - production package equivalent is acceptable
D. Workers Compensation - may be on a separate payroll company certificate

Return ONLY valid JSON, no markdown:
{
  "hardPass": true,
  "manageablePass": true,
  "overallPass": true,
  "requiresAdminApproval": false,
  "insuredName": { "pass": true, "found": "", "note": "" },
  "certificateHolder": { "hard": true, "pass": true, "found": "", "note": "" },
  "generalLiability": { "hard": true, "pass": true, "perOccurrence": { "pass": true, "found": "", "required": "$1,000,000" }, "aggregate": { "pass": true, "found": "", "required": "$2,000,000" }, "note": "" },
  "autoLiability": { "hard": true, "pass": true, "combinedSingleLimit": { "pass": true, "found": "", "required": "$1,000,000" }, "hiredAutos": { "pass": true, "found": "" }, "nonOwnedAutos": { "pass": true, "found": "" }, "note": "" },
  "additionalInsured": { "hard": true, "pass": true, "found": "", "note": "" },
  "lossPayee": { "hard": true, "pass": true, "found": "", "note": "" },
  "primaryNonContributory": { "hard": true, "pass": true, "found": "", "note": "" },
  "policyExpiry": { "hard": true, "date": "", "expired": false },
  "umbrella": { "hard": false, "pass": true, "perOccurrence": { "pass": true, "found": "" }, "aggregate": { "pass": true, "found": "" }, "note": "" },
  "waiverOfSubrogation": { "hard": false, "pass": true, "found": "", "note": "" },
  "entertainmentPackage": { "hard": false, "pass": true, "found": "", "note": "" },
  "workersComp": { "hard": false, "pass": true, "found": "", "note": "" },
  "hardIssues": [],
  "manageableIssues": [],
  "notes": ""
}`

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const companyName = formData.get('companyName') as string || ''
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

    const bytes = await file.arrayBuffer()
    const base64 = Buffer.from(bytes).toString('base64')
    const isPdf = file.type === 'application/pdf'
    const mediaType = isPdf ? 'application/pdf' : file.type.includes('png') ? 'image/png' : 'image/jpeg'

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: [
          isPdf
            ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf' as const, data: base64 } }
            : { type: 'image', source: { type: 'base64', media_type: mediaType as 'image/png' | 'image/jpeg', data: base64 } },
          { type: 'text', text: `${COI_PROMPT}\n\n${companyName ? `The company/production is "${companyName}".` : 'No specific company provided.'} Return only JSON.` }
        ] as any
      }]
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    const review = JSON.parse(text.replace(/```json|```/g, '').trim())

    // Enforce logic
    const hardItems = [
      review.certificateHolder?.pass,
      review.generalLiability?.pass,
      review.autoLiability?.pass,
      review.additionalInsured?.pass,
      review.lossPayee?.pass,
      review.primaryNonContributory?.pass,
      !review.policyExpiry?.expired,
    ]
    review.hardPass = hardItems.every(Boolean)
    const manageableItems = [review.umbrella?.pass, review.waiverOfSubrogation?.pass, review.entertainmentPackage?.pass, review.workersComp?.pass]
    review.manageablePass = manageableItems.every(Boolean)
    review.requiresAdminApproval = review.hardPass && !review.manageablePass
    review.overallPass = review.hardPass && review.manageablePass

    return NextResponse.json({ ok: true, review })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

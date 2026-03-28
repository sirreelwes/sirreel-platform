import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '@/lib/prisma'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const WC_PROMPT = `You are reviewing a Workers Compensation insurance document for SirReel Production Vehicles Inc.

This may be a Certificate of Insurance, a proof of workers compensation, or a state-issued WC certificate from a payroll company such as ADP, Entertainment Partners, Cast & Crew, Media Services, or similar.

REQUIRED:
1. Workers Compensation — statutory limits (PER STATUTE checkbox marked, or state minimum limits shown)
2. Employers Liability — minimum $1,000,000 each accident
3. Policy must be active (not expired)
4. Insured must be the production company or their payroll company acting on their behalf

ACCEPTABLE FORMS:
- Standard ACORD 25 COI with Workers Comp section filled in
- State-issued workers comp certificate
- Payroll company proof of coverage letter
- Entertainment industry WC certificate from EP, Cast & Crew, ADP, etc.

Return ONLY valid JSON with no markdown:
{
  "pass": true/false,
  "insuredName": "company name on document",
  "provider": "insurance company or payroll company name",
  "policyNumber": "policy number if found",
  "effectiveDate": "MM/DD/YYYY",
  "expiryDate": "MM/DD/YYYY",
  "expired": true/false,
  "workersComp": { "pass": true/false, "found": "statutory/amount found", "note": "" },
  "employersLiability": { "pass": true/false, "found": "amount found", "required": "$1,000,000", "note": "" },
  "isPayrollProvider": true/false,
  "payrollProviderName": "if applicable",
  "issues": ["list of issues if any"],
  "notes": "any other observations"
}`

export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  try {
    const request = await prisma.paperworkRequest.findUnique({
      where: { token: params.token },
      include: { booking: { include: { company: true } } }
    })
    if (!request) return NextResponse.json({ error: 'Invalid token' }, { status: 404 })

    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

    const bytes = await file.arrayBuffer()
    const base64 = Buffer.from(bytes).toString('base64')
    const isPdf = file.type === 'application/pdf'
    const mediaType = isPdf ? 'application/pdf' : file.type.includes('png') ? 'image/png' : 'image/jpeg'

    const companyName = request.booking?.company?.name || ''

    const contentBlock = isPdf
      ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: base64 } }
      : { type: 'image' as const, source: { type: 'base64' as const, media_type: mediaType as 'image/png' | 'image/jpeg', data: base64 } }

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: [
          contentBlock,
          { type: 'text', text: `${WC_PROMPT}\n\nThe production company is "${companyName}". Return only JSON.` }
        ] as any
      }]
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    const review = JSON.parse(text.replace(/```json|```/g, '').trim())

    // Add columns if not exist
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE paperwork_requests ADD COLUMN IF NOT EXISTS wc_file_url TEXT`)
      await prisma.$executeRawUnsafe(`ALTER TABLE paperwork_requests ADD COLUMN IF NOT EXISTS wc_uploaded_at TIMESTAMP`)
      await prisma.$executeRawUnsafe(`ALTER TABLE paperwork_requests ADD COLUMN IF NOT EXISTS wc_ai_review JSONB`)
      await prisma.$executeRawUnsafe(`ALTER TABLE paperwork_requests ADD COLUMN IF NOT EXISTS wc_review_at TIMESTAMP`)
      await prisma.$executeRawUnsafe(`ALTER TABLE paperwork_requests ADD COLUMN IF NOT EXISTS wc_received BOOLEAN DEFAULT FALSE`)
    } catch {}

    const fileUrl = `data:${file.type};base64,${base64}`
    await prisma.$executeRawUnsafe(
      `UPDATE paperwork_requests SET 
        wc_file_url=$1, wc_uploaded_at=$2, 
        wc_ai_review=$3::jsonb, wc_review_at=$4,
        wc_received=$5
      WHERE token=$6`,
      fileUrl, new Date(), JSON.stringify(review), new Date(), review.pass, params.token
    )

    return NextResponse.json({ ok: true, review })
  } catch (err: any) {
    console.error('[wc-review]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

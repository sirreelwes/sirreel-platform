import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '@/lib/prisma'
import { REVIEW_MODEL } from '@/lib/ai/models'
import { parseAiJson } from '@/lib/ai/extractJson'
import { uploadWcDocument } from '@/lib/wc/uploadWcDocument'

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
      model: REVIEW_MODEL,
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
    const review = parseAiJson<any>(text, { tag: 'wc-review', stopReason: response.stop_reason })

    // Store the certificate itself in the PRIVATE blob store (same
    // treatment as a COI) and record it with a typed write. This used to
    // run `ALTER TABLE ... IF NOT EXISTS` inside a swallowed try/catch and
    // then stuff the whole file into a TEXT column as a base64 data: URI —
    // the columns never got created, so the UPDATE threw and every upload
    // 500'd with nothing saved. The columns are declared on the model now.
    const uploaded = await uploadWcDocument({
      filename: file.name || 'workers-comp',
      contentType: file.type || 'application/octet-stream',
      data: Buffer.from(bytes),
    })

    await prisma.paperworkRequest.update({
      where: { token: params.token },
      data: {
        wcFileKey: uploaded.blobKey,
        wcFileUrl: uploaded.fileUrl,
        wcOriginalFilename: file.name || 'workers-comp',
        wcMimeType: file.type || 'application/octet-stream',
        wcFileSize: bytes.byteLength,
        wcUploadedAt: new Date(),
        wcAiReview: review,
        wcReviewAt: new Date(),
        // The document is on file either way — `pass` is the AI's verdict
        // on the coverage, not on whether we received something.
        wcReceived: true,
      },
    })

    return NextResponse.json({ ok: true, review })
  } catch (err: any) {
    console.error('[wc-review]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

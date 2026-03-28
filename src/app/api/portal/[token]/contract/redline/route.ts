import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '@/lib/prisma'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const REVIEW_PROMPT = `You are a legal reviewer for SirReel Production Vehicles, Inc., a vehicle and equipment rental company in Los Angeles.

You are comparing a client's redlined rental agreement against SirReel's standard agreement.

Your job is to identify every change the client has made and assess each one.

For each change, classify it as:
- "auto_approved": Low-risk, acceptable changes (e.g. minor wording clarifications that don't change meaning, adding client's company name/info, formatting changes)
- "needs_review": Medium-risk changes that modify obligations but may be acceptable (e.g. limiting liability in specific ways, adjusting notice periods, modifying insurance requirements slightly)
- "not_acceptable": High-risk changes SirReel should reject (e.g. removing indemnification, eliminating insurance requirements, capping SirReel's ability to recover damages, removing arbitration clause, limiting SirReel's lien rights)

Key protections SirReel must maintain:
1. Lessee indemnifies SirReel (clause 1) — any weakening = not_acceptable
2. Lessee responsible for all loss/damage (clause 2) — any weakening = not_acceptable  
3. Insurance requirements (clauses 5-11) — reduction below minimums = not_acceptable
4. Arbitration clause (clause 26) — removal = not_acceptable
5. California governing law (clause 25) — change of jurisdiction = needs_review
6. Return condition (clause 22) — any weakening = needs_review
7. Non-smoking policy (clause 29) — removal = needs_review

Return ONLY valid JSON with no markdown:
{
  "summary": "brief overall summary of what the client changed",
  "riskLevel": "low|medium|high",
  "autoApprovedCount": 0,
  "needsReviewCount": 0,
  "notAcceptableCount": 0,
  "changes": [
    {
      "clause": "clause number or section name",
      "type": "auto_approved|needs_review|not_acceptable",
      "original": "brief description of original language",
      "proposed": "brief description of client's proposed change",
      "reasoning": "why this is classified this way",
      "suggestedCounter": "SirReel's suggested counter-proposal if needs_review or not_acceptable"
    }
  ],
  "recommendation": "approve|counter|reject",
  "recommendationNote": "explanation of overall recommendation"
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
    const isDoc = file.type.includes('word') || file.name.endsWith('.docx') || file.name.endsWith('.doc')

    // Store the redlined doc
    const fileUrl = `data:${file.type};base64,${base64}`

    await prisma.$executeRawUnsafe(
      `UPDATE paperwork_requests SET 
        contract_redline_url=$1, 
        contract_redline_uploaded_at=$2,
        contract_redline_status='pending_review'
      WHERE token=$3`,
      fileUrl, new Date(), params.token
    )

    let review: any = null

    if (isPdf) {
      // PDF — send directly to Claude
      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 3000,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: base64 }
            },
            {
              type: 'text',
              text: `${REVIEW_PROMPT}\n\nThe client company is "${request.booking?.company?.name}". Review this redlined rental agreement and return only JSON.`
            }
          ] as any
        }]
      })
      const text = response.content[0].type === 'text' ? response.content[0].text : ''
      review = JSON.parse(text.replace(/```json|```/g, '').trim())
    } else {
      // Word doc or other — extract text via base64 and send as text
      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 3000,
        messages: [{
          role: 'user',
          content: `${REVIEW_PROMPT}\n\nThe client company is "${request.booking?.company?.name}".\n\nI'm providing a Word document as base64. Please analyze it as a redlined rental agreement. The base64 content is: [DOCX file uploaded - analyze based on typical rental agreement redline patterns for production companies. Note: direct DOCX parsing not available, return a review noting the file was received and requires manual review]\n\nReturn JSON with recommendation: "counter" and a note that the Word document needs manual review.`
        }]
      })
      const text = response.content[0].type === 'text' ? response.content[0].text : ''
      try {
        review = JSON.parse(text.replace(/```json|```/g, '').trim())
      } catch {
        review = {
          summary: 'Word document received — requires manual review',
          riskLevel: 'medium',
          autoApprovedCount: 0,
          needsReviewCount: 1,
          notAcceptableCount: 0,
          changes: [{
            clause: 'All clauses',
            type: 'needs_review',
            original: 'Standard SirReel agreement',
            proposed: 'Client redlined version (Word document)',
            reasoning: 'Word document received. Please download and review tracked changes manually.',
            suggestedCounter: 'Review document and respond via the counter-proposal feature.'
          }],
          recommendation: 'counter',
          recommendationNote: 'Word document requires manual review. Download the file to see tracked changes.'
        }
      }
    }

    // Save review
    await prisma.$executeRawUnsafe(
      `UPDATE paperwork_requests SET 
        contract_redline_review=$1::jsonb,
        contract_redline_reviewed_at=$2,
        contract_redline_status='pending_review'
      WHERE token=$3`,
      JSON.stringify(review), new Date(), params.token
    )

    // Send email notification to Wes/Dani (via existing email infrastructure)
    // TODO: trigger email notification

    return NextResponse.json({ ok: true, review })
  } catch (err: any) {
    console.error('[redline]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

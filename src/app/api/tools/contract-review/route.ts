import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const PROMPT = `You are a legal reviewer for SirReel Production Vehicles, Inc., a vehicle and equipment rental company in Los Angeles.

You are reviewing a client's redlined rental agreement against SirReel's standard agreement.

For each change, classify it as:
- "auto_approved": Low-risk (minor wording clarifications, adding company info, formatting changes that don't change meaning)
- "needs_review": Medium-risk (modifies obligations but may be acceptable - limits liability in specific ways, adjusts notice periods, modifies insurance requirements slightly)
- "not_acceptable": High-risk (removes key protections SirReel must maintain)

Key protections SirReel MUST maintain:
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
      "proposed": "brief description of proposed change",
      "reasoning": "why this is classified this way",
      "suggestedCounter": "suggested counter-proposal if needs_review or not_acceptable"
    }
  ],
  "recommendation": "approve|counter|reject",
  "recommendationNote": "explanation of overall recommendation"
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

    let content: any[]

    if (isPdf) {
      content = [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf' as const, data: base64 } },
        { type: 'text', text: `${PROMPT}\n\n${companyName ? `The client company is "${companyName}".` : ''} Review this redlined rental agreement and return only JSON.` }
      ]
    } else {
      // Word doc — can't parse directly, return needs_review with note
      return NextResponse.json({
        ok: true,
        review: {
          summary: 'Word document received — manual review required to see tracked changes.',
          riskLevel: 'medium',
          autoApprovedCount: 0,
          needsReviewCount: 1,
          notAcceptableCount: 0,
          changes: [{
            clause: 'All clauses',
            type: 'needs_review',
            original: 'Standard SirReel rental agreement',
            proposed: 'Client redlined Word document (tracked changes not visible in AI review)',
            reasoning: 'Word documents with tracked changes require manual review in Microsoft Word or Google Docs.',
            suggestedCounter: 'Open in Word to review tracked changes, then upload as PDF for AI analysis.'
          }],
          recommendation: 'counter',
          recommendationNote: 'Please open the Word document to review tracked changes manually, or ask the client to send a PDF version.'
        }
      })
    }

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 3000,
      messages: [{ role: 'user', content }]
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    const review = JSON.parse(text.replace(/```json|```/g, '').trim())

    return NextResponse.json({ ok: true, review })
  } catch (err: any) {
    console.error('[contract-review]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

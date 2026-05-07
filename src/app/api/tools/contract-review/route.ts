import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { readFile } from 'fs/promises'
import path from 'path'
import { randomUUID } from 'crypto'
import { put } from '@vercel/blob'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { CANONICAL_CLAUSES, FLEET_AGREEMENT, LCDW_ADDENDUM } from '@/lib/contracts/contractClauses'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const STANDARD_AGREEMENT_PATH = path.join(
  process.cwd(),
  'public',
  'contracts',
  'sirreel-rental-agreement.pdf'
)

const SYSTEM_PROMPT = `You are reviewing a redlined rental agreement on behalf of SirReel Studio Services, a Los Angeles production-vehicle rental company.

You will receive TWO PDFs:
1. The client's redlined version (look for red text, strikethroughs, underlined additions, or any visible markup)
2. SirReel's standard rental agreement (clean baseline, contains 29 numbered clauses plus a Fleet Agreement section and LCDW addendum)

Compare the redlined document against the baseline. The baseline is the canonical source of truth for what every clause should say.

NOTE ON CLAUSE NUMBERING: The redlined version may have inserted new sub-clauses (1a, 1b, etc.) which renumbers everything below. When in doubt, identify clauses by their SUBJECT MATTER (Indemnity, Insurance, Liability cap, Arbitration, etc.), not by number alone. The baseline numbering is authoritative.

You are not a lawyer. Your job is to flag every modification for human review with the right risk classification.

CRITICAL RISK — always classify these as "not_acceptable":

- ANY modification to the Valuation of Loss / Liability cap clause (clause 14 in the baseline) that weakens or removes SirReel's cap on consequential, special, or incidental damages. The phrase "WE WILL, IN NO EVENT, BE LIABLE FOR ANY CONSEQUENTIAL, SPECIAL OR INCIDENTAL DAMAGES" is non-negotiable.
- Any change from one-way indemnity (Lessee indemnifies SirReel) to mutual indemnity. Adding an "Indemnity of Lessor" subsection where SirReel indemnifies the client is a material risk shift. Indemnity is clause 1 in the baseline.
- Reductions to insurance minimums:
  - Property Insurance below \$1M (clause 5)
  - Workers Compensation below \$1M (clause 6)
  - Liability Insurance below \$2M aggregate / \$1M per occurrence (clause 7)
  - Vehicle Insurance below \$1M combined single limits (clause 8)
- Removal of "primary & non-contributory" language on any insurance clause.
- Removal of additional-insured requirements naming SirReel.
- Changes to arbitration venue (clause 26) away from Los Angeles, CA / JAMS.
- Changes to governing law (clause 25) away from California.
- Removal of subrogation rights (clause 15).
- Removal of the police-report requirement for theft (within clause 14).
- Any clause attempting to make SirReel responsible for the client's production losses, lost profits, or business interruption.
- Changes to the Fleet Agreement section that weaken LCDW exclusions or shift loss-of-use risk.

MEDIUM RISK — classify as "needs_review":

- Addition of a "right to cancel for defective equipment" clause without cure period or substitution opportunity.
- Changes to default and remedy provisions (clause 21).
- Modifications to the cancellation policy (24-hour rule).
- Modifications to the missing equipment return policy (15-day rule).
- Changes to LCDW or fuel policy.
- Removal of "rent shall not be prorated during repairs" language (clause 17) — generally accepted but worth flagging.
- Changes to the certificate of insurance requirement (clause 11).
- Changes to driver requirements (clause 12).
- Removal of the 10% administrative fee paragraph (in rental policies section before clause 1).

LOW RISK — classify as "auto_approved":

- Adding "subject to reasonable wear and tear" to condition clauses.
- Typographical corrections or grammar fixes.
- Adding company-specific contact information or addresses.
- Adjustments to the smoking policy fee amount (clause 29).
- Reformatting that doesn't change meaning.

OUTPUT FORMAT — return ONLY valid JSON, no markdown fences, no preamble:

{
  "summary": "<two-sentence executive summary of what the client changed>",
  "riskLevel": "low" | "medium" | "high",
  "autoApprovedCount": <int>,
  "needsReviewCount": <int>,
  "notAcceptableCount": <int>,
  "changes": [
    {
      "clause": "<clause number from the baseline, e.g. '14' or '1-3' for grouped, or 'Fleet 5(b)' for fleet-agreement clauses>",
      "type": "auto_approved" | "needs_review" | "not_acceptable",
      "original": "<short description of the original baseline language>",
      "proposed": "<short description of what the client is proposing>",
      "reasoning": "<one or two sentences on why this matters to SirReel>",
      "suggestedCounter": "<the actual replacement clause text SirReel would put in the counter-PDF — see CRITICAL RULES below — or null for auto_approved>",
      "counterReasoning": "<the strategic guidance — why the counter pushes back this way, what's negotiable, what's not — never appears in the PDF; or null for auto_approved>"
    }
  ],
  "recommendation": "approve" | "counter" | "reject",
  "recommendationNote": "<one paragraph explaining the overall recommendation>",
  "comparisonPerformed": true | false,
  "comparisonNote": "<if comparisonPerformed is false, explain why>"
}

CRITICAL RULES FOR suggestedCounter (this is the most common source of bad output — read carefully):

\`suggestedCounter\` is the ACTUAL CONTRACT CLAUSE TEXT that will be rendered verbatim into the counter-PDF as the binding language for that clause. It is NOT strategic guidance. It is NOT a description of what to do. It is the operative legal sentence(s).

- DO write replacement clause language in the same legal voice and register as the SirReel baseline (third-person, defined-term style, Lessee/Lessor framing).
- DO write it so a reader could substitute it directly into the contract and have a complete, grammatical, legally operative clause.
- DO match the structure of the baseline clause (same defined terms, similar length, similar formality).
- DO NOT write meta-commentary like "Reject the mutual indemnity language" or "Restore the baseline" or "Push back on X".
- DO NOT write conditional/negotiation framing like "SirReel could propose…" or "We are willing to accept…".
- DO NOT include "[bracketed instructions]" or other notes meant for the human.
- The strategic guidance ("what to do, why, what's negotiable") goes in \`counterReasoning\`, not here.

Examples for clause 1 (Indemnity), where the client added mutual indemnity:

❌ BAD suggestedCounter: "Reject the mutual indemnity subclauses entirely. Restore the baseline one-way indemnity language in clause 1."
✅ GOOD suggestedCounter: "Lessee/Renter (\\"You\\") agree to defend, indemnify, and hold SirReel Production Vehicles, Inc. dba SirReel Studio Rentals, our agents, employees, assignees, suppliers, sub-lessors and sub-renters (\\"Us\\" or \\"We\\") harmless from and against any and all claims, actions, causes of action, demands, rights, damages of any kind, costs, loss of profit, expenses and compensation whatsoever including court costs and attorneys' fees, in any way arising from, or in connection with the Equipment, except as the result of our sole negligence or willful act, from the time the Equipment leaves our place of business until the Equipment is returned to us during normal business hours and we sign a written receipt for it."

Examples for clause 6 (Workers Compensation), where the client tried to reduce to statutory minimums:

❌ BAD suggestedCounter: "Push back on reduction to statutory limits — hold the $1M minimum."
✅ GOOD suggestedCounter: "Lessee shall, at Lessee's own expense, maintain workers compensation/employers liability insurance during the course of the Equipment rental with minimum limits of $1,000,000, including coverage for any volunteers, interns, or independent contractors working on Lessee's behalf and under Lessee's supervision."

The PRIMARY source of truth for the voice and structure of \`suggestedCounter\` is the SirReel baseline clause text provided in the user message. When in doubt, copy the baseline clause verbatim and edit it minimally to address the client's redline. Do NOT invent novel legal language when the baseline already covers SirReel's position.

HARD RULES:

1. If the document appears identical to the baseline (no modifications), set "comparisonPerformed" to false, "changes" to empty array, "recommendation" to "counter". DO NOT recommend "approve".

2. If you cannot determine which document is the redlined version, set "comparisonPerformed" to false, "recommendation" to "counter". DO NOT recommend "approve".

3. If ANY change is "not_acceptable", "recommendation" MUST be "reject" or "counter" — NEVER "approve" — and "riskLevel" MUST be "high".

4. If any change is "needs_review" but none are "not_acceptable", "recommendation" MUST be "counter" — NEVER "approve" — and "riskLevel" MUST be at least "medium".

5. Only recommend "approve" when ALL changes are "auto_approved" AND comparisonPerformed is true AND there is at least one change detected.

6. Identify the redlined document by visual cues: red text, strikethroughs, underlines indicating additions. The baseline PDF will be clean black text only with empty form fields.`

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession()
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const sessionUser = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true },
    })
    if (!sessionUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const companyName = (formData.get('companyName') as string) || ''
    const jobId = (formData.get('jobId') as string) || null
    const companyId = (formData.get('companyId') as string) || null
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    const bytes = await file.arrayBuffer()
    const uploadedBase64 = Buffer.from(bytes).toString('base64')
    const isPdf = file.type === 'application/pdf'

    if (!isPdf) {
      return NextResponse.json({
        ok: true,
        review: {
          summary: 'Word document received — please convert to PDF.',
          riskLevel: 'medium',
          autoApprovedCount: 0,
          needsReviewCount: 1,
          notAcceptableCount: 0,
          changes: [{
            clause: 'All clauses',
            type: 'needs_review',
            original: 'SirReel rental agreement',
            proposed: 'Client redlined Word document (tracked changes not visible to AI)',
            reasoning: 'Word tracked changes are not preserved when sent to vision API.',
            suggestedCounter: null,
            counterReasoning: 'Open in Word, accept-or-reject all tracked changes to flatten them, then export to PDF and re-upload.'
          }],
          recommendation: 'counter',
          recommendationNote: 'Convert the Word file to PDF and re-upload.',
          comparisonPerformed: false,
          comparisonNote: 'Cannot read Word tracked changes via vision API.'
        }
      })
    }

    let standardBase64: string
    try {
      const standardBuffer = await readFile(STANDARD_AGREEMENT_PATH)
      standardBase64 = standardBuffer.toString('base64')
    } catch (err) {
      console.error('[contract-review] Standard agreement missing at', STANDARD_AGREEMENT_PATH)
      return NextResponse.json({
        error: 'Standard agreement baseline is missing on the server. Contact admin.'
      }, { status: 500 })
    }

    // Upload PDF to Blob before running AI so the file is preserved even if AI errors.
    const now = new Date()
    const yyyy = now.getUTCFullYear()
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
    const blobKey = `contracts/${yyyy}/${mm}/${randomUUID()}.pdf`
    const blob = await put(blobKey, file, {
      access: 'private',
      contentType: 'application/pdf',
    })

    const baselineClauseText =
      CANONICAL_CLAUSES.map((c) => `[${c.ref}] ${c.title}\n${c.body}`).join('\n\n') +
      `\n\n[Fleet Agreement] ${FLEET_AGREEMENT.title}\n${FLEET_AGREEMENT.intro}\n${FLEET_AGREEMENT.fuelPolicy}` +
      `\n\n[LCDW] ${LCDW_ADDENDUM.title}\n${LCDW_ADDENDUM.rate}\n${LCDW_ADDENDUM.scope}\n${LCDW_ADDENDUM.note}`

    const userText = `The first attached PDF is the client's redlined version of our rental agreement (look for red text, strikethroughs, and underlined additions).

The second PDF is SirReel's clean standard rental agreement baseline.

${companyName ? `Client company: "${companyName}".\n\n` : ''}When you draft \`suggestedCounter\` for any change, use the baseline clause text below as the source of truth for voice, structure, and defined terms. The text in \`suggestedCounter\` will be rendered verbatim into the counter-PDF as the operative clause language — it must read as a complete contract clause, not as guidance or commentary. Strategic reasoning belongs in \`counterReasoning\`.

=== SIRREEL BASELINE CLAUSE TEXT (canonical source of truth) ===

${baselineClauseText}

=== END BASELINE CLAUSE TEXT ===

Compare the redlined document against the baseline per your instructions. Output ONLY the JSON object — no preamble, no markdown fences.`

    const content: any[] = [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf' as const, data: uploadedBase64 } },
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf' as const, data: standardBase64 } },
      { type: 'text', text: userText }
    ]

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content }]
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    const cleaned = text.replace(/^```json\s*/i, '').replace(/\s*```\s*$/, '').trim()

    let review: any
    try {
      review = JSON.parse(cleaned)
    } catch (parseErr) {
      console.error('[contract-review] JSON parse failed. Raw output:', text)
      return NextResponse.json({
        error: 'AI response could not be parsed. Try again.',
        rawOutput: text.slice(0, 500)
      }, { status: 500 })
    }

    if (Array.isArray(review.changes)) {
      const hasNotAcceptable = review.changes.some((c: any) => c.type === 'not_acceptable')
      const hasNeedsReview = review.changes.some((c: any) => c.type === 'needs_review')

      if (hasNotAcceptable && review.recommendation === 'approve') {
        review.recommendation = 'reject'
        review.riskLevel = 'high'
        review.recommendationNote = '[Auto-corrected] Contains not_acceptable changes. ' + (review.recommendationNote || '')
      }
      if (hasNeedsReview && !hasNotAcceptable && review.recommendation === 'approve') {
        review.recommendation = 'counter'
        if (review.riskLevel === 'low') review.riskLevel = 'medium'
        review.recommendationNote = '[Auto-corrected] Contains needs_review changes. ' + (review.recommendationNote || '')
      }
      if (review.comparisonPerformed === false && review.recommendation === 'approve') {
        review.recommendation = 'counter'
        review.recommendationNote = '[Auto-corrected] Comparison not performed. ' + (review.recommendationNote || '')
      }
    }

    const reviewRecord = await prisma.contractReview.create({
      data: {
        fileKey: blobKey,
        fileUrl: blob.url,
        originalFilename: file.name,
        fileSize: file.size,
        mimeType: file.type,
        jobId,
        companyId,
        uploadedById: sessionUser.id,
        aiResponse: review,
        aiRiskLevel: typeof review.riskLevel === 'string' ? review.riskLevel : null,
        aiRecommendation:
          typeof review.recommendation === 'string' ? review.recommendation : null,
      },
      select: { id: true },
    })

    return NextResponse.json({ ok: true, review, reviewRecordId: reviewRecord.id })
  } catch (err: any) {
    console.error('[contract-review]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

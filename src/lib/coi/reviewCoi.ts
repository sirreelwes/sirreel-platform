import Anthropic from '@anthropic-ai/sdk'
import { REVIEW_MODEL } from '@/lib/ai/models'
import { parseAiJson } from '@/lib/ai/extractJson'

/**
 * Shared AI Certificate-of-Insurance review. Same review the client-drop
 * (portal/job/coi) runs, so an agent uploading a COI on the job page gets
 * the identical analysis. Best-effort: never throws — on any failure it
 * returns a medium-risk stub so the caller still persists the CoiCheck.
 */
export interface CoiAiResponse {
  overallPass?: boolean
  policyExpiryDate?: string | null
  coverageVerified?: boolean
  additionalInsured?: boolean
  riskLevel?: 'low' | 'medium' | 'high' | string
  notes?: string
  [k: string]: unknown
}

const COI_PROMPT = `You are reviewing a Certificate of Insurance (COI) for SirReel Production Vehicles Inc.

CERTIFICATE HOLDER REQUIRED:
- SirReel Production Vehicles Inc.
- 8500 Lankershim Blvd, Sun Valley, CA 91352

CRITICAL REQUIREMENTS (must all pass):
1. Certificate Holder = SirReel with correct address
2. General Liability — Each Occurrence min $1,000,000 AND General Aggregate min $2,000,000
3. Automobile Liability — CSL min $1,000,000, must cover Hired AND Non-Owned Autos
4. Additional Insured — SirReel named
5. Loss Payee — SirReel named
6. Coverage dates cover the rental period
7. Policy not expired

Return ONLY valid JSON (no markdown, no preamble):
{
  "overallPass": true,
  "policyExpiryDate": "YYYY-MM-DD" | null,
  "coverageVerified": true,
  "additionalInsured": true,
  "riskLevel": "low" | "medium" | "high",
  "notes": ""
}`

export async function runCoiAiReview(buffer: Buffer, mimeType: string): Promise<CoiAiResponse> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { overallPass: false, riskLevel: 'medium', notes: 'AI review not run (no API key)' }
  }
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const isPdf = mimeType === 'application/pdf'
    const base64 = buffer.toString('base64')
    const res = await client.messages.create({
      model: REVIEW_MODEL,
      max_tokens: 1200,
      messages: [
        {
          role: 'user',
          content: [
            isPdf
              ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf' as const, data: base64 } }
              : {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: (mimeType === 'image/png' ? 'image/png' : 'image/jpeg') as 'image/png' | 'image/jpeg',
                    data: base64,
                  },
                },
            { type: 'text', text: COI_PROMPT },
          ] as any,
        },
      ],
    })
    const text = res.content[0]?.type === 'text' ? res.content[0].text : ''
    return parseAiJson<CoiAiResponse>(text, { tag: 'coi-review', stopReason: res.stop_reason })
  } catch (err) {
    console.error('[reviewCoi] AI review failed:', err instanceof Error ? err.message : err)
    return { overallPass: false, riskLevel: 'medium', notes: `AI review failed: ${(err as Error).message}` }
  }
}

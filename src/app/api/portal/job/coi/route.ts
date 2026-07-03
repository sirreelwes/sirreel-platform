import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { put } from '@vercel/blob'
import Anthropic from '@anthropic-ai/sdk'
import { prisma } from '@/lib/prisma'
import {
  JOB_SESSION_COOKIE,
  buildJobSessionCookieHeader,
  verifyJobSessionCookieValue,
} from '@/lib/portal/jobSession'
import { resolveJobSession } from '@/lib/portal/jobMagicLink'
import { scheduleOneShotCadenceEvent } from '@/lib/cadence/scheduler'
import { REVIEW_MODEL } from '@/lib/ai/models'
import { parseAiJson } from '@/lib/ai/extractJson'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_FILE_BYTES = 10 * 1024 * 1024
const ACCEPTED_MIME = new Set(['application/pdf', 'image/png', 'image/jpeg'])

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

/**
 * POST /api/portal/job/coi
 *
 * Cookie-authenticated COI upload from the Job Page portal. Stores the file
 * in Vercel Blob, runs the AI review, and persists a CoiCheck row attached
 * to the order's job + company. uploadedById is the order's agent — the row
 * needs a real User reference, and the client contact doesn't have one.
 *
 * Returns a slimmed-down version of the review result so the page can show
 * "received" + risk pill without exposing the raw AI JSON.
 */
export async function POST(req: NextRequest) {
  const session = verifyJobSessionCookieValue(req.cookies.get(JOB_SESSION_COOKIE)?.value)
  if (!session) {
    return NextResponse.json({ error: 'No session' }, { status: 401 })
  }
  const resolved = await resolveJobSession({ portalAccessId: session.portalAccessId })
  if (!resolved) {
    const res = NextResponse.json({ error: 'Session no longer valid' }, { status: 401 })
    res.headers.append('Set-Cookie', buildJobSessionCookieHeader('', { clear: true }))
    return res
  }

  const order = await prisma.order.findUnique({
    where: { id: resolved.orderId },
    select: { id: true, jobId: true, companyId: true, agentId: true },
  })
  if (!order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }

  const form = await req.formData().catch(() => null)
  const file = form?.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  if (file.size > MAX_FILE_BYTES) return NextResponse.json({ error: 'File exceeds 10 MB limit' }, { status: 413 })
  if (!ACCEPTED_MIME.has(file.type)) {
    return NextResponse.json({ error: 'Only .pdf, .png, .jpg files are accepted' }, { status: 415 })
  }

  const bytes = await file.arrayBuffer()
  const buffer = Buffer.from(bytes)
  const base64 = buffer.toString('base64')
  const blobKey = `coi-uploads/${order.id}/${Date.now()}-${randomUUID()}-${file.name.replace(/[^A-Za-z0-9._-]+/g, '-')}`

  let blobUrl: string
  try {
    const uploaded = await put(blobKey, buffer, { access: 'private', contentType: file.type })
    blobUrl = uploaded.url
  } catch (err) {
    console.error('[portal/job/coi] blob upload failed:', err)
    return NextResponse.json({ error: 'Failed to save uploaded file' }, { status: 500 })
  }

  // AI review — best-effort. If Anthropic call fails, we still persist the
  // CoiCheck row so the operator has the file; aiResponse just notes the error.
  let aiResponse: any = { overallPass: false, riskLevel: 'medium', notes: 'AI review not run' }
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
      const isPdf = file.type === 'application/pdf'
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
                      media_type: (file.type === 'image/png' ? 'image/png' : 'image/jpeg') as 'image/png' | 'image/jpeg',
                      data: base64,
                    },
                  },
              { type: 'text', text: COI_PROMPT },
            ] as any,
          },
        ],
      })
      const text = res.content[0]?.type === 'text' ? res.content[0].text : ''
      aiResponse = parseAiJson<any>(text, { tag: 'portal/job/coi', stopReason: res.stop_reason })
    } catch (err) {
      console.error('[portal/job/coi] AI review failed:', err)
      aiResponse = { overallPass: false, riskLevel: 'medium', notes: `AI review failed: ${(err as Error).message}` }
    }
  }

  const policyExpiryDate =
    typeof aiResponse.policyExpiryDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(aiResponse.policyExpiryDate)
      ? new Date(aiResponse.policyExpiryDate)
      : null

  const check = await prisma.coiCheck.create({
    data: {
      fileKey: blobKey,
      fileUrl: blobUrl,
      originalFilename: file.name,
      fileSize: file.size,
      mimeType: file.type,
      jobId: order.jobId,
      companyId: order.companyId,
      uploadedById: order.agentId,
      aiResponse,
      aiRiskLevel: typeof aiResponse.riskLevel === 'string' ? aiResponse.riskLevel : null,
      aiRecommendation: aiResponse.overallPass ? 'accept' : 'review',
      policyExpiryDate,
      coverageVerified: aiResponse.overallPass === true,
      additionalInsured: aiResponse.additionalInsured === true,
    },
    select: {
      id: true,
      aiRiskLevel: true,
      policyExpiryDate: true,
      coverageVerified: true,
      additionalInsured: true,
    },
  })

  // CRH Phase 4.1: COI received → schedule COI_RECEIVED_ACK email. Fire
  // immediately; the cadence runner will pick it up on next pass.
  // Best-effort — a scheduling failure shouldn't block the COI accept.
  try {
    await scheduleOneShotCadenceEvent({ orderId: order.id, eventType: 'COI_RECEIVED_ACK' })
  } catch (err) {
    console.warn('[portal/job/coi] failed to schedule COI_RECEIVED_ACK:', err)
  }

  return NextResponse.json({
    ok: true,
    coi: {
      id: check.id,
      aiRiskLevel: check.aiRiskLevel,
      policyExpiryDate: check.policyExpiryDate,
      coverageVerified: check.coverageVerified,
      additionalInsured: check.additionalInsured,
    },
  })
}

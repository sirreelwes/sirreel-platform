import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { put } from '@vercel/blob'
import { prisma } from '@/lib/prisma'
import {
  JOB_SESSION_COOKIE,
  buildJobSessionCookieHeader,
  verifyJobSessionCookieValue,
} from '@/lib/portal/jobSession'
import { resolveJobSession } from '@/lib/portal/jobMagicLink'
import { scheduleOneShotCadenceEvent } from '@/lib/cadence/scheduler'
// One canonical review for every COI surface — see src/lib/coi/reviewCoi.ts.
import { runCoiAiReview } from '@/lib/coi/reviewCoi'
import { coiCheckWriteFields, coiFlags } from '@/lib/coi/checks'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_FILE_BYTES = 10 * 1024 * 1024
const ACCEPTED_MIME = new Set(['application/pdf', 'image/png', 'image/jpeg'])

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
  const blobKey = `coi-uploads/${order.id}/${Date.now()}-${randomUUID()}-${file.name.replace(/[^A-Za-z0-9._-]+/g, '-')}`

  let blobUrl: string
  try {
    const uploaded = await put(blobKey, buffer, { access: 'private', contentType: file.type })
    blobUrl = uploaded.url
  } catch (err) {
    console.error('[portal/job/coi] blob upload failed:', err)
    return NextResponse.json({ error: 'Failed to save uploaded file' }, { status: 500 })
  }

  // AI review — best-effort. If the Anthropic call fails, runCoiAiReview
  // returns a medium-risk stub so the CoiCheck row is still persisted and the
  // operator has the file.
  const aiResponse = await runCoiAiReview(buffer, file.type)
  const aiFields = coiCheckWriteFields(aiResponse)

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
      // Raw facts off the certificate; the production-company comparison is
      // computed on read (src/lib/coi/insuredMatch.ts).
      ...aiFields,
      // The CRITICAL checks are what "coverage verified" means; an alert-only
      // gap (no umbrella, no waiver) is for a human to judge, not a blocker.
      coverageVerified: coiFlags(aiResponse).criticalPass,
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

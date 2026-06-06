/**
 * POST /api/claims/[id]/paste-document
 *
 * Stores the pasted email chain that produced this claim as a
 * ClaimDocument(CORRESPONDENCE) row, so the original raw text the
 * AI parsed from is preserved for audit + future re-extraction.
 *
 * Body: { text: string, parseUsed: boolean }
 *
 * Upload path: tiny .txt file to Vercel Blob (private access) +
 * one ClaimDocument row pointing at it. Title carries the create
 * timestamp so multiple pastes against the same claim stay
 * distinguishable. Notes carry a short preview so the rep can
 * scan the document list without opening each file.
 *
 * Auth: getServerSession-guarded. Idempotency: not enforced — a
 * second paste creates a second ClaimDocument row, by design (reps
 * may paste follow-up correspondence later).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { put } from '@vercel/blob'
import { randomUUID } from 'crypto'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

const TEXT_MIN_CHARS = 30
const TEXT_MAX_CHARS = 200_000

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const me = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as { text?: unknown; parseUsed?: unknown }
  const text = typeof body.text === 'string' ? body.text : ''
  if (text.trim().length < TEXT_MIN_CHARS) {
    return NextResponse.json({ error: 'text too short' }, { status: 400 })
  }
  if (text.length > TEXT_MAX_CHARS) {
    return NextResponse.json({ error: 'text too long' }, { status: 400 })
  }

  // Confirm the claim exists before burning a Blob upload.
  const claim = await prisma.insuranceClaim.findUnique({
    where: { id },
    select: { id: true, claimNumber: true },
  })
  if (!claim) return NextResponse.json({ error: 'claim not found' }, { status: 404 })

  const now = new Date()
  const yyyy = String(now.getUTCFullYear())
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
  const blobKey = `claims/${yyyy}/${mm}/${randomUUID()}-${claim.claimNumber}-paste.txt`

  let blobUrl: string
  try {
    const blob = await put(blobKey, text, {
      access: 'private' as 'public',
      contentType: 'text/plain; charset=utf-8',
    })
    blobUrl = blob.url
  } catch (err) {
    console.error('[paste-document] blob upload failed:', err)
    return NextResponse.json({ error: 'upload failed' }, { status: 500 })
  }

  const parseUsed = body.parseUsed === true
  const preview = text.slice(0, 240).replace(/\s+/g, ' ').trim()
  const doc = await prisma.claimDocument.create({
    data: {
      claimId: claim.id,
      type: 'CORRESPONDENCE',
      title: `Pasted email chain — ${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
      fileUrl: blobUrl,
      uploadedBy: me.id,
      notes: [
        parseUsed ? 'Source of AI-parsed fields on claim onboarding.' : 'Pasted by rep (no AI parse used).',
        preview ? `Preview: ${preview}…` : null,
      ].filter(Boolean).join('\n\n'),
    },
    select: { id: true },
  })

  return NextResponse.json({ ok: true, document: { id: doc.id, fileUrl: blobUrl } }, { status: 201 })
}

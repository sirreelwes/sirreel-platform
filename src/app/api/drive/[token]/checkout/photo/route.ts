import { NextRequest, NextResponse } from 'next/server'
import { put } from '@vercel/blob'
import { randomUUID } from 'crypto'
import { prisma } from '@/lib/prisma'
import { normalizePosition } from '@/lib/fleet/photoPositions'
import { stagedPrefixFor } from '@/lib/drivers/selfCheckout'

export const dynamic = 'force-dynamic'

const MAX_BYTES = 15 * 1024 * 1024
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])

/**
 * POST /api/drive/[token]/checkout/photo — one walk-around photo from
 * the DRIVER, staged as taken. The token-gated twin of
 * /api/fleet/inspections/photos/stage: same private blob, same staging
 * prefix under the booking assignment, so the finalize step and the
 * condition report treat a driver's shot exactly like a tech's.
 *
 * No login: the token is the credential. It can only stage photos onto
 * ITS OWN assignment — the prefix is derived from the token, never from
 * the form.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const da = await prisma.driverAssignment.findUnique({
    where: { token },
    select: { id: true, status: true, expiresAt: true, bookingAssignmentId: true },
  })
  if (!da) return NextResponse.json({ error: 'invalid link' }, { status: 404 })
  if (da.expiresAt && da.expiresAt < new Date()) {
    return NextResponse.json({ error: 'This link has expired — ask for a new one.' }, { status: 410 })
  }
  if (da.status === 'CANCELLED') return NextResponse.json({ error: 'This assignment was cancelled.' }, { status: 409 })

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'multipart form required' }, { status: 400 })
  }
  const file = form.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'file required' }, { status: 400 })
  if (file.size === 0) return NextResponse.json({ error: 'empty file' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'That photo is too large (15 MB max).' }, { status: 413 })
  const contentType = file.type || 'application/octet-stream'
  if (!ALLOWED_TYPES.has(contentType)) {
    return NextResponse.json({ error: 'Please use a photo (JPG, PNG or HEIC).' }, { status: 415 })
  }

  const position = normalizePosition(form.get('position'))
  const safeName = (file.name || 'photo').replace(/[^\w.\-]/g, '_').slice(0, 80)
  const key = `${stagedPrefixFor(da.bookingAssignmentId)}${randomUUID()}-${safeName}`
  await put(key, file, {
    access: 'private' as 'public', // established private-blob pattern
    contentType,
  })

  return NextResponse.json({ ok: true, key, filename: safeName, contentType, position }, { status: 201 })
}

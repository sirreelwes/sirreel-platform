/**
 * POST /api/fleet/inspections/photos/stage — per-photo immediate upload
 * for the mobile inspection form. Photos are taken one at a time in the
 * yard and must survive a flaky connection, so each uploads to private
 * Vercel Blob AS TAKEN, before the Inspection row exists (the record is
 * only created on Submit). The blob is staged under the booking
 * assignment; finalize (POST /api/fleet/inspections with
 * stagedPhotos[]) attaches it by key — bytes are never re-uploaded.
 *
 * InspectionPhoto.inspectionId is required, so staging is blob-only: no
 * DB row until finalize. Abandoned staged blobs are orphaned (no
 * cleanup pass yet — small, private, and cheap).
 * Role-gated: ADMIN / MANAGER / DISPATCHER / FLEET_TECH.
 */

import { NextRequest, NextResponse } from 'next/server'
import { put } from '@vercel/blob'
import { randomUUID } from 'crypto'
import { prisma } from '@/lib/prisma'
import { requireFleetInspectionAccess } from '@/lib/fleet/requireFleetInspectionAccess'

export const dynamic = 'force-dynamic'

const MAX_BYTES = 15 * 1024 * 1024 // 15 MB — phone camera photos
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])

export async function POST(req: NextRequest) {
  const auth = await requireFleetInspectionAccess()
  if (!auth.ok) return auth.response

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'multipart form required' }, { status: 400 })
  }

  const bookingAssignmentId = form.get('bookingAssignmentId')
  if (typeof bookingAssignmentId !== 'string' || !bookingAssignmentId) {
    return NextResponse.json({ error: 'bookingAssignmentId required' }, { status: 400 })
  }
  const assignment = await prisma.bookingAssignment.findUnique({
    where: { id: bookingAssignmentId },
    select: { id: true },
  })
  if (!assignment) return NextResponse.json({ error: 'booking assignment not found' }, { status: 404 })

  const file = form.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'file required' }, { status: 400 })
  if (file.size === 0) return NextResponse.json({ error: 'empty file' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'file too large (15 MB max)' }, { status: 413 })
  const contentType = file.type || 'application/octet-stream'
  if (!ALLOWED_TYPES.has(contentType)) {
    return NextResponse.json({ error: 'only JPEG/PNG/WebP/HEIC images are accepted' }, { status: 415 })
  }

  const safeName = (file.name || 'photo').replace(/[^\w.\-]/g, '_').slice(0, 80)
  const key = `fleet-inspections/staged/${assignment.id}/${randomUUID()}-${safeName}`
  await put(key, file, {
    access: 'private' as 'public', // established private-blob pattern
    contentType,
  })

  return NextResponse.json({ ok: true, key, filename: safeName, contentType }, { status: 201 })
}

/**
 * POST /api/fleet/inspections/[id]/photos — Sprint 2A photo upload.
 * Private Vercel Blob (established put pattern); each file becomes an
 * InspectionPhoto row. Served ONLY via the session-gated
 * /api/fleet/photos/[photoId] streaming proxy — the raw blob URL is
 * never exposed to the client.
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

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireFleetInspectionAccess()
  if (!auth.ok) return auth.response
  const { id: inspectionId } = await params

  const inspection = await prisma.inspection.findUnique({
    where: { id: inspectionId },
    select: { id: true },
  })
  if (!inspection) return NextResponse.json({ error: 'inspection not found' }, { status: 404 })

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'multipart form required' }, { status: 400 })
  }
  const file = form.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'file required' }, { status: 400 })
  if (file.size === 0) return NextResponse.json({ error: 'empty file' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'file too large (15 MB max)' }, { status: 413 })
  const contentType = file.type || 'application/octet-stream'
  if (!ALLOWED_TYPES.has(contentType)) {
    return NextResponse.json({ error: 'only JPEG/PNG/WebP/HEIC images are accepted' }, { status: 415 })
  }

  const safeName = (file.name || 'photo').replace(/[^\w.\-]/g, '_').slice(0, 80)
  const blobKey = `fleet-inspections/${inspectionId}/${randomUUID()}-${safeName}`
  const blob = await put(blobKey, file, {
    access: 'private' as 'public', // established private-blob pattern
    contentType,
  })

  const photo = await prisma.inspectionPhoto.create({
    data: {
      inspectionId,
      fileUrl: blob.url,
      filename: safeName,
      contentType,
      uploadedBy: auth.userId,
    },
    select: { id: true, filename: true },
  })

  return NextResponse.json({ ok: true, photo }, { status: 201 })
}

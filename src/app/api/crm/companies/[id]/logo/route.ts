/**
 * GET / POST / DELETE /api/crm/companies/[id]/logo — the client's own mark,
 * as it appears on their account portal.
 *
 * Wes 2026-09-04: "let's add a logo upload for each company too so it looks
 * good on their side."
 *
 * Staff-uploaded, not client-uploaded, and deliberately so: the account
 * portal is a document a client shows their own executives, and a logo is
 * the one element on it that can be wrong in a way that reads as careless.
 * A rep dropping the mark from the client's own deck is a better path than
 * a client wrestling a file picker in a portal they open twice a year.
 *
 * Storage follows the existing private-image pipeline exactly —
 * `uploadPrivateImage` in, `streamPrivateBlobAsResponse` out — so the raw
 * blob URL is never handed to a browser. Portal readers get the image
 * through the session-gated sibling at
 * /api/portal/company/[companyId]/logo; this route is the staff side.
 *
 * DELETE clears the column and leaves the blob, matching every other image
 * route here. Replacing a logo therefore leaves the old blob behind — that
 * is the house pattern, not an oversight.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { uploadPrivateImage } from '@/lib/blob/uploadPrivateImage'
import { streamPrivateBlobAsResponse } from '@/lib/claims/streamBlob'

export const dynamic = 'force-dynamic'

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/svg+xml',
])
const MAX_BYTES = 5 * 1024 * 1024 // 5 MB — a logo, not a photo shoot

async function requireUser() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return null
  return prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const company = await prisma.company.findUnique({
    where: { id: params.id },
    select: { name: true, logoUrl: true },
  })
  if (!company?.logoUrl) return NextResponse.json({ error: 'no logo on file' }, { status: 404 })
  return streamPrivateBlobAsResponse({
    fileUrl: company.logoUrl,
    filename: `${company.name.replace(/[^A-Za-z0-9._-]+/g, '-')}-logo`,
  })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const company = await prisma.company.findUnique({
    where: { id: params.id },
    select: { id: true },
  })
  if (!company) return NextResponse.json({ error: 'company not found' }, { status: 404 })

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file field required' }, { status: 400 })
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json(
      { error: `Unsupported image type "${file.type}" — use PNG, JPG, WEBP or SVG.` },
      { status: 415 },
    )
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB; the cap is 5 MB.` },
      { status: 413 },
    )
  }

  try {
    const { fileUrl } = await uploadPrivateImage({
      keyPrefix: 'company-logos',
      ownerId: params.id,
      filename: file.name || 'logo',
      contentType: file.type,
      data: Buffer.from(await file.arrayBuffer()),
    })
    const updated = await prisma.company.update({
      where: { id: params.id },
      data: { logoUrl: fileUrl, logoUploadedAt: new Date(), logoUploadedById: user.id },
      select: { id: true, logoUrl: true, logoUploadedAt: true },
    })
    return NextResponse.json({ ok: true, company: updated })
  } catch (err) {
    console.error('[company logo POST] upload failed:', err)
    return NextResponse.json(
      { error: 'Logo upload failed — retry; if it persists the blob store may be misconfigured.' },
      { status: 502 },
    )
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  await prisma.company
    .update({
      where: { id: params.id },
      data: { logoUrl: null, logoUploadedAt: null, logoUploadedById: null },
    })
    .catch(() => null)
  return NextResponse.json({ ok: true })
}

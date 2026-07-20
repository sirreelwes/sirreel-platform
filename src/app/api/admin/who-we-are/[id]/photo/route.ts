/**
 * POST /api/admin/who-we-are/[id]/photo — upload a team member's headshot to
 * the PRIVATE blob store; served back through the team-photo catalog-image
 * proxy. requireAdmin.
 */
import { NextRequest, NextResponse } from 'next/server'
import { del } from '@vercel/blob'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth-admin'
import { uploadPrivateImage } from '@/lib/blob/uploadPrivateImage'

export const dynamic = 'force-dynamic'
const MAX_BYTES = 8 * 1024 * 1024

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireAdmin()
  if (gate instanceof NextResponse) return gate

  const member = await prisma.teamMember.findUnique({ where: { id: params.id }, select: { photoUrl: true } })
  if (!member) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const form = await req.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: 'multipart form required' }, { status: 400 })
  const file = form.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'file required' }, { status: 400 })
  if (!file.type.startsWith('image/')) return NextResponse.json({ error: 'file must be an image' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'image exceeds 8 MB' }, { status: 400 })

  const data = Buffer.from(await file.arrayBuffer())
  const { fileUrl } = await uploadPrivateImage({
    keyPrefix: 'team',
    ownerId: params.id,
    filename: file.name || 'headshot.jpg',
    contentType: file.type,
    data,
  })

  const prior = member.photoUrl
  await prisma.teamMember.update({
    where: { id: params.id },
    data: { photoUrl: fileUrl, photoFilename: file.name || null },
  })
  if (prior && prior !== fileUrl) {
    try {
      await del(prior)
    } catch (err) {
      console.error('[who-we-are] prior blob delete failed:', err instanceof Error ? err.message : err)
    }
  }

  return NextResponse.json({ ok: true })
}

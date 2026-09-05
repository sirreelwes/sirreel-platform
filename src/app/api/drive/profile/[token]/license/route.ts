/** POST multipart { file, side } — the partner driver uploads one side of their licence. */
import { NextRequest, NextResponse } from 'next/server'
import { profileViewOf, saveProfileLicense, vendorDriverByProfileToken } from '@/lib/sub-rentals/vendorDrivers'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const row = await vendorDriverByProfileToken(params.token)
    if (!row) return NextResponse.json({ error: 'invalid link' }, { status: 404 })
    const form = await req.formData()
    const file = form.get('file') as File | null
    const sideRaw = String(form.get('side') ?? '')
    const side = sideRaw === 'back' ? 'back' : sideRaw === 'front' ? 'front' : null
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    if (!side) return NextResponse.json({ error: "side must be 'front' or 'back'" }, { status: 400 })
    const res = await saveProfileLicense(row.id, side, file)
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
    const fresh = await vendorDriverByProfileToken(params.token)
    return NextResponse.json({ ok: true, side, ...(fresh ? profileViewOf(fresh) : {}) })
  } catch (err) {
    console.error('[drive/profile/license]', err)
    return NextResponse.json({ error: 'Upload failed. Please try again.' }, { status: 500 })
  }
}

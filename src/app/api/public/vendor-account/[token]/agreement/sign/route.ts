/** POST /api/public/vendor-account/[token]/agreement/sign — the partner signs. */
import { NextRequest, NextResponse } from 'next/server'
import { vendorByToken, signVendorAgreement } from '@/lib/sub-rentals/vendorAccountActions'
import { checkRateLimit, clientIp } from '@/lib/portal/publicRateLimit'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  if (!checkRateLimit(`vendor-account-sign:${clientIp(req)}`).ok) return NextResponse.json({ error: 'Slow down.' }, { status: 429 })
  const v = await vendorByToken(params.token)
  if (!v) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const agreementId = typeof b.agreementId === 'string' ? b.agreementId : ''
  const signerName = typeof b.signerName === 'string' ? b.signerName.trim() : ''
  const signerTitle = typeof b.signerTitle === 'string' ? b.signerTitle.trim() || null : null
  const signerEmail = typeof b.signerEmail === 'string' ? b.signerEmail.trim().toLowerCase() : ''
  const signatureImageData = typeof b.signatureImageData === 'string' && b.signatureImageData.startsWith('data:image/png;base64,') ? b.signatureImageData : ''
  const acknowledgmentText = typeof b.acknowledgmentText === 'string' ? b.acknowledgmentText.trim() : ''
  if (!agreementId) return NextResponse.json({ error: 'agreementId is required' }, { status: 400 })
  if (!signerName) return NextResponse.json({ error: 'Type your name to sign.' }, { status: 400 })
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(signerEmail)) return NextResponse.json({ error: 'Enter your email address.' }, { status: 400 })
  if (!signatureImageData) return NextResponse.json({ error: 'Draw your signature.' }, { status: 400 })
  if (!acknowledgmentText) return NextResponse.json({ error: 'The acknowledgement is required.' }, { status: 400 })
  try {
    const r = await signVendorAgreement({
      vendorId: v.id, agreementId, signerName, signerTitle, signerEmail, signatureImageData, acknowledgmentText,
      ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || null,
      userAgent: req.headers.get('user-agent'),
    })
    return NextResponse.json({ ok: true, signedAt: r.signedAt })
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500
    if (status >= 500) console.error('[vendor agreement sign] failed:', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Signing failed' }, { status })
  }
}

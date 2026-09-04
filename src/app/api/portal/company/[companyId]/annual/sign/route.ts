/**
 * POST /api/portal/company/[companyId]/annual/sign — the executive signs
 * the annual rental agreement.
 *
 * Mirrors the per-order sign route's evidence: typed name, title, the
 * acknowledgement text as shown, the drawn signature, IP and UA. Adds the
 * LCDW election, which becomes the master's standing answer. Any active
 * portal grant on the company may sign — the grant IS the authority to act
 * for the account; that is what it was issued for.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getCompanyPortalSessionFromRequest } from '@/lib/portal/companyPortal'
import { signAnnual } from '@/lib/portal/companyAnnual'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest, { params }: { params: { companyId: string } }) {
  const session = await getCompanyPortalSessionFromRequest(req, params.companyId)
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const agreementId = typeof b.agreementId === 'string' ? b.agreementId : ''
  const signerName = typeof b.signerName === 'string' ? b.signerName.trim() : ''
  const signerTitle = typeof b.signerTitle === 'string' ? b.signerTitle.trim() || null : null
  const lcdw = b.lcdw === 'ACCEPTED' || b.lcdw === 'DECLINED' ? b.lcdw : null
  const signatureImageData = typeof b.signatureImageData === 'string' && b.signatureImageData.startsWith('data:image/png;base64,') ? b.signatureImageData : ''
  const acknowledgmentText = typeof b.acknowledgmentText === 'string' ? b.acknowledgmentText.trim() : ''

  if (!agreementId) return NextResponse.json({ error: 'agreementId is required' }, { status: 400 })
  if (!signerName) return NextResponse.json({ error: 'Type your name to sign.' }, { status: 400 })
  if (!lcdw) return NextResponse.json({ error: 'Choose Accept or Decline for the damage waiver.' }, { status: 400 })
  if (!signatureImageData) return NextResponse.json({ error: 'Draw your signature.' }, { status: 400 })
  if (!acknowledgmentText) return NextResponse.json({ error: 'The acknowledgement is required.' }, { status: 400 })

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || null
  const ua = req.headers.get('user-agent')

  try {
    const result = await signAnnual({
      agreementId,
      companyId: session.companyId,
      accessId: session.accessId,
      signerName,
      signerTitle,
      signerEmail: session.personEmail,
      lcdw,
      signatureImageData,
      acknowledgmentText,
      ipAddress: ip,
      userAgent: ua,
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500
    if (status >= 500) console.error('[portal annual sign] failed:', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Signing failed' }, { status })
  }
}

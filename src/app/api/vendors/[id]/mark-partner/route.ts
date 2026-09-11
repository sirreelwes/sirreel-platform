/**
 * POST /api/vendors/[id]/mark-partner — Wes's mark: "they replied, they are
 * a new partner."
 *
 * Wes 2026-09-11: "no company gets onboarded until they reply and I mark it
 * as a new partner." This is the mark. It seeds the starter roster from the
 * prospect registry, mints the account link, and unlocks "Email the account
 * link" (sendVendorInvite refuses before it). See partnerStage.ts.
 *
 * WES ONLY — the same allowlist as the introduction (welcomeSender.ts): it is
 * his judgement that a reply is a yes, and ADMIN would silently include Dani.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canSendPartnerWelcome } from '@/lib/sub-rentals/welcomeSender'
import { markAsPartner } from '@/lib/sub-rentals/partnerStage'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export async function POST(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email ?? null
  if (!email) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  if (!canSendPartnerWelcome(email)) return NextResponse.json({ error: 'Only Wes marks a new partner.' }, { status: 403 })
  const { id } = await params
  const u = await prisma.user.findUnique({ where: { email }, select: { id: true } })
  try {
    const r = await markAsPartner(id, { userId: u?.id ?? null, email })
    return NextResponse.json({ ok: true, ...r })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: (e as { status?: number }).status ?? 500 })
  }
}

/**
 * /api/drive/profile/[token] — the partner driver's own profile.
 *   GET  → what to show (vendor, current values, licence state, vehicles)
 *   POST { firstName, lastName, phone, trainedVehicleIds[] }
 * No login: the token is the credential, minted when the partner added them.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { profileViewOf, saveProfile, vendorDriverByProfileToken } from '@/lib/sub-rentals/vendorDrivers'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const row = await vendorDriverByProfileToken(params.token)
  if (!row) return NextResponse.json({ error: 'invalid link' }, { status: 404 })
  if (!row.profileViewedAt) {
    prisma.vendorDriver.update({ where: { id: row.id }, data: { profileViewedAt: new Date() } }).catch(() => {})
  }
  return NextResponse.json({ ok: true, ...profileViewOf(row) })
}

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const row = await vendorDriverByProfileToken(params.token)
  if (!row) return NextResponse.json({ error: 'invalid link' }, { status: 404 })
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const res = await saveProfile(row.id, body)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 })
  const fresh = await vendorDriverByProfileToken(params.token)
  return NextResponse.json({ ok: true, ...(fresh ? profileViewOf(fresh) : {}) })
}

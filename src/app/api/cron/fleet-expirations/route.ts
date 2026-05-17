import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * GET /api/cron/fleet-expirations
 *
 * Daily check (vercel.json schedule). For every active Asset with a
 * registration or BIT certificate expiring within the next 30 days, ensure
 * there's an open Alert row for fleet. Idempotent: matches on Alert.link
 * (which always points at the asset edit URL) + a type prefix, so re-runs
 * don't pile up duplicate alerts for the same asset/doc.
 *
 * Triggered manually with:
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://hq.sirreel.com/api/cron/fleet-expirations
 */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const horizon = new Date(now.getTime() + 30 * 86_400_000)

  const assets = await prisma.asset.findMany({
    where: {
      isActive: true,
      OR: [
        { registrationExpiresAt: { lte: horizon } },
        { bitCertificateExpiresAt: { lte: horizon } },
      ],
    },
    select: {
      id: true,
      unitName: true,
      make: true,
      model: true,
      licensePlate: true,
      registrationExpiresAt: true,
      bitCertificateExpiresAt: true,
    },
  })

  let createdAlerts = 0
  let skippedExisting = 0
  for (const a of assets) {
    if (a.registrationExpiresAt) {
      const created = await ensureAlert({
        asset: a,
        docKind: 'registration',
        expiresAt: a.registrationExpiresAt,
        now,
      })
      if (created) createdAlerts++
      else skippedExisting++
    }
    if (a.bitCertificateExpiresAt) {
      const created = await ensureAlert({
        asset: a,
        docKind: 'bit',
        expiresAt: a.bitCertificateExpiresAt,
        now,
      })
      if (created) createdAlerts++
      else skippedExisting++
    }
  }

  return NextResponse.json({
    ok: true,
    assetsChecked: assets.length,
    createdAlerts,
    skippedExisting,
  })
}

async function ensureAlert(args: {
  asset: {
    id: string
    unitName: string
    make: string | null
    model: string | null
    licensePlate: string | null
  }
  docKind: 'registration' | 'bit'
  expiresAt: Date
  now: Date
}): Promise<boolean> {
  const link = `/fleet/assets/${args.asset.id}`
  const typeTag = args.docKind === 'registration' ? 'fleet.registration_expiring' : 'fleet.bit_expiring'

  const existing = await prisma.alert.findFirst({
    where: {
      type: typeTag,
      link,
      // Open alerts only — we treat an Alert as "open" if no expires_at OR
      // expires_at is in the future. The cron does not auto-resolve.
      OR: [{ expires_at: null }, { expires_at: { gt: args.now } }],
    },
    select: { id: true },
  })
  if (existing) return false

  const daysLeft = Math.max(0, Math.ceil((args.expiresAt.getTime() - args.now.getTime()) / 86_400_000))
  const severity = daysLeft <= 0 ? 'critical' : daysLeft <= 7 ? 'high' : 'medium'
  const docLabel = args.docKind === 'registration' ? 'Registration' : 'BIT certificate'
  const vehicleLabel = [args.asset.make, args.asset.model].filter(Boolean).join(' ') || args.asset.unitName
  const plate = args.asset.licensePlate ? ` (${args.asset.licensePlate})` : ''

  await prisma.alert.create({
    data: {
      type: typeTag,
      title:
        daysLeft <= 0
          ? `${docLabel} EXPIRED — ${vehicleLabel}${plate}`
          : `${docLabel} expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'} — ${vehicleLabel}${plate}`,
      body: `Asset ${args.asset.unitName}${plate}: ${docLabel} ${
        daysLeft <= 0 ? 'has expired' : `expires on ${args.expiresAt.toISOString().slice(0, 10)}`
      }. Update the document on the asset record to clear this alert.`,
      severity,
      link,
      expires_at: args.expiresAt,
    },
  })
  return true
}

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  const auth = req.headers.get('authorization') || ''
  return auth === `Bearer ${secret}`
}

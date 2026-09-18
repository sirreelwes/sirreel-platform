import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { syncInventoryUnits } from '@/lib/rentalworks/syncInventoryUnits'
import { isRwAuthError } from '@/lib/rentalworks/rwClient'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * GET /api/cron/rw-inventory-units — nightly mirror of RentalWorks'
 * per-unit barcode register into `sr_inventory_units`.
 *
 * Read-only against RW and additive on our side (see syncInventoryUnits:
 * upsert, never delete). Nothing on the warehouse floor changes because
 * of this route — it exists so a scanned barcode can be resolved to a
 * catalog row, and so a damage claim can name a replacement cost for the
 * exact unit rather than a catalog average.
 *
 * Two callers:
 *   - Vercel cron, nightly, with `Authorization: Bearer $CRON_SECRET`.
 *   - A signed-in warehouse/admin user, for an on-demand refresh after
 *     RW receives new gear (no waiting a day to scan a new label).
 *
 * Manual run:
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *     https://hq.sirreel.com/api/cron/rw-inventory-units
 *
 * An expired RW credential returns 502 with the rotation instruction
 * rather than a cheerful zero — the same rule the invoice mirror
 * follows, because a dead token that reads as "no inventory" is exactly
 * how a silent degradation starts.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  const isCron = !!secret && auth === `Bearer ${secret}`

  if (!isCron) {
    const session = await getServerSession()
    const email = session?.user?.email?.toLowerCase()
    if (!email) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    const user = await prisma.user.findUnique({
      where: { email },
      select: { role: true, isActive: true },
    })
    if (!user?.isActive || !['ADMIN', 'MANAGER', 'WAREHOUSE'].includes(user.role)) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
  }

  try {
    const { ok, ...report } = await syncInventoryUnits()
    if (!ok) {
      return NextResponse.json({ ok: false, ...report }, { status: 502 })
    }
    return NextResponse.json({
      ok: true,
      ...report,
      // Named explicitly so the response reads as a report rather than a
      // row count: unmatched ICodes are the one thing here a human has
      // to act on.
      note: report.unmatched || report.stranded
        ? [
            report.unmatched
              ? `${report.unmatched} unit(s) on ${report.unmatchedICodes.length} RW item code(s) have no HQ catalog row`
              : '',
            // The quiet one: matched, but to a row nobody can order, so
            // the barcode still has nowhere to land (2026-09-18).
            report.stranded
              ? `${report.stranded} unit(s) on ${report.strandedICodes.length} code(s) resolve to an ARCHIVED row (${report.strandedICodes.join(', ')})`
              : '',
          ].filter(Boolean).join(' · ') + ' — they will not resolve on a scan until matched. See scripts/link-barcoded-catalog-rows.ts.'
        : 'Every unit resolved to an orderable HQ catalog row.',
      // Ours, barcoded, never rented — listed so the count is visible and
      // nobody goes looking for a catalog row that should not exist.
      ...(report.notRentalStockICodes.length
        ? { notRentalStock: report.notRentalStockICodes }
        : {}),
    })
  } catch (e) {
    if (isRwAuthError(e) || (e as Error)?.name === 'RwNoCredentialError') {
      return NextResponse.json(
        { ok: false, error: 'rw_credential', reason: (e as Error).message },
        { status: 502 },
      )
    }
    throw e
  }
}

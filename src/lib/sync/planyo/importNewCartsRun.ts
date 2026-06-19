/**
 * Daily new-cart importer pass. Runs after `runSync`'s maintenance
 * apply; appends its events to the same `PlanyoSyncRun` (audit row)
 * by `runId` so a single cron tick = one audit row.
 *
 * Policy (ratified):
 *   - CLEAN_MATCH, PARTIAL_CO_ONLY (with email), PARTIAL_PERSON_ONLY,
 *     WOULD_CREATE (with email) → AUTO apply via `applyCartImport`.
 *   - MULTI_MATCH_CO, WOULD_CREATE (no email) → FLAGGED. Log only;
 *     never auto-create. The Slack alert routes flagged carts to a
 *     human.
 *   - Cancelled (Planyo `user_text` says cancelled) → silent skip;
 *     same posture as the CREATE-probe in `runSync`. No self-made
 *     phantom holds.
 *   - Past-only carts (no line with `endDate >= today`) → skipped;
 *     daily cron handles the live book only. Backfilling past-only
 *     carts is a separate authorized action.
 *
 * NEW vs REPEAT classification on FLAGGED carts (for the Slack
 * builder): we query `PlanyoSyncEvent` for prior `[NEW_CART_FLAGGED]`
 * events on the same `planyoCartId` from a PRIOR run. First-time
 * flagged → grabs attention. Already-flagged-before → still in the
 * rollup count, no repeated detail. Suppresses the daily-repeat
 * fatigue pattern (the failure mode for a shared alert channel —
 * trained-to-ignore is how a real RELEASE_CANDIDATE gets missed).
 *
 * Per-cart error isolation: one bad applyCartImport doesn't tank the
 * batch. Errors are surfaced in the result so the cron can report
 * them in Slack alongside flags.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { listReservationsFull, getReservationData } from './planyoClient'
import {
  isReservationCancelled,
  IGNORED_PLANYO_RESOURCE_IDS,
} from './reconcile'
import { companyNameKey } from '@/lib/companies/normalize'
import { buildResourceCrosswalk } from './resourceCrosswalk'
import {
  planCartImport,
  applyCartImport,
  type CartImportPlan,
} from './importNewCart'

export interface FlaggedNewCart {
  cart: string
  bucket: 'MULTI_MATCH_CO' | 'WOULD_CREATE'
  /** Both "MULTI_MATCH_CO" and "WOULD_CREATE w/o email" share this
   *  FLAGGED-flow. Tag distinguishes them for the Slack builder. */
  flagKind: 'multi_match_co' | 'no_email_anchor'
  cartCompanyName: string
  cartCustomerName: string
  cartCustomerEmail: string
  flagReasons: string[]
  candidates?: { id: string; name: string }[]
  /** First time we ever flagged this cart, by createdAt. null on the
   *  first run that sees it; populated on subsequent runs. The Slack
   *  builder uses this to split NEW vs REPEAT and to compute the
   *  "oldest flagged YYYY-MM-DD" rollup. */
  firstFlaggedAt: Date | null
}

export interface NewCartImportRunResult {
  imported: number
  flagged: FlaggedNewCart[]
  skippedCancelled: number
  skippedPastOnly: number
  skippedNoiseOnly: number
  candidatesConsidered: number
  errors: Array<{ cart: string; error: string }>
  /** Wall-clock duration of this pass. Logged so creep is visible
   *  without needing a separate metrics surface. */
  durationMs: number
}

export interface ImportNewCartsRunOpts {
  /** Audit run to append events to. Should be `apply.runId` from the
   *  caller's two-phase runSync so the cron tick is one audit row. */
  runId: string
  dryRun: boolean
  windowStart?: Date
  windowEnd?: Date
}

const FLAGGED_DETAIL_PREFIX = '[NEW_CART_FLAGGED]'
const IMPORT_DETAIL_PREFIX = '[NEW_CART_IMPORT cron]'

export async function importNewCartsRun(
  opts: ImportNewCartsRunOpts,
): Promise<NewCartImportRunResult> {
  const start = Date.now()
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const windowStart = opts.windowStart ?? offsetDate(today, -30)
  const windowEnd = opts.windowEnd ?? offsetDate(today, 90)
  const todayStr = today.toISOString().slice(0, 10)

  const result: NewCartImportRunResult = {
    imported: 0,
    flagged: [],
    skippedCancelled: 0,
    skippedPastOnly: 0,
    skippedNoiseOnly: 0,
    candidatesConsidered: 0,
    errors: [],
    durationMs: 0,
  }

  // 1. Own pull. Daily, an extra Planyo windowed call is cheap.
  const pull = await listReservationsFull({ windowStart, windowEnd })
  if (!pull.ok) {
    result.errors.push({ cart: '*', error: `pull failed: ${pull.reason} — ${pull.detail}` })
    result.durationMs = Date.now() - start
    return result
  }

  // 2. Out-of-scope candidate set
  const hqBookings = await prisma.booking.findMany({
    where: { source: 'PLANYO_BACKFILL', planyoCartId: { not: null } },
    select: { planyoCartId: true },
  })
  const inScopeCarts = new Set(hqBookings.map((b) => b.planyoCartId!))

  const byCart = new Map<string, typeof pull.results>()
  for (const r of pull.results) {
    const c = String(r.cart_id ?? '')
    if (!c) continue
    if (inScopeCarts.has(c)) continue
    const a = byCart.get(c) ?? []
    a.push(r)
    byCart.set(c, a)
  }

  // Noise-only filter (all lines on IGNORED_PLANYO_RESOURCE_IDS)
  const realCarts = new Map<string, typeof pull.results>()
  for (const [c, lines] of byCart.entries()) {
    const allNoise = lines.every((l) =>
      IGNORED_PLANYO_RESOURCE_IDS.has(parseInt(String(l.resource_id ?? 0), 10)),
    )
    if (allNoise) {
      result.skippedNoiseOnly++
      continue
    }
    realCarts.set(c, lines)
  }

  // Future-active filter (≥1 line with endDate >= today)
  const liveCarts = new Map<string, typeof pull.results>()
  for (const [c, lines] of realCarts.entries()) {
    const hasFuture = lines.some((l) => (l.end_time ?? '').slice(0, 10) >= todayStr)
    if (!hasFuture) {
      result.skippedPastOnly++
      continue
    }
    liveCarts.set(c, lines)
  }
  result.candidatesConsidered = liveCarts.size

  if (liveCarts.size === 0) {
    result.durationMs = Date.now() - start
    return result
  }

  // 3. Cancellation probe (silent skip — same posture as the CREATE-probe in runSync)
  const cancelled = new Set<string>()
  const ids = [...liveCarts.keys()]
  for (let i = 0; i < ids.length; i += 10) {
    const batch = ids.slice(i, i + 10)
    const r = await Promise.all(
      batch.map(async (c) => {
        const head = liveCarts.get(c)![0]
        const d = await getReservationData(String(head.reservation_id))
        return { cart: c, cancelled: d.ok && isReservationCancelled(d.data) }
      }),
    )
    for (const x of r) if (x.cancelled) cancelled.add(x.cart)
  }
  result.skippedCancelled = cancelled.size
  for (const c of cancelled) liveCarts.delete(c)

  if (liveCarts.size === 0) {
    result.durationMs = Date.now() - start
    return result
  }

  // 4. Resolution context
  const crosswalk = await buildResourceCrosswalk(prisma)
  const companies = await prisma.company.findMany({ select: { id: true, name: true } })
  const companiesByKey = new Map<string, Array<{ id: string; name: string }>>()
  for (const co of companies) {
    const k = companyNameKey(co.name)
    if (!k) continue
    const a = companiesByKey.get(k) ?? []
    a.push({ id: co.id, name: co.name })
    companiesByKey.set(k, a)
  }
  const unassigned = await prisma.user.findFirst({
    where: { email: 'unassigned@sirreel.com' },
    select: { id: true, name: true },
  })
  if (!unassigned) {
    result.errors.push({ cart: '*', error: 'Unassigned sentinel user not found' })
    result.durationMs = Date.now() - start
    return result
  }

  // 5. Per-cart plan + apply or flag
  for (const [cart, lines] of liveCarts.entries()) {
    try {
      const plan = await planCartImport(
        { cart, lines, crosswalk },
        { prisma, companiesByKey, unassignedAgent: unassigned },
      )

      if (plan.status === 'AUTO') {
        if (!opts.dryRun) {
          const r = await applyCartImport(plan, prisma, makeBookingNumberGenerator())
          await writeImportEvent(opts.runId, cart, plan, r.bookingId)
        }
        result.imported++
      } else {
        // FLAGGED — log only. Look up the earliest prior flag on this
        // cart so the Slack builder can split NEW vs REPEAT.
        const prior = await prisma.planyoSyncEvent.findFirst({
          where: {
            planyoCartId: cart,
            detail: { startsWith: FLAGGED_DETAIL_PREFIX },
            runId: { not: opts.runId },
          },
          orderBy: { createdAt: 'asc' },
          select: { createdAt: true },
        })

        const flagKind: FlaggedNewCart['flagKind'] =
          plan.bucket === 'MULTI_MATCH_CO' ? 'multi_match_co' : 'no_email_anchor'

        await writeFlagEvent(opts.runId, cart, plan, flagKind)

        result.flagged.push({
          cart,
          bucket: plan.bucket as 'MULTI_MATCH_CO' | 'WOULD_CREATE',
          flagKind,
          cartCompanyName: plan.cartCompanyName,
          cartCustomerName: plan.cartCustomerName,
          cartCustomerEmail: plan.cartCustomerEmail,
          flagReasons: plan.flagReasons,
          candidates: plan.multiMatchCandidates,
          firstFlaggedAt: prior?.createdAt ?? null,
        })
      }
    } catch (e) {
      result.errors.push({ cart, error: (e as Error).message })
    }
  }

  result.durationMs = Date.now() - start
  return result
}

async function writeImportEvent(
  runId: string,
  cart: string,
  plan: CartImportPlan,
  bookingId: string,
): Promise<void> {
  await prisma.planyoSyncEvent.create({
    data: {
      runId,
      op: 'CREATE',
      planyoCartId: cart,
      bookingId,
      after: {
        cronImport: true,
        cart,
        bucket: plan.bucket,
        createdBookingId: bookingId,
        resolvedCompany: plan.resolvedCompany,
        resolvedPerson: plan.resolvedPerson,
        bookingDraft: plan.bookingDraft,
        bookingItemDrafts: plan.bookingItemDrafts,
        reservationDrafts: plan.reservationDrafts,
        cartCustomerName: plan.cartCustomerName,
        cartCustomerEmail: plan.cartCustomerEmail,
        cartCompanyName: plan.cartCompanyName,
      } as unknown as Prisma.InputJsonValue,
      detail: `${IMPORT_DETAIL_PREFIX} cart=${cart} bucket=${plan.bucket} bookingId=${bookingId.slice(0, 8)}`,
    },
  })
}

async function writeFlagEvent(
  runId: string,
  cart: string,
  plan: CartImportPlan,
  flagKind: 'multi_match_co' | 'no_email_anchor',
): Promise<void> {
  await prisma.planyoSyncEvent.create({
    data: {
      runId,
      op: 'NO_CHANGE',
      planyoCartId: cart,
      detail: `${FLAGGED_DETAIL_PREFIX} cart=${cart} kind=${flagKind} bucket=${plan.bucket} reasons=${plan.flagReasons.join(' ; ')}`,
      after: {
        flagKind,
        bucket: plan.bucket,
        cartCompanyName: plan.cartCompanyName,
        cartCustomerName: plan.cartCustomerName,
        cartCustomerEmail: plan.cartCustomerEmail,
        flagReasons: plan.flagReasons,
        candidates: plan.multiMatchCandidates ?? [],
      } as unknown as Prisma.InputJsonValue,
    },
  })
}

function makeBookingNumberGenerator(): () => Promise<string> {
  const year = new Date().getUTCFullYear()
  return async function nextBookingNumber(): Promise<string> {
    for (let i = 0; i < 50; i++) {
      const n = String(Math.floor(1000 + Math.random() * 9000))
      const candidate = `SR-PB-${year}-${n}`
      const exists = await prisma.booking.findUnique({
        where: { bookingNumber: candidate },
        select: { id: true },
      })
      if (!exists) return candidate
    }
    throw new Error('exhausted bookingNumber attempts')
  }
}

function offsetDate(d: Date, days: number): Date {
  const r = new Date(d)
  r.setUTCDate(r.getUTCDate() + days)
  return r
}

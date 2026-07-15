/**
 * Planyo new-cart importer.
 *
 * For each out-of-scope cart (no PLANYO_BACKFILL Booking yet), plan the
 * full mirror into HQ:
 *   - Booking (source=PLANYO_BACKFILL, planyoCartId={cart}, scope-guarded
 *     identically to the May backfill set)
 *   - BookingItem rows (one per AssetCategory, qty = sum of lines)
 *   - Reservation rows (one per Planyo line, full fidelity for the mirror)
 *
 * CRM resolution policy (buyer-visible, conservative):
 *   - CLEAN_MATCH         → reuse Co + Person; create Affiliation if missing
 *   - PARTIAL_CO_ONLY     → reuse Co; create Person; create Affiliation
 *   - PARTIAL_PERSON_ONLY → reuse Person; create Co (tagged
 *                            planyo-import-origin via Company.notes); create
 *                            Affiliation
 *   - MULTI_MATCH_CO      → FLAG, import NOTHING
 *   - WOULD_CREATE w/email→ create Co + Person + Affiliation
 *   - WOULD_CREATE no-email→ FLAG (no dedup anchor)
 *
 * Cancellation gate: cartIsCancelled() must be FALSE for any plan to be
 * returned with status=AUTO. Cancelled carts are skipped at the
 * orchestrator level — this module returns plans for "should import"
 * carts only.
 *
 * Dry-run vs apply: `planCartImport` does DB READS only and returns the
 * full plan. `applyCartImport` (separate function) performs the writes
 * inside one transaction, gated by the plan's status === 'AUTO'.
 */

import type { PrismaClient } from '@prisma/client'
import { companyNameKey } from '@/lib/companies/normalize'
import {
  laDateToDbDate,
  laDateStartToUTC,
  laDateEndToUTC,
  planyoLocalTimeToLADate,
} from './dateConvention'
import type { PlanyoLine } from './planyoClient'
import { normalizePlanyoUnitName } from '@/lib/scheduling/planyoNameNormalizer'

export type CrmBucket =
  | 'CLEAN_MATCH'
  | 'PARTIAL_CO_ONLY'
  | 'PARTIAL_PERSON_ONLY'
  | 'MULTI_MATCH_CO'
  | 'WOULD_CREATE'

export type ImportStatus = 'AUTO' | 'FLAGGED'

export interface ResolvedSide {
  id: string
  name: string
}

export interface PersonDraft {
  firstName: string
  lastName: string
  email: string
  phone: string | null
}

export interface CompanyDraft {
  name: string
  notesTag: string // "planyo-import-origin: cart 5640555 (2026-06-18)"
}

export interface BookingDraft {
  planyoCartId: string
  source: 'PLANYO_BACKFILL'
  bookingNumberHint: string // proposed but not committed — apply path generates unique
  jobName: string
  productionName: string | null
  startLA: string
  endLA: string
  status: 'PENDING_APPROVAL' | 'CONFIRMED' | 'REQUEST'
  agentMatchedFrom: string
  agentResolved: ResolvedSide | null
  agentFallbackUsed: boolean
  notes: string | null
}

export interface BookingItemDraft {
  categoryId: string
  categoryName: string
  quantity: number
  dailyRate: number
  lineCount: number // number of Planyo lines feeding this hold
}

/**
 * Per-line unit binding resolved at PLAN time from Planyo's
 * `unit_assignment` (Planyo resources are per-category; the physical
 * unit rides in this string). Applied as a native BookingAssignment —
 * the durable record that survives Planyo's retirement. Lines that
 * don't resolve import exactly as before (item stays REQUESTED) plus
 * a log line.
 */
export interface UnitBindingDraft {
  planyoReservationId: string
  categoryId: string
  categoryName: string
  rawUnit: string
  normalizedUnit: string
  isBackupHold: boolean
  startLA: string
  endLA: string
}

export interface ReservationDraft {
  planyoReservationId: string
  planyoCartId: string
  unitName: string
  category: string
  startLA: string
  endLA: string
  planyoCompany: string | null
  planyoJobName: string | null
  planyoAgent: string | null
  planyoCustomerName: string | null
  planyoCustomerEmail: string | null
  planyoCustomerPhone: string | null
  notes: string | null
}

export interface CartImportPlan {
  cart: string
  status: ImportStatus
  flagReasons: string[]
  bucket: CrmBucket
  // CRM resolution
  resolvedCompany: ResolvedSide | { create: CompanyDraft } | null
  resolvedPerson: ResolvedSide | { create: PersonDraft } | null
  affiliationToCreate: boolean
  // Booking + holds
  bookingDraft: BookingDraft
  bookingItemDrafts: BookingItemDraft[]
  reservationDrafts: ReservationDraft[]
  unitBindingDrafts: UnitBindingDraft[]
  // Surfaced metadata
  cartCustomerName: string
  cartCustomerEmail: string
  cartCompanyName: string
  multiMatchCandidates?: ResolvedSide[] // for MULTI_MATCH_CO
}

interface PlanInputs {
  cart: string
  lines: PlanyoLine[]
  /** Map of resource_id → AssetCategory {id, name, dailyRate}.
   *  Lines on resources not in this map are skipped at the hold level
   *  (they'd be FLAG_UNMAPPED in the sync). */
  crosswalk: Map<number, { id: string; name: string; dailyRate: number }>
}

interface PlanDeps {
  prisma: PrismaClient
  /** Pre-loaded Company list, indexed by companyNameKey for fast lookup.
   *  Built once per dry-run/apply pass. */
  companiesByKey: Map<string, ResolvedSide[]>
  /** Sentinel User used when Planyo's `SirReel_Agent` property doesn't
   *  match any active User by firstName. Misattributing to the owner is
   *  buyer-visible-wrong; the Unassigned sentinel keeps the FK satisfied
   *  while making the lack-of-attribution obvious in the CRM. */
  unassignedAgent: ResolvedSide
}

export async function planCartImport(
  inputs: PlanInputs,
  deps: PlanDeps,
): Promise<CartImportPlan> {
  const { cart, lines, crosswalk } = inputs
  const { prisma, companiesByKey, unassignedAgent } = deps

  // ── Cart-level customer info (lines on a cart share customer fields) ──
  const head = lines[0]
  const props = (head.properties || {}) as Record<string, string | undefined>
  const customerEmail = (head.email || '').trim().toLowerCase()
  const customerFirst = (head.first_name || '').trim()
  const customerLast = (head.last_name || '').trim()
  const customerPhone = (head.phone || '').trim()
  const cartCompanyName =
    (props.Company_Name || '').trim() ||
    `${customerFirst} ${customerLast}`.trim() ||
    '(unknown)'
  const jobNameRaw = (props.Job_Name || '').trim()
  const agentNameFromPlanyo = (props.SirReel_Agent || '').trim()

  // ── Company resolution ──
  const coKey = companyNameKey(cartCompanyName)
  const coMatches: ResolvedSide[] = coKey ? companiesByKey.get(coKey) ?? [] : []

  // ── Person resolution ──
  let personMatch: ResolvedSide | null = null
  if (customerEmail) {
    const direct = await prisma.person.findFirst({
      where: { email: { equals: customerEmail, mode: 'insensitive' } },
      select: { id: true, firstName: true, lastName: true },
    })
    if (direct) {
      personMatch = { id: direct.id, name: `${direct.firstName} ${direct.lastName}`.trim() }
    } else {
      const alias = await prisma.personEmailAlias.findFirst({
        where: { email: { equals: customerEmail, mode: 'insensitive' } },
        select: { personId: true },
      })
      if (alias) {
        const survivor = await prisma.person.findUnique({
          where: { id: alias.personId },
          select: { id: true, firstName: true, lastName: true },
        })
        if (survivor) {
          personMatch = {
            id: survivor.id,
            name: `${survivor.firstName} ${survivor.lastName}`.trim(),
          }
        }
      }
    }
  }

  // ── Bucket + status decision ──
  let bucket: CrmBucket
  let status: ImportStatus = 'AUTO'
  const flagReasons: string[] = []
  let resolvedCompany: CartImportPlan['resolvedCompany'] = null
  let resolvedPerson: CartImportPlan['resolvedPerson'] = null
  let multiMatchCandidates: ResolvedSide[] | undefined

  if (coMatches.length > 1) {
    bucket = 'MULTI_MATCH_CO'
    status = 'FLAGGED'
    flagReasons.push(
      `${coMatches.length} Company candidates for "${cartCompanyName}" (key="${coKey}") — needs human pick or merge`,
    )
    multiMatchCandidates = coMatches
  } else if (coMatches.length === 1 && personMatch) {
    bucket = 'CLEAN_MATCH'
    resolvedCompany = coMatches[0]
    resolvedPerson = personMatch
  } else if (coMatches.length === 1 && !personMatch) {
    bucket = 'PARTIAL_CO_ONLY'
    resolvedCompany = coMatches[0]
    if (customerEmail) {
      resolvedPerson = {
        create: {
          firstName: customerFirst || '(unknown)',
          lastName: customerLast || '',
          email: customerEmail,
          phone: customerPhone || null,
        },
      }
    } else {
      status = 'FLAGGED'
      flagReasons.push('PARTIAL_CO_ONLY but customer has no email — no Person dedup anchor')
    }
  } else if (coMatches.length === 0 && personMatch) {
    bucket = 'PARTIAL_PERSON_ONLY'
    resolvedPerson = personMatch
    resolvedCompany = {
      create: {
        name: cartCompanyName,
        notesTag: `planyo-import-origin: cart ${cart} (${new Date().toISOString().slice(0, 10)})`,
      },
    }
  } else {
    // both new — WOULD_CREATE
    bucket = 'WOULD_CREATE'
    if (!customerEmail) {
      status = 'FLAGGED'
      flagReasons.push('WOULD_CREATE but customer has no email — no dedup anchor, future-dupe risk')
    } else {
      resolvedCompany = {
        create: {
          name: cartCompanyName,
          notesTag: `planyo-import-origin: cart ${cart} (${new Date().toISOString().slice(0, 10)})`,
        },
      }
      resolvedPerson = {
        create: {
          firstName: customerFirst || '(unknown)',
          lastName: customerLast || '',
          email: customerEmail,
          phone: customerPhone || null,
        },
      }
    }
  }

  // ── Agent resolution (best-effort firstName match, fallback to default) ──
  let agentResolved: ResolvedSide | null = null
  let agentFallbackUsed = false
  if (agentNameFromPlanyo) {
    const u = await prisma.user.findFirst({
      where: { name: { startsWith: agentNameFromPlanyo, mode: 'insensitive' }, isActive: true },
      select: { id: true, name: true },
    })
    if (u) agentResolved = { id: u.id, name: u.name }
  }
  if (!agentResolved) {
    agentResolved = unassignedAgent
    agentFallbackUsed = true
  }

  // ── Booking envelope (LA-canonical dates) ──
  const lineStarts = lines.map((l) => planyoLocalTimeToLADate(l.start_time)).filter(Boolean) as string[]
  const lineEnds = lines.map((l) => planyoLocalTimeToLADate(l.end_time)).filter(Boolean) as string[]
  const startLA = lineStarts.length ? lineStarts.reduce((a, b) => (a < b ? a : b)) : new Date().toISOString().slice(0, 10)
  const endLA = lineEnds.length ? lineEnds.reduce((a, b) => (a > b ? a : b)) : startLA

  // Policy: every imported cart lands at CONFIRMED. We don't trust
  // Planyo's per-line status field (it's the dead canary that doesn't
  // even reflect cancellation reliably). Cancellation is already
  // filtered upstream; everything that makes it here is a real cart
  // we're mirroring. Operators downgrade in HQ if needed.
  const bookingStatus: BookingDraft['status'] = 'CONFIRMED'

  const bookingDraft: BookingDraft = {
    planyoCartId: cart,
    source: 'PLANYO_BACKFILL',
    bookingNumberHint: `SR-PB-${new Date().getUTCFullYear()}-NEW`,
    jobName: jobNameRaw || `Planyo import — cart ${cart}`,
    productionName: jobNameRaw || null,
    startLA,
    endLA,
    status: bookingStatus,
    agentMatchedFrom: agentNameFromPlanyo,
    agentResolved,
    agentFallbackUsed,
    notes: head.user_notes || null,
  }

  // ── BookingItem aggregation (group lines by AssetCategory) ──
  const byCategory = new Map<string, BookingItemDraft>()
  const unitBindingDrafts: UnitBindingDraft[] = []
  for (const l of lines) {
    const resId = parseInt(String(l.resource_id ?? 0), 10)
    const cat = crosswalk.get(resId)
    if (!cat) continue // skip lines on unmapped resources at this layer; orchestrator may FLAG separately
    const existing = byCategory.get(cat.id)
    if (existing) {
      existing.quantity += 1
      existing.lineCount += 1
    } else {
      byCategory.set(cat.id, {
        categoryId: cat.id,
        categoryName: cat.name,
        quantity: 1,
        dailyRate: cat.dailyRate,
        lineCount: 1,
      })
    }
    // Per-line unit identity → native assignment draft. Resolution to
    // an Asset row happens at apply time (needs the DB); the plan just
    // carries the normalized candidate.
    const rawUnit = (l.unit_assignment ?? '').trim()
    if (rawUnit) {
      const { normalized, isBackupHold } = normalizePlanyoUnitName(rawUnit, cat.name)
      unitBindingDrafts.push({
        planyoReservationId: String(l.reservation_id),
        categoryId: cat.id,
        categoryName: cat.name,
        rawUnit,
        normalizedUnit: normalized,
        isBackupHold,
        startLA: planyoLocalTimeToLADate(l.start_time) ?? startLA,
        endLA: planyoLocalTimeToLADate(l.end_time) ?? endLA,
      })
    }
  }
  const bookingItemDrafts = [...byCategory.values()]

  // ── Reservation drafts (mirror, one per Planyo line) ──
  const reservationDrafts: ReservationDraft[] = lines.map((l) => {
    const lStart = planyoLocalTimeToLADate(l.start_time) ?? startLA
    const lEnd = planyoLocalTimeToLADate(l.end_time) ?? endLA
    return {
      planyoReservationId: String(l.reservation_id),
      planyoCartId: cart,
      unitName: l.unit_assignment ?? l.name ?? '?',
      category: l.name ?? '?',
      startLA: lStart,
      endLA: lEnd,
      planyoCompany: (l.properties?.Company_Name ?? null) || null,
      planyoJobName: (l.properties?.Job_Name ?? null) || null,
      planyoAgent: (l.properties?.SirReel_Agent ?? null) || null,
      planyoCustomerName:
        `${l.first_name ?? ''} ${l.last_name ?? ''}`.trim() || null,
      planyoCustomerEmail: l.email ?? null,
      planyoCustomerPhone: l.phone ?? null,
      notes: l.user_notes ?? null,
    }
  })

  return {
    cart,
    status,
    flagReasons,
    bucket,
    resolvedCompany,
    resolvedPerson,
    affiliationToCreate: status === 'AUTO',
    bookingDraft,
    bookingItemDrafts,
    reservationDrafts,
    unitBindingDrafts,
    cartCustomerName: `${customerFirst} ${customerLast}`.trim(),
    cartCustomerEmail: customerEmail,
    cartCompanyName,
    multiMatchCandidates,
  }
}

/**
 * Apply path — writes the plan into HQ. NOT called by today's dry-run.
 * Documented + tsc-clean so the apply path is reviewable; gated on
 * `plan.status === 'AUTO'`.
 *
 * Returns { bookingId } on success. Throws on any guard failure.
 */
export async function applyCartImport(
  plan: CartImportPlan,
  prisma: PrismaClient,
  bookingNumberGenerator: () => Promise<string>,
): Promise<{ bookingId: string }> {
  if (plan.status !== 'AUTO') {
    throw new Error(`applyCartImport: plan ${plan.cart} status=${plan.status}, refusing to import`)
  }
  if (plan.bucket === 'MULTI_MATCH_CO') {
    throw new Error(`applyCartImport: plan ${plan.cart} bucket=MULTI_MATCH_CO, never auto-imports`)
  }
  if (!plan.resolvedCompany || !plan.resolvedPerson) {
    throw new Error(`applyCartImport: plan ${plan.cart} missing resolvedCompany/resolvedPerson`)
  }
  if (!plan.bookingDraft.agentResolved) {
    throw new Error(`applyCartImport: plan ${plan.cart} missing resolved agent`)
  }

  return prisma.$transaction(async (tx) => {
    // 1. Resolve / create Company
    let companyId: string
    if ('id' in plan.resolvedCompany!) {
      companyId = plan.resolvedCompany!.id
    } else {
      const created = await tx.company.create({
        data: {
          name: plan.resolvedCompany!.create.name,
          notes: plan.resolvedCompany!.create.notesTag,
        },
        select: { id: true },
      })
      companyId = created.id
    }

    // 2. Resolve / create Person
    let personId: string
    if ('id' in plan.resolvedPerson!) {
      personId = plan.resolvedPerson!.id
    } else {
      const created = await tx.person.create({
        data: {
          firstName: plan.resolvedPerson!.create.firstName,
          lastName: plan.resolvedPerson!.create.lastName,
          email: plan.resolvedPerson!.create.email,
          phone: plan.resolvedPerson!.create.phone,
        },
        select: { id: true },
      })
      personId = created.id
    }

    // 3. Ensure Affiliation
    const aff = await tx.affiliation.findFirst({
      where: { personId, companyId },
      select: { id: true },
    })
    if (!aff) {
      await tx.affiliation.create({
        data: { personId, companyId, isCurrent: true },
      })
    }

    // 4. Create Booking
    const bd = plan.bookingDraft
    const booking = await tx.booking.create({
      data: {
        bookingNumber: await bookingNumberGenerator(),
        companyId,
        personId,
        agentId: bd.agentResolved!.id,
        jobName: bd.jobName,
        productionName: bd.productionName,
        startDate: laDateToDbDate(bd.startLA),
        endDate: laDateToDbDate(bd.endLA),
        status: bd.status,
        source: 'PLANYO_BACKFILL',
        planyoCartId: bd.planyoCartId,
        notes: bd.notes,
      },
      select: { id: true },
    })

    // 5. BookingItem rows (ids captured for unit binding below)
    const itemByCategory = new Map<string, { id: string; quantity: number; assigned: number }>()
    for (const item of plan.bookingItemDrafts) {
      const created = await tx.bookingItem.create({
        data: {
          bookingId: booking.id,
          categoryId: item.categoryId,
          quantity: item.quantity,
          dailyRate: item.dailyRate,
          status: 'REQUESTED',
          holdRank: 1,
        },
        select: { id: true },
      })
      itemByCategory.set(item.categoryId, { id: created.id, quantity: item.quantity, assigned: 0 })
    }

    // 5b. Native unit binding — Planyo's per-line unit_assignment
    // resolved to an Asset and written as a BookingAssignment (the
    // durable native record; survives Planyo's retirement). Any line
    // that doesn't resolve imports exactly as before — item stays
    // REQUESTED — plus a log line. Backup holds (2ND/3RD HOLD) are
    // never auto-bound; promotion is a manual operator action.
    for (const b of plan.unitBindingDrafts) {
      const slot = itemByCategory.get(b.categoryId)
      if (!slot) continue
      if (b.isBackupHold) {
        console.log(`[planyo-import] cart ${plan.cart}: backup hold "${b.rawUnit}" (${b.categoryName}) left unbound — manual promotion path`)
        continue
      }
      const assets = await tx.asset.findMany({
        where: { categoryId: b.categoryId, unitName: b.normalizedUnit, isActive: true },
        select: { id: true },
      })
      if (assets.length !== 1) {
        console.log(`[planyo-import] cart ${plan.cart}: unit "${b.rawUnit}" → "${b.normalizedUnit}" matched ${assets.length} assets in ${b.categoryName} — left unassigned`)
        continue
      }
      if (slot.assigned >= slot.quantity) {
        console.log(`[planyo-import] cart ${plan.cart}: item ${b.categoryName} already at capacity (${slot.quantity}) — skipping bind of "${b.rawUnit}"`)
        continue
      }
      await tx.bookingAssignment.create({
        data: {
          bookingItemId: slot.id,
          assetId: assets[0].id,
          startDate: laDateToDbDate(b.startLA),
          endDate: laDateToDbDate(b.endLA),
          status: 'ASSIGNED',
        },
      })
      slot.assigned += 1
    }
    // Flip items to ASSIGNED only on FULL coverage — partial coverage
    // stays REQUESTED so the stale-holds worklist still surfaces it
    // (same rule as POST /booking-items/[id]/assign).
    for (const slot of itemByCategory.values()) {
      if (slot.assigned >= slot.quantity && slot.assigned > 0) {
        await tx.bookingItem.update({ where: { id: slot.id }, data: { status: 'ASSIGNED' } })
      }
    }

    // 6. Reservation rows (mirror)
    for (const r of plan.reservationDrafts) {
      await tx.reservation.create({
        data: {
          bookingId: booking.id,
          unitName: r.unitName,
          category: r.category,
          startTime: laDateStartToUTC(r.startLA),
          endTime: laDateEndToUTC(r.endLA),
          status: 'HOLD',
          source: 'PLANYO',
          planyoReservationId: r.planyoReservationId,
          planyoCartId: r.planyoCartId,
          planyoCompany: r.planyoCompany,
          planyoJobName: r.planyoJobName,
          planyoAgent: r.planyoAgent,
          planyoCustomerName: r.planyoCustomerName,
          planyoCustomerEmail: r.planyoCustomerEmail,
          planyoCustomerPhone: r.planyoCustomerPhone,
          notes: r.notes,
        },
      })
    }

    return { bookingId: booking.id }
  })
}

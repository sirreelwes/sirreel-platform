#!/usr/bin/env tsx
/**
 * One-off backfill: turn upcoming Planyo orphan reservations into
 * native Bookings + Reservation links.
 *
 * Scope: orphan carts (bookingId IS NULL, status != CANCELLED) with
 * the cart-level endTime ≥ today. Completed carts (37 of 111 as of
 * 2026-05-20) are left to age out of the timeline window naturally.
 *
 * Per upcoming cart:
 *   1. Resolve agent: planyoAgent string → User.name match
 *      (case-insensitive). Falls back to a sentinel default user
 *      (configurable via --default-agent <email>) — required because
 *      Booking.agentId is non-nullable.
 *   2. Find-or-create Company by normalized name (lowercase, punct
 *      stripped). Tagged with provenance string in Company.notes when
 *      newly created.
 *   3. Find-or-create Person:
 *        - If planyoCustomerEmail present → find by Person.email
 *          (which is @unique).
 *        - Else fall back to first+last name match within the
 *          resolved Company (via the Person→Affiliation→Company join
 *          if available; otherwise scan all Persons by name).
 *        - Newly created Persons get a notes tag for provenance.
 *   4. Create the Booking: bookingNumber = `SR-PB-YYYY-NNNN`
 *      (retry on @unique collision up to 5 times), source =
 *      PLANYO_BACKFILL. Booking.status derived from cart's
 *      reservation states (CONFIRMED-future → CONFIRMED, spanning
 *      today → ACTIVE, all HOLD → PENDING_APPROVAL). Dates from
 *      cart span.
 *   5. Stamp Reservation.bookingId on every reservation in the
 *      cart in a single updateMany.
 *
 * Usage:
 *   npx tsx scripts/planyo-backfill.ts                  # dry run (default)
 *   npx tsx scripts/planyo-backfill.ts --write           # actually write
 *   npx tsx scripts/planyo-backfill.ts --default-agent wes@sirreel.com
 *
 * Dry run NEVER writes. It logs the resolution decisions and
 * aggregated counts so you can audit before committing to writes.
 */

import { readFileSync } from 'fs'
import path from 'path'
import { PrismaClient, type BookingStatus } from '@prisma/client'

const envFile = readFileSync(path.join(process.cwd(), '.env.local'), 'utf8')
for (const line of envFile.split('\n')) {
  const m = line.match(/^([A-Z_]+)="?(.*?)"?$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}

const prisma = new PrismaClient()

const args = process.argv.slice(2)
const dryRun = !args.includes('--write')
const defaultAgentEmailArg = args.find((a) => a.startsWith('--default-agent='))?.split('=')[1]
const DEFAULT_AGENT_EMAIL = defaultAgentEmailArg || 'wes@sirreel.com'

const PROVENANCE_TAG = `Auto-created from Planyo backfill on ${new Date().toISOString().slice(0, 10)}`

// Today at UTC midnight — matches the filter the upcoming-vs-completed
// diagnostic used.
const TODAY = new Date()
TODAY.setUTCHours(0, 0, 0, 0)

function normalize(s: string | null | undefined): string {
  if (!s) return ''
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()
}

// Common business-entity suffixes + parenthetical / bracketed
// annotations. Stripped to merge near-duplicate Company names like
// "Fulu Films" vs "Fulu Films LLC" or "Gautam Sahi" vs
// "Gautam Sahi [ Reserved ]" into a single canonical key.
const COMPANY_SUFFIX_RE = /\b(llc|l\.l\.c|inc|inc\.|corp|corporation|co|co\.|ltd|ltd\.|limited|llp|pllc|pc|p\.c)\b/gi
function companyKey(s: string | null | undefined): string {
  if (!s) return ''
  // Drop anything inside [...] or (...) annotations the team uses
  // for Planyo bookkeeping ("[ Reserved ]", "(HF)", etc.) — these
  // shouldn't count toward identity.
  let stripped = s
    .replace(/\[.*?\]/g, ' ')
    .replace(/\(.*?\)/g, ' ')
    .replace(COMPANY_SUFFIX_RE, ' ')
  return normalize(stripped)
}

function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/)
  if (parts.length === 0) return { firstName: '', lastName: '' }
  if (parts.length === 1) return { firstName: parts[0], lastName: '' }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') }
}

function deriveStatus(reservationStatuses: string[], startTime: Date, endTime: Date): BookingStatus {
  const now = new Date()
  const spansToday = startTime <= now && endTime >= now
  const allHold = reservationStatuses.every((s) => s === 'HOLD')
  if (allHold) return 'PENDING_APPROVAL'
  if (spansToday) return 'ACTIVE'
  return 'CONFIRMED'
}

async function main() {
  console.log(`Planyo backfill — ${dryRun ? 'DRY RUN' : 'LIVE WRITE'}`)
  console.log(`Default agent fallback: ${DEFAULT_AGENT_EMAIL}`)
  console.log(`Cutoff (endTime ≥): ${TODAY.toISOString().slice(0, 10)}`)
  console.log('')

  // Pull upcoming orphan reservations + group by cart.
  const orphans = await prisma.reservation.findMany({
    where: { bookingId: null, status: { not: 'CANCELLED' } },
    orderBy: { startTime: 'asc' },
  })

  const cartMap = new Map<string, typeof orphans>()
  for (const r of orphans) {
    const k = r.planyoCartId || `r:${r.id}`
    const arr = cartMap.get(k) || []
    arr.push(r)
    cartMap.set(k, arr)
  }

  // Filter to carts whose latest endTime is today or later.
  const upcomingCarts: { key: string; rows: typeof orphans }[] = []
  for (const [key, rows] of cartMap) {
    const latestEnd = rows.reduce((mx, x) => (x.endTime > mx ? x.endTime : mx), rows[0].endTime)
    if (latestEnd >= TODAY) upcomingCarts.push({ key, rows })
  }

  console.log(`Total orphan carts: ${cartMap.size}`)
  console.log(`Upcoming carts (endTime ≥ today): ${upcomingCarts.length}`)
  console.log('')

  // Pre-fetch all @sirreel.com users (agent matching pool).
  const users = await prisma.user.findMany({
    where: { email: { endsWith: '@sirreel.com' } },
    select: { id: true, name: true, email: true },
  })
  const defaultAgent = users.find((u) => u.email === DEFAULT_AGENT_EMAIL)
  if (!defaultAgent) {
    throw new Error(`Default agent ${DEFAULT_AGENT_EMAIL} not found — pass --default-agent=<email>`)
  }

  // Pre-fetch all Companies for name-match (small table — under ~few thousand rows).
  // Two index keys per row: the plain-normalized name AND the
  // suffix-stripped key. Lookups try both so a Planyo "Fulu Films LLC"
  // hits an existing "Fulu Films" via the stripped key.
  const allCompanies = await prisma.company.findMany({
    select: { id: true, name: true },
  })
  const companyByNormName = new Map<string, { id: string; name: string }>()
  const companyByKey = new Map<string, { id: string; name: string }>()
  for (const c of allCompanies) {
    const norm = normalize(c.name)
    const key = companyKey(c.name)
    if (norm && !companyByNormName.has(norm)) companyByNormName.set(norm, c)
    if (key && !companyByKey.has(key)) companyByKey.set(key, c)
  }
  // Within-batch dedupe: when two orphan carts both want to create
  // "Echobend", the second one reuses the first's pending-create
  // identity instead of queueing a literal duplicate.
  const pendingCompanyByKey = new Map<string, string>() // key → display name

  // Pre-fetch all Persons with email — keyed by lowercased email
  // for O(1) lookup. Email is @unique so this is safe.
  const allPersons = await prisma.person.findMany({
    select: { id: true, firstName: true, lastName: true, email: true },
  })
  const personByEmail = new Map<string, { id: string; firstName: string; lastName: string; email: string }>()
  for (const p of allPersons) {
    if (p.email) personByEmail.set(p.email.toLowerCase(), p)
  }

  // Counters for the dry-run report.
  let companyExisting = 0
  let companyCreated = 0
  let personExistingByEmail = 0
  let personExistingByName = 0
  let personCreated = 0
  let agentMatched = 0
  let agentFallback = 0
  let bookingsCreated = 0
  let cartsSkipped = 0
  const statusCounts: Record<string, number> = {}
  const skipReasons: string[] = []

  for (const { key, rows } of upcomingCarts) {
    rows.sort((a, b) => a.startTime.getTime() - b.startTime.getTime())
    const rep = rows[0]
    const startTime = rep.startTime
    const endTime = rows.reduce((mx, x) => (x.endTime > mx ? x.endTime : mx), rows[0].endTime)

    // ── Company resolution ────────────────────────────────────────
    // Lookup chain: exact-normalized → suffix-stripped key against
    // existing rows → within-batch pending-create dedupe. Only after
    // all three miss do we queue a new Company.
    const coName = (rep.planyoCompany || '').trim()
    let companyId: string | null = null
    let companyDecision = ''
    if (coName) {
      const norm = normalize(coName)
      const key = companyKey(coName)
      let hit = companyByNormName.get(norm) || (key ? companyByKey.get(key) : undefined)
      if (hit) {
        companyId = hit.id
        companyExisting += 1
        companyDecision = `exists: ${hit.name}`
      } else if (key && pendingCompanyByKey.has(key)) {
        companyExisting += 1
        companyDecision = `pending dedupe: ${pendingCompanyByKey.get(key)} (this cart's ${coName})`
      } else {
        companyCreated += 1
        companyDecision = `create: ${coName}`
        if (key) pendingCompanyByKey.set(key, coName)
      }
    } else {
      skipReasons.push(`cart=${key}: no Planyo company name`)
      cartsSkipped += 1
      continue
    }

    // ── Person resolution ─────────────────────────────────────────
    const emailLower = (rep.planyoCustomerEmail || '').toLowerCase().trim()
    const customerName = (rep.planyoCustomerName || '').trim()
    let personId: string | null = null
    let personDecision = ''
    if (emailLower) {
      const hit = personByEmail.get(emailLower)
      if (hit) {
        personId = hit.id
        personExistingByEmail += 1
        personDecision = `exists by email: ${hit.firstName} ${hit.lastName} <${hit.email}>`
      } else {
        personCreated += 1
        personDecision = `create: ${customerName || '(no name)'} <${emailLower}>`
      }
    } else if (customerName) {
      // No email — try name match (case-insensitive, joined name)
      const { firstName, lastName } = splitName(customerName)
      const normFull = normalize(`${firstName} ${lastName}`)
      const hit = allPersons.find((p) => normalize(`${p.firstName} ${p.lastName}`) === normFull && !p.email)
      if (hit) {
        personId = hit.id
        personExistingByName += 1
        personDecision = `exists by name: ${hit.firstName} ${hit.lastName}`
      } else {
        personCreated += 1
        personDecision = `create (no email): ${customerName}`
      }
    } else {
      // No customer name at all — can't create a Person; skip cart.
      skipReasons.push(`cart=${key}: no Planyo customer name or email`)
      cartsSkipped += 1
      continue
    }

    // ── Agent resolution ──────────────────────────────────────────
    // Try exact normalized match first (e.g. "Jose Pacheco" → "Jose
    // Pacheco"), then first-token match (e.g. Planyo's SirReel_Agent
    // value "Jose" → User.name "Jose Pacheco"). The first-token path
    // is the common case in our data — every Planyo SirReel_Agent
    // value is a first name only.
    const agentRaw = (rep.planyoAgent || '').trim()
    let agentId: string = defaultAgent.id
    let agentDecision = `fallback: ${defaultAgent.name}`
    if (agentRaw) {
      const norm = normalize(agentRaw)
      let matchedUser = users.find((u) => normalize(u.name) === norm)
      if (!matchedUser) {
        // First-token fallback. Only fires when the Planyo value
        // unambiguously points at one User — if two SirReel staff
        // share a first name we don't guess.
        const firstTokenMatches = users.filter((u) => normalize(u.name).split(' ')[0] === norm)
        if (firstTokenMatches.length === 1) matchedUser = firstTokenMatches[0]
      }
      if (matchedUser) {
        agentId = matchedUser.id
        agentMatched += 1
        agentDecision = `matched: ${matchedUser.name}`
      } else {
        agentFallback += 1
      }
    } else {
      agentFallback += 1
    }

    // ── Booking status derivation ─────────────────────────────────
    const reservationStatuses = rows.map((r) => r.status)
    const status = deriveStatus(reservationStatuses, startTime, endTime)
    statusCounts[status] = (statusCounts[status] || 0) + 1

    bookingsCreated += 1

    if (dryRun) {
      console.log(
        `cart=${key.slice(0, 14).padEnd(14)} ` +
          `units=${String(rows.length).padStart(2)} ` +
          `${startTime.toISOString().slice(0, 10)} → ${endTime.toISOString().slice(0, 10)} ` +
          `· ${status.padEnd(8)} ` +
          `· co[${companyDecision}] ` +
          `· person[${personDecision}] ` +
          `· agent[${agentDecision}]`,
      )
    }

    if (!dryRun) {
      // 1) Company. companyId is null when the cart's company doesn't
      //    yet exist in CRM OR when it was queued for creation by a
      //    prior cart in this same run (the within-batch dedupe case).
      //    Re-check the live maps before creating — cart A's create
      //    updated companyByNormName/Key, so cart B finds it instead
      //    of creating a duplicate.
      if (!companyId) {
        const norm = normalize(coName)
        const key = companyKey(coName)
        const hit = companyByNormName.get(norm) || (key ? companyByKey.get(key) : undefined)
        if (hit) {
          companyId = hit.id
        } else {
          const created = await prisma.company.create({
            data: {
              name: coName,
              notes: PROVENANCE_TAG,
            },
            select: { id: true, name: true },
          })
          companyId = created.id
          companyByNormName.set(norm, created)
          if (key) companyByKey.set(key, created)
        }
      }

      // 2) Person — create if needed. Email is @unique, so if two
      //    carts hand the same email through the script before either
      //    has committed, the second create races into a constraint
      //    error — guard with a re-check via personByEmail map (which
      //    we update on create below).
      if (!personId) {
        if (emailLower) {
          const recheck = personByEmail.get(emailLower)
          if (recheck) {
            personId = recheck.id
          } else {
            const { firstName, lastName } = customerName ? splitName(customerName) : { firstName: emailLower, lastName: '' }
            const createdPerson = await prisma.person.create({
              data: {
                firstName: firstName || emailLower,
                lastName: lastName || '',
                email: emailLower,
                notes: PROVENANCE_TAG,
              },
              select: { id: true, firstName: true, lastName: true, email: true },
            })
            personId = createdPerson.id
            personByEmail.set(emailLower, createdPerson)
          }
        } else {
          // No-email path — Person.email is @unique but nullable check
          // doesn't apply (it's NOT NULL in the schema). The schema
          // requires an email. Build a synthetic email so the row can
          // exist. Tagged in notes so it's filterable + fixable.
          const { firstName, lastName } = splitName(customerName)
          const synthEmail = `planyo-backfill+${rep.planyoReservationId || rep.id.slice(0, 8)}@sirreel.com`
          const createdPerson = await prisma.person.create({
            data: {
              firstName: firstName || 'Unknown',
              lastName: lastName || '',
              email: synthEmail,
              notes: `${PROVENANCE_TAG} · synthetic email (Planyo customer had no email on file)`,
            },
            select: { id: true, firstName: true, lastName: true, email: true },
          })
          personId = createdPerson.id
          personByEmail.set(synthEmail, createdPerson)
        }
      }

      // 3) Booking. SR-PB-YYYY-NNNN with retry on @unique collision.
      const year = startTime.getUTCFullYear()
      let bookingNumber = ''
      let createdBooking: { id: string; bookingNumber: string } | null = null
      for (let attempt = 0; attempt < 5 && !createdBooking; attempt++) {
        bookingNumber = `SR-PB-${year}-${String(Math.floor(Math.random() * 9000) + 1000)}`
        try {
          createdBooking = await prisma.booking.create({
            data: {
              bookingNumber,
              companyId,
              personId,
              agentId,
              jobName: rep.planyoJobName || `Planyo cart ${rep.planyoCartId || rep.planyoReservationId || ''}`.trim(),
              productionName: rep.planyoJobName || null,
              startDate: startTime,
              endDate: endTime,
              status,
              source: 'PLANYO_BACKFILL',
              notes: `${PROVENANCE_TAG} · Planyo cart ${rep.planyoCartId || rep.planyoReservationId}`,
            },
            select: { id: true, bookingNumber: true },
          })
        } catch (err: unknown) {
          // P2002 = Prisma unique-constraint violation. Retry on
          // bookingNumber collision; surface anything else.
          const code = (err as { code?: string })?.code
          if (code !== 'P2002') throw err
        }
      }
      if (!createdBooking) {
        throw new Error(`Failed to generate unique bookingNumber for cart ${key} after 5 attempts`)
      }

      // 4) Stamp Reservation.bookingId on every reservation in the cart.
      const stamped = await prisma.reservation.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: { bookingId: createdBooking.id },
      })
      void stamped
    }
  }

  console.log('')
  console.log('═══════════ SUMMARY ═══════════')
  console.log(`Upcoming carts processed: ${upcomingCarts.length}`)
  console.log(`Carts skipped (insufficient data): ${cartsSkipped}`)
  console.log(`Bookings to create: ${bookingsCreated}`)
  console.log('')
  console.log('Company resolution:')
  console.log(`  existing matched: ${companyExisting}`)
  console.log(`  to create:        ${companyCreated}`)
  console.log('')
  console.log('Person resolution:')
  console.log(`  existing by email: ${personExistingByEmail}`)
  console.log(`  existing by name:  ${personExistingByName}`)
  console.log(`  to create:         ${personCreated}`)
  console.log('')
  console.log('Agent resolution:')
  console.log(`  matched to User: ${agentMatched}`)
  console.log(`  fell back to ${defaultAgent.name}: ${agentFallback}`)
  console.log('')
  console.log('Derived Booking status counts:')
  for (const [s, n] of Object.entries(statusCounts)) console.log(`  ${s}: ${n}`)
  if (skipReasons.length > 0) {
    console.log('')
    console.log('Skip reasons:')
    for (const r of skipReasons) console.log(`  ${r}`)
  }
  console.log('')
  console.log(dryRun ? 'DRY RUN — no writes performed.' : 'LIVE WRITE complete.')

  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})

/**
 * Verify the vendor portal for a job — read-only.
 *
 * Wes, 2026-09-05: "The alexey job booked. Let's make sure the vendor portal
 * works." The portal has three moving parts and each can fail silently:
 *
 *   1. the RECORD  — a SubRental exists for the job, carries a vendor token,
 *                    and its status agrees with what the CLIENT has done
 *                    (an ESTIMATED row on a booked order is the bug this
 *                    script was written to catch);
 *   2. the NOTICE  — the partner was told we quoted (vendorNotifiedAt) and,
 *                    once the client committed, asked to HOLD
 *                    (vendorHoldRequestedAt);
 *   3. the PAGE    — https://sirreel.com/vendor/<token> answers 200 through
 *                    the middleware allow-list, shows the unit, and names
 *                    NO client (the conduit rule).
 *
 * It prints one verdict per sub-rental and exits 1 if anything fails. It
 * writes nothing: the fix for an un-asked partner is the "Send hold request"
 * button on the job page (or approving/booking the order, which now runs the
 * hook itself).
 *
 * Run:
 *   export DATABASE_URL=$(grep '^DATABASE_URL=' .env.local | grep -v PRISMA | head -1 | cut -d'"' -f2)
 *   npx tsx scripts/verify-vendor-portal.ts alexey            # match job / company / contact
 *   npx tsx scripts/verify-vendor-portal.ts --job SR-JOB-0241 # one job by code
 *   npx tsx scripts/verify-vendor-portal.ts alexey --no-fetch # skip the HTTP check
 */
import { PrismaClient } from '@prisma/client'
import { isClientCommittedOrder } from '../src/lib/sub-rentals/commitment'
import { relayAddress } from '../src/lib/sub-rentals/driverRelay'
import { vendorPagePath } from '../src/lib/sub-rentals/potentialSubRental'
import { PUBLIC_SITE_ORIGIN } from '../src/lib/site/publicUrl'

const prisma = new PrismaClient()

const argv = process.argv.slice(2)
const jobArg = argv.indexOf('--job')
const JOB_CODE = jobArg >= 0 ? argv[jobArg + 1] : null
const FETCH = !argv.includes('--no-fetch')
const QUERY = argv.filter((a, i) => !a.startsWith('--') && i !== jobArg + 1).join(' ').trim()

let failures = 0
const ok = (msg: string) => console.log(`  ok    ${msg}`)
const warn = (msg: string) => console.log(`  warn  ${msg}`)
const fail = (msg: string) => { failures++; console.log(`  FAIL  ${msg}`) }
const when = (d: Date | null) => (d ? d.toISOString().slice(0, 16).replace('T', ' ') : 'never')
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '—')

async function findJobs() {
  if (JOB_CODE) {
    const j = await prisma.job.findUnique({ where: { jobCode: JOB_CODE }, select: { id: true } })
    return j ? [j.id] : []
  }
  if (!QUERY) {
    console.error('Give a search term (job name / company / contact) or --job SR-JOB-NNNN.')
    process.exit(2)
  }
  const jobs = await prisma.job.findMany({
    where: {
      OR: [
        { name: { contains: QUERY, mode: 'insensitive' } },
        { company: { name: { contains: QUERY, mode: 'insensitive' } } },
        {
          jobContacts: {
            some: {
              person: {
                OR: [
                  { firstName: { contains: QUERY, mode: 'insensitive' } },
                  { lastName: { contains: QUERY, mode: 'insensitive' } },
                  { email: { contains: QUERY, mode: 'insensitive' } },
                ],
              },
            },
          },
        },
      ],
    },
    orderBy: { updatedAt: 'desc' },
    take: 10,
    select: { id: true },
  })
  return jobs.map((j) => j.id)
}

async function checkPage(url: string, mustShow: string, mustNotShow: string[]) {
  let res: Response
  try {
    res = await fetch(url, { redirect: 'manual', headers: { 'user-agent': 'sirreel-verify-vendor-portal' } })
  } catch (err) {
    fail(`page fetch threw: ${err instanceof Error ? err.message : String(err)}`)
    return
  }
  const mw = res.headers.get('x-mw-action') ?? '—'
  if (res.status !== 200) {
    fail(`page answered ${res.status} (middleware: ${mw}) — the link in the partner's email is dead`)
    return
  }
  ok(`page answers 200 (middleware: ${mw})`)
  const html = await res.text()
  if (html.includes(mustShow)) ok(`page shows the unit "${mustShow}"`)
  else fail(`page does not show the unit "${mustShow}"`)
  for (const secret of mustNotShow) {
    if (secret.length < 3) continue
    if (html.toLowerCase().includes(secret.toLowerCase())) {
      fail(`CONDUIT BREACH — the vendor page contains "${secret}"`)
    }
  }
  ok('page names no client (production, company, contacts checked)')
}

async function main() {
  const jobIds = await findJobs()
  if (jobIds.length === 0) {
    console.log(`No job matched ${JOB_CODE ?? `"${QUERY}"`}.`)
    process.exit(1)
  }

  for (const jobId of jobIds) {
    const job = await prisma.job.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        jobCode: true,
        name: true,
        status: true,
        company: { select: { name: true } },
        jobContacts: { select: { person: { select: { firstName: true, lastName: true, email: true } } } },
        orders: {
          where: { archivedAt: null },
          orderBy: { createdAt: 'asc' },
          select: { id: true, orderNumber: true, status: true, wonAt: true, bookedAt: true },
        },
      },
    })
    if (!job) continue

    console.log(`\n${job.jobCode} — ${job.name} (${job.company.name}) · job ${job.status}`)
    for (const o of job.orders) {
      console.log(`  order ${o.orderNumber} ${o.status}${o.wonAt ? ` · won ${when(o.wonAt)}` : ''}${o.bookedAt ? ` · booked ${when(o.bookedAt)}` : ''}`)
    }
    const jobCommitted = job.orders.some((o) => isClientCommittedOrder(o.status))
    console.log(`  client committed: ${jobCommitted ? 'YES' : 'no'}`)

    const subs = await prisma.subRental.findMany({
      where: { OR: [{ jobId: job.id }, { order: { jobId: job.id } }] },
      orderBy: [{ startDate: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        status: true,
        itemDescription: true,
        quantity: true,
        startDate: true,
        endDate: true,
        vendorToken: true,
        vendorNotifiedAt: true,
        vendorHoldRequestedAt: true,
        driverName: true,
        driverEmail: true,
        relayTag: true,
        vendor: { select: { name: true, email: true, poEmail: true, phone: true } },
        subcontractedVehicle: { select: { name: true } },
        order: { select: { orderNumber: true, status: true } },
      },
    })

    if (subs.length === 0) {
      console.log('  (no sub-rentals on this job — nothing for the vendor portal to show)')
      continue
    }

    // Names the vendor page must never contain.
    const secrets = [
      job.name,
      job.company.name,
      ...job.jobContacts.flatMap((c) => [c.person?.lastName ?? '', c.person?.email ?? '']),
    ].filter(Boolean)

    for (const s of subs) {
      const unit = s.subcontractedVehicle?.name ?? s.itemDescription
      const committed = s.order ? isClientCommittedOrder(s.order.status) : jobCommitted
      console.log(`\n  ── ${unit} × ${s.quantity} · ${s.vendor.name} · ${day(s.startDate)} → ${day(s.endDate)} · ${s.status}${s.order ? ` · ${s.order.orderNumber} ${s.order.status}` : ' · no order (job-level)'}`)

      // 1. the record
      if (!s.vendorToken) fail('no vendor token — the partner has no page; sending a hold request mints one')
      else ok(`vendor token minted · ${PUBLIC_SITE_ORIGIN}${vendorPagePath(s.vendorToken)}`)

      // 2. the notices
      if (s.vendorNotifiedAt) ok(`partner told we quoted · ${when(s.vendorNotifiedAt)}`)
      else warn('partner was never told we quoted these dates')

      const to = s.vendor.poEmail ?? s.vendor.email
      if (!to) warn(`${s.vendor.name} has no email on file — every notice to them fails; phone ${s.vendor.phone ?? 'unknown'}`)

      if (['RETURNED', 'CANCELLED'].includes(s.status)) {
        ok('closed row — nothing left to hold')
      } else if (s.vendorHoldRequestedAt) {
        ok(`partner asked to hold · ${when(s.vendorHoldRequestedAt)}`)
        if (s.status === 'ESTIMATED') warn('asked to hold but status is still ESTIMATED — flip it to Hold requested on the job page')
      } else if (committed) {
        fail(
          s.status === 'ESTIMATED'
            ? 'client is committed but the row is still ESTIMATED and the partner was NEVER asked to hold — their last notice from us says "this is not a booking". Job page → Send hold request.'
            : `row is ${s.status} but the hold request never left — Job page → Send hold request.`,
        )
      } else {
        ok('nothing to hold yet — the client has not accepted')
      }

      // driver
      if (s.driverName) ok(`driver ${s.driverName} <${s.driverEmail}> · relay ${s.relayTag ? relayAddress(s.relayTag) : 'MISSING'}`)
      else if (committed) warn('no driver named yet — the partner names theirs on their page')

      // 3. the page
      if (FETCH && s.vendorToken) {
        await checkPage(`${PUBLIC_SITE_ORIGIN}${vendorPagePath(s.vendorToken)}`, unit, secrets)
      }
    }
  }

  console.log(failures === 0 ? '\nVendor portal checks passed.' : `\n${failures} check${failures === 1 ? '' : 's'} FAILED.`)
  process.exit(failures === 0 ? 0 : 1)
}

main()
  .catch((err) => { console.error(err); process.exit(1) })
  .finally(() => prisma.$disconnect())

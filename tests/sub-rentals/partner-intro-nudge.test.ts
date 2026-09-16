/**
 * "Chase the introduction" — the nudge, and what must NOT raise one.
 *
 *   npm run test:partner-intro-nudge
 *
 * Wes 2026-09-15, after the California Rent A Car introduction: "set up the
 * reminder." It is a reminder to LOOK, never an action: the mark stays his,
 * because a reply can be "no thanks". Pinned, with Prisma stubbed:
 *   - the where-clause asks for exactly the four facts that make an item
 *   - a marked partner, a fresh introduction, or any sign of a real partner
 *     (roster, bookings, agreement) raises nothing
 *   - the copy says where the reply actually landed, and counts the days
 *   - it is ADMIN-only, because only Wes can press the mark
 */
import Module from 'module'

let where: Record<string, unknown> = {}
let rows: Array<Record<string, unknown>> = []

const origLoad = (Module as never as { _load: (...a: unknown[]) => unknown })._load
;(Module as never as { _load: unknown })._load = function (req: string, parent: unknown, isMain: boolean) {
  if (req.endsWith('/lib/prisma') || req === '@/lib/prisma') {
    return { prisma: { vendor: { findMany: async (a: { where: Record<string, unknown> }) => { where = a.where; return rows } } } }
  }
  return (origLoad as (...a: unknown[]) => unknown).apply(this, [req, parent, isMain])
}

let failed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (!ok) failed++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok || detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`)
}

const NOW = new Date('2026-09-20T17:00:00Z')

async function main() {
  const { findPartnersAwaitingReply, partnerIntroUnansweredProvider, daysSince, agoPhrase, PARTNER_INTRO_GRACE_DAYS } =
    await import('../../src/lib/actionItems/providers/partnerIntroUnanswered')

  console.log('what it asks the database for')
  rows = []
  await findPartnersAwaitingReply(NOW)
  const w = JSON.stringify(where)
  check('introduced, and old enough to chase', w.includes('welcomeSentAt') && w.includes('lte'))
  check('not already marked a partner', w.includes('"partnerMarkedAt":null'))
  check('no roster units, no bookings, no agreement — those are partners already', w.includes('subcontractedVehicles') && w.includes('subRentals') && w.includes('agreements'))
  check('active vendors only', w.includes('"isActive":true'))
  check('the grace is days, not hours', PARTNER_INTRO_GRACE_DAYS >= 2 && PARTNER_INTRO_GRACE_DAYS <= 14)

  console.log('\nthe item')
  rows = [{ id: 'v1', name: 'California Rent A Car', contactName: 'Clifford Fields', welcomeSentAt: new Date('2026-09-15T01:22:00Z'), welcomeSentTo: 'clifford@californiarac.com' }]
  const items = await partnerIntroUnansweredProvider.fetch({} as never)
  check('one item, for the one company', items.length === 1 && /California Rent A Car/.test(items[0].title))
  // The provider reads the clock itself, so the expected count is whatever
  // today makes it — the point is that it reads as English either way.
  const expected = agoPhrase(daysSince(new Date('2026-09-15T01:22:00Z')))
  check('it names the person and counts the days in English', /Clifford Fields/.test(items[0].subtitle) && items[0].subtitle!.includes(expected) && !/\b1 days\b/.test(items[0].subtitle!), { expected, subtitle: items[0]?.subtitle })
  check('one day reads as one day, and same-day reads as today', agoPhrase(1) === '1 day ago' && agoPhrase(0) === 'today' && agoPhrase(6) === '6 days ago')
  check('it says the reply is not in HQ', /your inbox, not HQ/.test(items[0].subtitle))
  check('it points at the Portals tab', items[0].href === '/crm/portals#partners')
  check('ADMIN only — nobody else can press the mark', JSON.stringify(items[0].ownerRole) === JSON.stringify(['ADMIN']))
  check('dismissable per person, for “he is away until the 20th”', items[0].dismissal?.kind === 'sideRow')
  check('the id is stable for the same send, so dismissing sticks', items[0].id === 'partner-intro-unanswered:v1:2026-09-15')

  console.log('\ncounting')
  check('whole days only', daysSince(new Date('2026-09-15T23:00:00Z'), NOW) === 4)

  console.log('\na db that is not ready')
  ;(Module as never as { _load: unknown })._load = function (req: string, parent: unknown, isMain: boolean) {
    if (req.endsWith('/lib/prisma') || req === '@/lib/prisma') {
      return { prisma: { vendor: { findMany: async () => { throw new Error('column does not exist') } } } }
    }
    return (origLoad as (...a: unknown[]) => unknown).apply(this, [req, parent, isMain])
  }
  const { findPartnersAwaitingReply: again } = await import('../../src/lib/actionItems/providers/partnerIntroUnanswered?fresh')
    .catch(async () => await import('../../src/lib/actionItems/providers/partnerIntroUnanswered'))
  check('a missing column is silence, not a broken tab', (await again(NOW).catch(() => 'threw')) !== 'threw')

  if (failed) { console.log(`\n${failed} failing`); process.exit(1) }
  console.log('\nall passing')
}
void main()

/**
 * Send-guard tests.
 *
 *   npm run test:send-guard
 *
 * This guard is the only thing standing between an outreach campaign and
 * the domain that carries every rental agreement and invoice SirReel
 * sends. The cases below are the ones where being wrong is expensive:
 *
 *   - sending while the feature is off
 *   - sending from sirreel.com
 *   - sending to someone who unsubscribed
 *   - sending past a daily cap
 *
 * The suppression lookup and the delivery counter are stubbed so this
 * stays offline; everything else is the shipped code path.
 */

process.env.OUTREACH_SENDING_ENABLED = 'true'
process.env.OUTREACH_FROM_DOMAIN = 'go.sirreel.com'
process.env.OUTREACH_PER_REP_DAILY_CAP = '5'
process.env.OUTREACH_GLOBAL_DAILY_CAP = '8'

import Module from 'module'

// Stub the two DB-touching modules BEFORE sendGuard imports them.
let SUPPRESSED = new Set<string>()
let SENT_BY_REP = 0
let SENT_GLOBAL = 0

const origLoad = (Module as never as { _load: (...a: unknown[]) => unknown })._load
;(Module as never as { _load: unknown })._load = function (req: string, parent: unknown, isMain: boolean) {
  if (req.endsWith('/lib/prisma') || req === '@/lib/prisma') {
    return {
      prisma: {
        emailDelivery: {
          // The guard distinguishes per-rep from global purely by the
          // label PREFIX it queries, so the stub reads the same signal.
          count: async ({ where }: { where: { label: { startsWith: string } } }) =>
            where.label.startsWith.length > 'outreach:'.length ? SENT_BY_REP : SENT_GLOBAL,
        },
      },
    }
  }
  if (req === '@/lib/outreach/suppression') {
    return {
      filterSuppressed: async (emails: string[]) => {
        const norm = emails.map((e) => e.trim().toLowerCase())
        const suppressed = norm.filter((e) => SUPPRESSED.has(e))
        return {
          sendable: norm.filter((e) => !SUPPRESSED.has(e)),
          suppressed: suppressed.map((email) => ({ email, reason: 'UNSUBSCRIBED', suppressedAt: new Date() })),
          failedClosed: false,
        }
      },
    }
  }
  return (origLoad as (...a: unknown[]) => unknown).apply(this, [req, parent, isMain])
}

const { sendGuard } = require('../../src/lib/outreach/sendGuard') as typeof import('../../src/lib/outreach/sendGuard')

const failures: string[] = []
function check(cond: boolean, why: string) {
  console.log(cond ? `  ok — ${why}` : `  FAIL — ${why}`)
  if (!cond) failures.push(why)
}

const REP = 'user-1'
const FROM = 'jose@go.sirreel.com'
const THREE = ['a@x.com', 'b@x.com', 'c@x.com']

async function main() {
  console.log('\nThe master switch')
  {
    process.env.OUTREACH_SENDING_ENABLED = 'false'
    const r = await sendGuard({ userId: REP, fromAddress: FROM, recipients: THREE })
    check(!r.allowed && r.reason === 'sending-disabled', 'nothing sends while the switch is off')
    check(r.sendable.length === 0, 'and no recipients come back')
    process.env.OUTREACH_SENDING_ENABLED = 'true'
  }

  console.log('\nThe sending domain — the expensive one')
  {
    const r = await sendGuard({ userId: REP, fromAddress: 'jose@sirreel.com', recipients: THREE })
    check(!r.allowed && r.reason === 'transactional-domain',
      'refuses to send outreach from sirreel.com, the domain agreements travel on')
  }
  {
    const saved = process.env.OUTREACH_FROM_DOMAIN
    process.env.OUTREACH_FROM_DOMAIN = 'sirreel.com'
    const r = await sendGuard({ userId: REP, fromAddress: 'jose@go.sirreel.com', recipients: THREE })
    check(!r.allowed && r.reason === 'transactional-domain',
      'refuses even when someone sets the env var to the transactional domain')
    process.env.OUTREACH_FROM_DOMAIN = saved
  }
  {
    const saved = process.env.OUTREACH_FROM_DOMAIN
    delete process.env.OUTREACH_FROM_DOMAIN
    const r = await sendGuard({ userId: REP, fromAddress: FROM, recipients: THREE })
    check(!r.allowed && r.reason === 'no-outreach-domain',
      'refuses when no outreach subdomain is configured at all')
    process.env.OUTREACH_FROM_DOMAIN = saved
  }

  console.log('\nSuppression')
  {
    SUPPRESSED = new Set(['b@x.com'])
    const r = await sendGuard({ userId: REP, fromAddress: FROM, recipients: THREE })
    check(r.allowed, 'a partially-suppressed batch still goes')
    check(!r.sendable.includes('b@x.com'), 'the suppressed address is dropped')
    check(r.suppressed.length === 1, 'and is reported back, not silently vanished')
  }
  {
    SUPPRESSED = new Set(THREE)
    const r = await sendGuard({ userId: REP, fromAddress: FROM, recipients: THREE })
    check(!r.allowed && r.reason === 'all-recipients-suppressed',
      'a fully-suppressed batch is blocked outright')
    SUPPRESSED = new Set()
  }
  {
    SUPPRESSED = new Set(['B@X.com'.toLowerCase()])
    const r = await sendGuard({ userId: REP, fromAddress: FROM, recipients: ['B@X.com'] })
    check(!r.allowed, 'case differences do not slip past suppression')
    SUPPRESSED = new Set()
  }

  console.log('\nDaily caps')
  {
    SENT_BY_REP = 0; SENT_GLOBAL = 0
    const r = await sendGuard({ userId: REP, fromAddress: FROM, recipients: THREE })
    check(r.allowed && r.sendable.length === 3, 'under both caps, everything goes')
  }
  {
    SENT_BY_REP = 3; SENT_GLOBAL = 3   // per-rep cap 5 → 2 left
    const r = await sendGuard({ userId: REP, fromAddress: FROM, recipients: THREE })
    check(r.allowed && r.sendable.length === 2, 'the batch is TRIMMED to the remaining allowance')
    check(r.trimmedByCap === 1, 'and says how many it held back')
  }
  {
    SENT_BY_REP = 5; SENT_GLOBAL = 5
    const r = await sendGuard({ userId: REP, fromAddress: FROM, recipients: THREE })
    check(!r.allowed && r.reason === 'per-rep-cap', 'at the rep cap, nothing goes')
  }
  {
    SENT_BY_REP = 0; SENT_GLOBAL = 8
    const r = await sendGuard({ userId: REP, fromAddress: FROM, recipients: THREE })
    check(!r.allowed && r.reason === 'global-cap',
      'the global cap stops a rep who is personally well under theirs')
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} failure(s):`)
    failures.forEach((f) => console.error(`  - ${f}`))
    process.exit(1)
  }
  console.log('\nAll send-guard tests passed.\n')
}
main()

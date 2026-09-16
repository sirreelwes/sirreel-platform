/**
 * Who is collecting a will-call unit — recorded, and told to the partner once.
 *
 *   npm run test:collector
 *
 * Wes 2026-09-15: "fix the who's collecting gap." The go note promises SirReel
 * will say who is coming; this is the machinery that keeps it. Pinned, with
 * Prisma and the senders stubbed:
 *   - only a will-call booking has a collector; driven and delivered refuse
 *   - the same name twice tells the partner once
 *   - clearing it is allowed and announces nothing
 *   - the notice and the text carry the NAME and never the production
 *   - a cancelled booking refuses
 */
import Module from 'module'

let row: Record<string, unknown> | null = null
const updates: Array<Record<string, unknown>> = []
const mails: Array<{ subject: string; text: string }> = []
const texts: Array<string> = []

const base = {
  id: 's1', status: 'CONFIRMED', receiveMethod: 'WILL_CALL', collectorName: null,
  startDate: new Date('2026-09-22T00:00:00Z'), endDate: new Date('2026-09-24T00:00:00Z'),
  itemDescription: 'Chevy Suburban', vendorToken: 'tok', orderId: 'o1', jobId: 'j1',
  subcontractedVehicle: { name: 'Chevy Suburban' },
  job: { jobCode: 'SR-JOB-0412' },
  vendor: { id: 'v1', name: 'California Rent A Car', email: 'rentals@example.invalid', poEmail: null },
}

const origLoad = (Module as never as { _load: (...a: unknown[]) => unknown })._load
;(Module as never as { _load: unknown })._load = function (req: string, parent: unknown, isMain: boolean) {
  if (req.endsWith('/lib/prisma') || req === '@/lib/prisma') {
    return {
      prisma: {
        subRental: {
          findUnique: async () => row,
          update: async (a: { data: Record<string, unknown> }) => { updates.push(a.data); return {} },
        },
        auditLog: { create: async () => ({}) },
        vendorContact: { findMany: async () => [] },
      },
    }
  }
  if (req.endsWith('/sub-rentals/partnerMail') || req === '@/lib/sub-rentals/partnerMail') {
    return { sendPartnerMail: async (p: { subject: string; text: string }) => { mails.push(p); return { ok: true } } }
  }
  if (req.endsWith('/sub-rentals/partnerSms') || req === '@/lib/sub-rentals/partnerSms') {
    return { textPartnerAboutBooking: async (_id: string, kind: string) => { texts.push(kind); return { sent: 1, skipped: [] } } }
  }
  return (origLoad as (...a: unknown[]) => unknown).apply(this, [req, parent, isMain])
}

let failed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (!ok) failed++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok || detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`)
}
const reset = (over: Record<string, unknown> = {}) => { row = { ...base, ...over }; updates.length = 0; mails.length = 0; texts.length = 0 }

async function main() {
  const { setCollector } = await import('../../src/lib/sub-rentals/collector')
  const { buildVendorCollectorNotice } = await import('../../src/lib/sub-rentals/vendorNotice')
  const { buildPartnerSms } = await import('../../src/lib/sub-rentals/partnerSms')

  console.log('setting it')
  reset()
  let r = await setCollector('s1', '  Dee   Ramirez ', { by: 'client', jobId: 'j1' })
  check('saved, tidied and the partner told', r.ok && r.changed && r.collectorName === 'Dee Ramirez' && r.notified, r)
  check('emailed once and texted once', mails.length === 1 && texts.length === 1 && texts[0] === 'collector', { mails: mails.length, texts })
  check('the email names them and the unit, not the production', /Dee Ramirez/.test(mails[0].text) && /Chevy Suburban/.test(mails[0].text) && !/production’s|Inc\.|LLC/.test(mails[0].text))

  reset({ collectorName: 'Dee Ramirez' })
  r = await setCollector('s1', 'Dee Ramirez', { by: 'staff' })
  check('the same name again tells nobody twice', r.ok && !r.changed && mails.length === 0 && texts.length === 0, r)

  reset({ collectorName: 'Dee Ramirez' })
  r = await setCollector('s1', 'Sam Okafor', { by: 'client', jobId: 'j1' })
  check('a change is sent as a change', r.ok && r.changed && /Change of collection/.test(mails[0].subject), mails[0]?.subject)

  reset({ collectorName: 'Dee Ramirez' })
  r = await setCollector('s1', '', { by: 'staff' })
  check('clearing is allowed and announces nothing', r.ok && r.collectorName === null && mails.length === 0, r)

  console.log('\nwhat refuses')
  reset({ receiveMethod: 'PICKUP' })
  r = await setCollector('s1', 'Dee', { by: 'staff' })
  check('a driven unit has no collector', !r.ok && r.status === 409, r)
  reset({ receiveMethod: 'DELIVERY' })
  check('a delivered unit has no collector', !(await setCollector('s1', 'Dee', { by: 'staff' })).ok)
  reset({ status: 'CANCELLED' })
  check('a cancelled booking refuses', !(await setCollector('s1', 'Dee', { by: 'staff' })).ok)
  reset()
  r = await setCollector('s1', 'Dee', { by: 'client', jobId: 'OTHER' })
  check('another job’s booking refuses', !r.ok && r.status === 403, r)
  reset()
  r = await setCollector('s1', 'x'.repeat(200), { by: 'staff' })
  check('an absurd name is refused, not truncated silently', !r.ok && r.status === 400)

  console.log('\nthe words')
  const notice = buildVendorCollectorNotice({
    vendorName: 'California Rent A Car', vehicleName: 'Chevy Suburban', collectorName: 'Dee Ramirez',
    startDate: '2026-09-22', endDate: '2026-09-24', reference: 'SR-JOB-0412',
    vendorUrl: 'https://sirreel.com/vendor/tok', agentName: 'Team SirReel',
  })
  check('first notice reads as news, not a change', /^Collecting —/.test(notice.subject))
  check('it says they check out with a licence', /licence/.test(notice.text))
  const sms = buildPartnerSms('collector', { vehicleName: 'Chevy Suburban', startDate: '2026-09-22', endDate: '2026-09-24', url: 'https://sirreel.com/vendor/tok', collectorName: 'Dee Ramirez' })
  check('the text names them', /Dee Ramirez is collecting it/.test(sms), sms)

  if (failed) { console.log(`\n${failed} failing`); process.exit(1) }
  console.log('\nall passing')
}
void main()

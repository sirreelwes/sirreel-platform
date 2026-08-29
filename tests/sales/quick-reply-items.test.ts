/**
 * Quick Reply — what the client is told they asked for.
 *
 *   npx tsx tests/sales/quick-reply-items.test.ts
 *   npm run test:quick-reply-items
 *
 * Both failure directions land in a client's inbox, which is why this is
 * worth a test (Wes 2026-08-26):
 *   · the reply has to NAME the vehicle category and the supplies riding on
 *     it — "we've set your equipment aside" reads as a confirmation while
 *     confirming nothing, and the ten ratchet straps she asked for had
 *     vanished by then anyway;
 *   · "Write my own email" has to mean the rep's words are the WHOLE email —
 *     the templated hold read-back and the production-company ask stapled
 *     underneath a hand-written note read like two people wrote it.
 *
 * Pure rendering — no DB reads. The env preamble is only here because
 * quickReply.ts pulls in the prisma-backed availability engine at import.
 */
import { readFileSync } from 'fs'
import path from 'path'

const envFile = readFileSync(path.join(process.cwd(), '.env.local'), 'utf8')
for (const line of envFile.split('\n')) {
  const m = line.match(/^([A-Z_]+)="?(.*?)"?$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}

async function main() {
  const { requestedItemLabels } = await import('../../src/lib/sales/quickReply')
  const { buildWelcomeEmail } = await import('../../src/lib/email/templates/welcomeTemplate')

  let fail = 0
  const eq = (label: string, got: unknown, want: unknown) => {
    const ok = JSON.stringify(got) === JSON.stringify(want)
    if (!ok) fail++
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` → ${JSON.stringify(got)} (want ${JSON.stringify(want)})`}`)
  }
  const has = (label: string, haystack: string, needle: string) => eq(label, haystack.includes(needle), true)
  const lacks = (label: string, haystack: string, needle: string) => eq(label, haystack.includes(needle), false)

  // ── labels ──
  eq('single unit reads as the bare name',
    requestedItemLabels([{ name: 'Cargo Van w/ Liftgate', quantity: 1 }]),
    ['Cargo Van w/ Liftgate'])
  eq('several units carry the count',
    requestedItemLabels([{ name: 'Ratchet Strap', quantity: 10 }]),
    ['10 × Ratchet Strap'])
  eq('garbage quantity floors at one',
    requestedItemLabels([{ name: 'Furniture Pad', quantity: 0 }]),
    ['Furniture Pad'])
  eq('unnamed lines are dropped', requestedItemLabels([{ name: '  ', quantity: 3 }]), [])
  eq('one shared window stays off the lines',
    requestedItemLabels([
      { name: 'Cargo Van w/ Liftgate', quantity: 1, startDate: '2026-08-27', endDate: '2026-08-31' },
      { name: 'Cube Truck', quantity: 2, startDate: '2026-08-27', endDate: '2026-08-31' },
    ]),
    ['Cargo Van w/ Liftgate', '2 × Cube Truck'])
  eq('split windows get spelled out per line',
    requestedItemLabels([
      { name: 'Cargo Van w/ Liftgate', quantity: 1, startDate: '2026-08-27', endDate: '2026-08-31' },
      { name: 'Cube Truck', quantity: 1, startDate: '2026-08-29', endDate: '2026-08-31' },
    ]),
    ['Cargo Van w/ Liftgate · Aug 27 – Aug 31, 2026', 'Cube Truck · Aug 29 – Aug 31, 2026'])

  // ── the email ──
  const render = (over: Record<string, unknown>) =>
    buildWelcomeEmail({
      mode: 'availability',
      clientFirstName: 'Maggie',
      clientFullName: 'Maggie',
      agentName: 'Wes Bailey',
      agentEmail: '',
      agentPhone: null,
      personalNote: null,
      quote: null,
      availability: {
        jobName: 'Neon Nights',
        dateRange: 'Aug 27 – Aug 31, 2026',
        availabilityMessage: 'It is great to hear from you.',
        suppliesUrl: 'https://orders.sirreel.com',
        heldRange: 'Aug 27 – Aug 31, 2026',
        requestedItems: ['Cargo Van w/ Liftgate'],
        supplyItems: ['10 × Ratchet Strap'],
        ...over,
      },
    })

  const held = render({})
  has('hold names the category', held.html, 'We&rsquo;ve set aside your <strong>Cargo Van w/ Liftgate</strong>')
  has('hold names the window', held.html, '<strong>Aug 27 – Aug 31, 2026</strong>')
  has('supplies ride along in the html', held.html, 'Coming on the vehicle: <strong>10 × Ratchet Strap</strong>')
  has('supplies ride along in the text', held.text, 'Coming on the vehicle: 10 × Ratchet Strap.')
  has('the button says what it is for', held.html, 'Add gear or vehicles &rarr;')
  has('the button has a lead-in', held.html, 'Need more gear or vehicles lined up?')
  lacks('no anonymous "your equipment"', held.html, 'set your equipment aside')

  const many = render({ requestedItems: ['2 × Cube Truck', 'Cargo Van w/ Liftgate'] })
  has('several lines become a list', many.html, '<li style="margin: 0 0 2px;">2 × Cube Truck</li>')
  has('list keeps the plural sentence', many.html, 'We&rsquo;ve set the following aside for')

  // No hold placed — the request is still read back so a client can correct us.
  const noHold = render({ heldRange: null })
  has('unheld request is still read back', noHold.html, 'Here&rsquo;s what I have from your note')
  lacks('unheld request claims no hold', noHold.html, 'set aside')

  // Nothing parsed at all — the old wording survives as the fallback.
  const bare = render({ requestedItems: [], supplyItems: [] })
  has('no items falls back to the old sentence', bare.html, 'We&rsquo;ve set your equipment aside for')

  // "Write my own email" — the rep's words plus the button, nothing else.
  const own = render({ customBody: 'Maggie — the liftgate van is yours, I will call at 4.', askForCompany: true, askForJob: true })
  has('the rep\'s words are the body', own.html, 'the liftgate van is yours')
  lacks('no templated hold read-back', own.html, 'while you decide')
  lacks('no templated supplies line', own.html, 'Coming on the vehicle')
  lacks('no templated production-company ask', own.html, 'One quick thing for our files')
  has('the button survives', own.html, 'Add gear or vehicles &rarr;')
  has('the lead-in survives', own.html, 'Need more gear or vehicles lined up?')
  has('the greeting survives', own.html, 'Hi Maggie,')
  has('the sign-off survives', own.html, 'Wes Bailey')
  lacks('plain text is stripped too', own.text, 'while you decide')
  has('plain text keeps the link', own.text, 'Add gear or vehicles: https://orders.sirreel.com')

  console.log(fail === 0 ? '\nall quick-reply item checks passed' : `\n${fail} FAILED`)
  process.exit(fail === 0 ? 0 : 1)
}

void main()

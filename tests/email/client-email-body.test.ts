/**
 * Quote + card-authorization emails — the pre-job voice, and the rep's right
 * to write the whole thing.
 *
 *   npx tsx tests/email/client-email-body.test.ts
 *   npm run test:client-email-body
 *
 * Two things a client would catch that nothing else guards (Wes 2026-08-26):
 *   · the quote goes out BEFORE we have the job, so it cannot open with
 *     "really glad we get to work on this with you" — it asks for the work
 *     (it used to say "we'd love to work with you on this one"; since
 *     2026-09-05 it has no opener at all — Wes: "drop the opener on the rep
 *     send too");
 *   · "Write my own email" has to mean the WHOLE email. A hand-written note
 *     with our templated opener above it and our templated closer below it
 *     reads like two people wrote it — same rule Quick Reply already follows.
 *
 * As of 2026-09-02 "the whole email" includes the GREETING: the composer
 * opens blank, the "Starts with Hi <First>," strip above it is gone, and a
 * rep-written body suppresses the templated greeting outright. A blank box
 * still renders the standard wording, greeting and all, for any caller that
 * doesn't compose through the modal — both directions are asserted below.
 *
 * And the reason the default lives in standardOpening.ts: the compose box is
 * seeded from the same function the template renders, so what a rep is handed
 * to edit is character-for-character what the client receives. That equality
 * is the first assertion below.
 *
 * Pure rendering — no DB.
 */
import { buildWelcomeEmail } from '../../src/lib/email/templates/welcomeTemplate'
import { buildCardAuthRequestEmail } from '../../src/lib/email/templates/cardAuthRequest'
import { defaultEmailBody } from '../../src/lib/email/standardOpening'

let fail = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` → ${JSON.stringify(got)} (want ${JSON.stringify(want)})`}`)
}
const has = (label: string, haystack: string, needle: string) => eq(label, haystack.includes(needle), true)
const lacks = (label: string, haystack: string, needle: string) => eq(label, haystack.includes(needle), false)

const render = (customBody: string | null) =>
  buildWelcomeEmail({
    mode: 'welcome-with-quote',
    customBody,
    clientFirstName: 'Colin',
    clientFullName: 'Colin Ferris',
    agentName: 'Jose Pacheco',
    agentEmail: 'jose@sirreel.com',
    agentPhone: '(818) 555-0110',
    personalNote: null,
    quote: {
      orderNumber: 'S260826-004',
      jobName: 'The Watch Party',
      startDate: '2026-09-10T00:00:00.000Z',
      endDate: '2026-09-14T00:00:00.000Z',
      subtotal: 4200,
      total: 4620,
      portalUrl: 'https://tsx.sirreel.com/portal/job/watch-party?token=abc',
    },
  })

const DEFAULT_BODY = defaultEmailBody({ kind: 'quote' })
const templated = render(null)

// ── the box and the email are the same words ──
for (const para of DEFAULT_BODY.split(/\n{2,}/)) {
  has(`plain text renders the seeded paragraph: "${para.slice(0, 32)}…"`, templated.text, para)
}

// ── pre-job voice ──
// Wes 2026-09-05: no opener on the quote at all — "drop the opener on the
// rep send too". The quote goes straight to the point.
lacks('no opener on the quote', templated.text, "we'd love to work with you")
has('goes straight to the quote', templated.text, "I've put together a first pass at your quote")
lacks('no "glad we get to work" presumption', templated.text, 'glad we get to work')
lacks('no presumption in the HTML either', templated.html, 'glad we get to work')

// ── write my own email ──
const own = render('Hey Colin — great catching up.\n\nI kept the 5-tonner on this instead of the cube.')
has("the rep's words are the body", own.html, 'I kept the 5-tonner on this instead of the cube.')
has('paragraph breaks survive', own.html, 'Hey Colin &mdash; great catching up.'.replace('&mdash;', '—'))
lacks('no templated opener above it', own.html, "we&#39;d love to work with you")
lacks('no templated closer below it', own.html, 'Take a look when you have a minute')
lacks('plain text drops the closer too', own.text, 'Take a look when you have a minute')
// The rep's words are the WHOLE email now, greeting included (Wes
// 2026-09-02: the composer opens blank and no longer advertises a greeting
// above the box, so pasting one there would either double the rep's or
// contradict the empty page they were handed).
lacks('no greeting is pasted above the rep', own.html, 'Hi Colin,')
lacks('nor in the plain text', own.text, 'Hi Colin,')
has('the templated fallback still greets', templated.html, 'Hi Colin,')
has('the templated fallback greets in text too', templated.text, 'Hi Colin,')
has('the quote block survives', own.html, 'The Watch Party')
has('the total survives', own.html, '$4,620')
has('the portal button survives', own.html, 'View quote &amp; portal')
has('the sign-off survives', own.html, 'Jose Pacheco')

// ── injection ──
const nasty = render('<script>alert(1)</script> & "quotes"')
lacks('rep prose is escaped', nasty.html, '<script>')
has('escaped, not dropped', nasty.html, '&lt;script&gt;')

// ── the header is not a welcome mat ──
// A hand-script "Welcome!" badge sat in the header of every quote (Wes
// 2026-08-26: same problem as the opener — nobody has arrived yet).
lacks('no Welcome badge in the header', templated.html, 'Welcome!')
lacks('no Bradley Hand badge left behind', templated.html, 'Bradley Hand')

// ── the card-authorization request ──
const card = (customBody: string | null) =>
  buildCardAuthRequestEmail({
    firstName: 'Colin',
    jobName: 'The Watch Party',
    portalLink: 'https://tsx.sirreel.com/portal/v2/tok123',
    agentFirstName: 'Jose',
    personalNote: null,
    customBody,
  })

// agentFirstName matters now: the "Questions? Just reply" line moved INTO
// the default body (2026-08-31, always-open compose box), personalized with
// the agent's name — the seed and the fallback render must use the same one.
const CARD_DEFAULT = defaultEmailBody({
  kind: 'card-auth',
  projectName: 'The Watch Party',
  agentFirstName: 'Jose',
})
const cardTemplated = card(null)
has('card: plain text renders the seeded ask', cardTemplated.text, CARD_DEFAULT)
has('card: the default carries the Questions line', CARD_DEFAULT, 'Questions? Just reply to this email — Jose will sort it out.')
// The templated-fallback ask now renders the SAME paragraphs as an untouched
// compose box (box ⇔ email parity) — which cost the old hardcoded fallback
// its bold job name. The job still has to be named, just unbolded.
has('card: the templated ask names the job', cardTemplated.html, 'Before we can send The Watch Party out the door')
lacks('card: only one Questions line in the text', cardTemplated.text.replace('Questions? Just reply', ''), 'Questions? Just reply')

const cardOwn = card('Ana has the PO — I just need a card behind it so the truck can roll Thursday.')
has("card: the rep's words are the ask", cardOwn.html, 'so the truck can roll Thursday')
lacks('card: no templated ask above it', cardOwn.html, 'out the door, we need a credit card')
lacks('card: no templated closer below it', cardOwn.html, 'Questions, or paying another way')
lacks('card: plain text drops the closer too', cardOwn.text, 'Questions, or paying another way')
// The one paragraph a rep CANNOT write away — it is what distinguishes this
// email from the phishing attempt it structurally resembles.
has('card: the security paragraph survives', cardOwn.html, 'never ask for card details over email')
has('card: the security paragraph survives in text', cardOwn.text, 'never ask for card details over email')
has('card: the secure button survives', cardOwn.html, 'Authorize your card')
// Named alternatives, not a hint to ask (Wes 2026-08-26). Shell, like the
// security paragraph — a rep's own ask must not be able to lose it.
for (const [label, doc] of [['templated', cardTemplated], ['rep-written', cardOwn]] as const) {
  has(`card (${label}): says the card isn't a charge`, doc.html, "you aren't charged by adding it")
  has(`card (${label}): names ACH, Zelle and wire`, doc.html, 'ACH, Zelle and wire transfer')
  has(`card (${label}): plain text carries it too`, doc.text, 'ACH, Zelle and wire transfer')
  // Points at the portal, never at a reply (Wes 2026-08-26) — the client
  // should be able to finish this without waiting on a rep.
  has(`card (${label}): sends them to the portal`, doc.html, 'the details are in your portal, on the button below')
  lacks(`card (${label}): no ask for a reply about payment`, doc.html, "reply and we&#39;ll send the details")
}
// The line lands ABOVE the button — reassurance before the click, not after.
eq('card: payment options precede the CTA',
  cardTemplated.html.indexOf('ACH, Zelle and wire transfer') < cardTemplated.html.indexOf('Authorize your card'),
  true)
lacks('card: no greeting above the rep-written ask', cardOwn.html, 'Hi Colin,')
lacks('card: nor in the plain text', cardOwn.text, 'Hi Colin,')
has('card: the templated fallback still greets', cardTemplated.html, 'Hi Colin,')
has('card: the templated fallback greets in text too', cardTemplated.text, 'Hi Colin,')
has('card: the sign-off survives', cardOwn.html, 'The SirReel Team')
lacks('card: rep prose is escaped', card('<img src=x onerror=1>').html, '<img src=x')

console.log(fail === 0 ? '\nall quote + capture email body checks passed' : `\n${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)

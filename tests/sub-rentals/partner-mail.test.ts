/**
 * Partner mail never shows a partner a SirReel shared inbox.
 *
 * Wes 2026-09-14: "The interaction between Wes and Partners should NEVER cc
 * hello@ or hq@. It needs to come from wes@ and have [wes@] as the only reply
 * option."
 *
 * Worth a test because every failure direction here is INVISIBLE from the
 * code that sends: the CC comes out of an admin-editable notification channel,
 * and the second Reply-To is appended two layers down inside
 * sendAgreementEmail. Nobody finds out until it is in a partner's inbox.
 *
 * The last check is structural — it catches the next partner-facing send
 * somebody writes against sendAgreementEmail directly, which is exactly how
 * this rule gets un-shipped.
 *
 * Run: npm run test:partner-mail
 */
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { stripSharedInboxes, partnerFrom, isWes, WES_EMAIL } from '@/lib/sub-rentals/partnerMail'
import { effectiveReplyTo } from '@/lib/email/sendAgreementEmail'

let fail = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} → ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`)
}

// ── CC: the two addresses a partner must never see ──────────────────────────
eq('hello@ stripped', stripSharedInboxes(['hello@sirreel.com']), [])
eq('hq@ stripped', stripSharedInboxes(['hq@sirreel.com']), [])
eq('case-insensitive', stripSharedInboxes(['HELLO@SirReel.com', 'HQ@sirreel.com']), [])
eq('padded address stripped', stripSharedInboxes([' hello@sirreel.com ']), [])
eq('wes@ survives — he is the copy the conduit wants', stripSharedInboxes(['wes@sirreel.com']), ['wes@sirreel.com'])
eq('rentals@ survives — the desk group is not blocked', stripSharedInboxes(['rentals@sirreel.com']), ['rentals@sirreel.com'])
eq('mixed list keeps the rest', stripSharedInboxes(['wes@sirreel.com', 'hq@sirreel.com', 'dani@sirreel.com']), ['wes@sirreel.com', 'dani@sirreel.com'])
eq('empty in, empty out', stripSharedInboxes(undefined), [])

// ── Reply-To: one option, and only for partner mail ─────────────────────────
// The capture append is still RIGHT for client mail — this is the behaviour
// partner mail opts out of, not a bug being removed.
eq('client mail still gets the capture anchor', effectiveReplyTo('wes@sirreel.com'), ['wes@sirreel.com', 'hello@sirreel.com'])
eq('partner mail gets wes@ alone', effectiveReplyTo('wes@sirreel.com', true), 'wes@sirreel.com')
eq('relay address alone on partner mail', effectiveReplyTo('jobs+abc@sirreel.com', true), 'jobs+abc@sirreel.com')
eq('relay address paired on client mail', effectiveReplyTo('jobs+abc@sirreel.com'), ['jobs+abc@sirreel.com', 'hello@sirreel.com'])
eq('a fully ingested inbox is untouched either way', effectiveReplyTo('jose@sirreel.com', true), 'jose@sirreel.com')
eq('no Reply-To stays absent', effectiveReplyTo(undefined, true), undefined)

// ── From: his own mailbox, and nobody else's ────────────────────────────────
eq('Wes sends as himself', partnerFrom({ email: 'wes@sirreel.com', name: 'Wes Bailey' }), 'Wes Bailey <wes@sirreel.com>')
eq('case-insensitive on the sender', partnerFrom({ email: 'Wes@SirReel.com', name: null }), 'Wes Bailey <wes@sirreel.com>')
eq('anyone else falls back to SirReel HQ', partnerFrom({ email: 'hugo@sirreel.com', name: 'Hugo' }), undefined)
eq('no sender falls back', partnerFrom({ email: null }), undefined)
eq('isWes', [isWes(WES_EMAIL), isWes('dani@sirreel.com'), isWes(null)], [true, false, false])

// ── Structural: partner-facing code cannot reach the raw sender ─────────────
// vendorAccountActions is the one exception and says so: its only send goes
// INTERNALLY to the vendor-portal channel (hq@), never to the partner.
const SUB_RENTALS = join(process.cwd(), 'src/lib/sub-rentals')
const ALLOWED_RAW_SENDERS = new Set(['partnerMail.ts', 'vendorAccountActions.ts'])
const offenders = readdirSync(SUB_RENTALS)
  .filter((f) => f.endsWith('.ts') && !ALLOWED_RAW_SENDERS.has(f))
  .filter((f) => /\bawait sendAgreementEmail\(/.test(readFileSync(join(SUB_RENTALS, f), 'utf8')))
eq('no partner send calls sendAgreementEmail directly', offenders, [])

console.log(fail === 0 ? '\nall partner-mail checks passed' : `\n${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)

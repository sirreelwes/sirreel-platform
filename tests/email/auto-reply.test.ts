/**
 * Auto-reply detection — an out-of-office is not a response.
 *
 *   npm run test:auto-reply
 *
 * Pure + offline. The header fixtures are VERBATIM from the real Gmail
 * messages of 2026-09-08 (pulled with the service account): Oliver's and
 * Jose's vacation responders, and — the case that must NOT match —
 * Oliver's genuine human reply on the same Cortex Creative thread.
 */

import {
  detectAutoReply,
  autoReplyHeaderSignal,
  autoReplySubjectMarker,
  AUTO_REPLY_HEADER_NAMES,
} from '../../src/lib/email/autoReply'

let failures = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`  ok   ${name}`)
  else { failures++; console.log(`  FAIL ${name}`, detail ?? '') }
}

const h = (o: Record<string, string>) => Object.entries(o).map(([name, value]) => ({ name, value }))

// Oliver's responder — the one that muted the Cortex Creative lead.
const OLIVER_OOO = h({
  To: 'jp@ntrlhi.com',
  From: 'Oliver Carlson <oliver@sirreel.com>',
  Subject: 'Out of office Re: New account - Cortex Creative - TS X O',
  'MIME-Version': '1.0',
  Precedence: 'bulk',
  'X-Autoreply': 'yes',
  'Auto-Submitted': 'auto-replied',
})

// Jose's responder — same headers, a completely different subject shape.
const JOSE_OOO = h({
  To: 'dylanpalleyprod@gmail.com',
  From: 'Jose Pacheco <jose@sirreel.com>',
  Subject: 'Sirreel | Out of Office | Closed Re: Rental inquiry// Cortex Creative - Aug 31st - Sept 5th',
  Precedence: 'bulk',
  'X-Autoreply': 'yes',
  'Auto-Submitted': 'auto-replied',
})

// Oliver's REAL reply, later the same day, on the same conversation.
const OLIVER_HUMAN = h({
  'Delivered-To': 'jose@sirreel.com',
  'MIME-Version': '1.0',
  'In-Reply-To': '<CAHwroYj-7yetnw=mKxid0GU_FbRwL=UvKcBCdXip-Kuz3JOCmg@mail.gmail.com>',
  From: 'Oliver Carlson <oliver@sirreel.com>',
  Subject: 'Re: New account - Cortex Creative - TS X O',
  To: 'Dylan Palley <dylanpalleyprod@gmail.com>',
  'Content-Type': 'multipart/alternative; boundary="00000000000020dea1065afa971c"',
})

console.log('the 2026-09-08 messages')
check("Oliver's out-of-office is auto", detectAutoReply({ headers: OLIVER_OOO, subject: 'Out of office Re: New account - Cortex Creative - TS X O' }).isAutoReply)
check("Jose's out-of-office is auto", detectAutoReply({ headers: JOSE_OOO, subject: 'Sirreel | Out of Office | Closed Re: Rental inquiry// Cortex Creative' }).isAutoReply)
check("Oliver's real reply is NOT auto", detectAutoReply({ headers: OLIVER_HUMAN, subject: 'Re: New account - Cortex Creative - TS X O' }).isAutoReply === false)
check('signal names the RFC 3834 header', autoReplyHeaderSignal(OLIVER_OOO) === 'auto-submitted:auto-replied', autoReplyHeaderSignal(OLIVER_OOO))

console.log('headers')
check('Auto-Submitted: auto-generated counts', autoReplyHeaderSignal(h({ 'Auto-Submitted': 'auto-generated' })) === 'auto-submitted:auto-generated')
check('Auto-Submitted: no is a human (RFC 3834)', autoReplyHeaderSignal(h({ 'Auto-Submitted': 'no' })) === null)
check('X-Autorespond counts', autoReplyHeaderSignal(h({ 'X-Autorespond': 'yes' })) === 'x-autorespond:yes')
check('header names are case-insensitive', autoReplyHeaderSignal(h({ 'AUTO-SUBMITTED': 'Auto-Replied' })) === 'auto-submitted:auto-replied')
check('Precedence: bulk alone is NOT enough (newsletters set it)', autoReplyHeaderSignal(h({ Precedence: 'bulk' })) === null)
check('Precedence: auto_reply counts', autoReplyHeaderSignal(h({ Precedence: 'auto_reply' })) === 'precedence:auto_reply')
check('no headers at all → no header signal', autoReplyHeaderSignal([]) === null && autoReplyHeaderSignal(null) === null)
check('the metadata ingests request every header we read', ['Auto-Submitted', 'X-Autoreply', 'X-Autorespond', 'Precedence'].every((n) => (AUTO_REPLY_HEADER_NAMES as readonly string[]).includes(n)))

console.log('subject fallback (rows ingested before header capture)')
check('banner before the Re: matches', autoReplySubjectMarker('Out of office Re: New account - Cortex Creative'))
check("Jose's pipe-delimited banner matches", autoReplySubjectMarker('Sirreel | Out of Office | Closed Re: Rental inquiry// Cortex Creative'))
check('Automatic reply: matches', autoReplySubjectMarker('Automatic reply: Cube availability'))
check('a plain human reply does not match', autoReplySubjectMarker('Re: New account - Cortex Creative - TS X O') === false)
check('a HUMAN reply ABOUT an absence does not match', autoReplySubjectMarker('Re: out of office coverage next week') === false)
// Three of Jose's real messages carried exactly this subject — a human
// telling someone to set their responder. A banner needs a subject after it.
check('a bare "Out of Office" subject is a human', autoReplySubjectMarker('Out of Office') === false)
check('Outlook\'s banner (no Re: anywhere) still matches', autoReplySubjectMarker('Automatic reply: Rental inquiry'))
check('the known remaining false positive is documented', autoReplySubjectMarker('Out of office coverage next week') === true)
check('empty subject is not auto', autoReplySubjectMarker('') === false && autoReplySubjectMarker(null) === false)

console.log('precedence of signals')
check('headerless auto-reply still caught by the banner', detectAutoReply({ subject: 'Out of office Re: Cube #29' }).isAutoReply)
check('banner verdict is labelled as such', detectAutoReply({ subject: 'Out of office Re: Cube #29' }).signal === 'subject')
check('header wins the label when both fire', detectAutoReply({ headers: OLIVER_OOO, subject: 'Out of office Re: x' }).signal === 'auto-submitted:auto-replied')
check('nothing at all is not auto', detectAutoReply({}).isAutoReply === false)

console.log(failures === 0 ? '\nall passed' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)

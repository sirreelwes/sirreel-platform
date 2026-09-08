/**
 * Outbound conversation threading.  npm run test:threading-headers
 *
 * Wes 2026-09-08: a reply an agent sends from HQ should land INSIDE the
 * client's existing email thread, not next to it.
 *
 * Two failures are guarded here, and the second is the serious one:
 *
 *  1. Threading that silently does nothing — a dropped In-Reply-To, a
 *     References chain missing its root, a subject that reads
 *     "Re: Re: Re:". The email still sends, so nothing alerts; it just
 *     keeps arriving as a new conversation, which is the bug we started
 *     from.
 *
 *  2. HEADER INJECTION. A parent Message-ID is a stranger's text taken
 *     off inbound mail and put into an SMTP header. A CR or LF that
 *     survives normalization ends the header and starts writing new ones
 *     — a Bcc, a different Reply-To. Every hostile-input case below must
 *     return null rather than a repaired string: repairing an id that
 *     contains a newline is how you ship the vulnerability while passing
 *     a "does it strip newlines" test.
 */

import { quickReplySendSubject } from '../../src/lib/sales/quickReply'
import {
  MAX_REFERENCES,
  buildReferences,
  buildThreadingHeaders,
  mintMessageId,
  normalizeMessageId,
  normalizeMessageIds,
  parseMessageIds,
  replySubject,
  threadingForReplyTo,
} from '../../src/lib/email/threadingHeaders'

const failures: string[] = []
const check = (c: boolean, why: string) => {
  console.log(c ? `  ok   ${why}` : `  FAIL ${why}`)
  if (!c) failures.push(why)
}

console.log('A Message-ID is recognised whether or not it carries brackets')
check(normalizeMessageId('<abc@mail.com>') === '<abc@mail.com>', 'bracketed passes through')
check(normalizeMessageId('abc@mail.com') === '<abc@mail.com>', 'bare gets brackets')
check(normalizeMessageId('  <abc@mail.com>  ') === '<abc@mail.com>', 'surrounding space trimmed')
check(normalizeMessageId('CAF=1a_b+c@mail.gmail.com') === '<CAF=1a_b+c@mail.gmail.com>', 'real Gmail id shape')

console.log('\nHostile input is REFUSED, never repaired')
for (const [label, input] of [
  ['a newline mid-id', '<a@b.com>\r\nBcc: attacker@evil.com'],
  ['a bare LF', '<a@b.com>\nX-Evil: 1'],
  ['a bare CR', '<a@b.com>\rX-Evil: 1'],
  ['an embedded space', '<a b@mail.com>'],
  ['nested brackets', '<<a@b.com>>'],
  ['no @ at all', '<notanid>'],
  ['two @ signs', '<a@b@c.com>'],
  ['an empty local part', '<@b.com>'],
  ['an empty domain', '<a@>'],
  ['nothing but brackets', '<>'],
  ['an empty string', ''],
  ['a 600-char id', `<${'x'.repeat(600)}@b.com>`],
] as const) {
  check(normalizeMessageId(input) === null, `${label} → null`)
}
check(normalizeMessageId(null) === null, 'null → null')
check(normalizeMessageId(undefined) === null, 'undefined → null')

console.log('\nA chain drops the bad ids and keeps the good ones, in order')
{
  const chain = normalizeMessageIds('<a@x.com> <bad id> <b@x.com> <a@x.com>')
  check(chain.length === 2, 'two survive out of four')
  check(chain[0] === '<a@x.com>' && chain[1] === '<b@x.com>', 'order preserved, duplicate dropped')
  check(parseMessageIds('<a@x.com> <b@x.com>').length === 2, 'parser finds both raw ids')
  check(parseMessageIds(null).length === 0, 'a null header parses to nothing')
}

console.log('\nReferences = the parent chain PLUS the parent (RFC 5322 §3.6.4)')
{
  const refs = buildReferences('<root@x.com> <mid@x.com>', '<parent@x.com>')
  check(refs === '<root@x.com> <mid@x.com> <parent@x.com>', 'parent appended to the chain')
  check(
    buildReferences(null, '<parent@x.com>') === '<parent@x.com>',
    'a first reply references just the parent',
  )
  check(buildReferences(null, null) === null, 'nothing to reference → null, so the header is omitted')
  check(
    buildReferences('<root@x.com>', '<root@x.com>') === '<root@x.com>',
    'a parent already in the chain is not repeated',
  )
  check(
    buildReferences('<a@x.com> <bad id>', null) === '<a@x.com>',
    'an unusable id in the chain is dropped, not fatal',
  )
}

console.log('\nA long chain keeps the ROOT — that is what places the thread')
{
  const long = Array.from({ length: 40 }, (_, i) => `<m${i}@x.com>`).join(' ')
  const refs = buildReferences(long, '<parent@x.com>')!.split(' ')
  check(refs.length === MAX_REFERENCES, `trimmed to ${MAX_REFERENCES}`)
  check(refs[0] === '<m0@x.com>', 'the root survives the trim')
  check(refs[refs.length - 1] === '<parent@x.com>', 'the immediate parent survives the trim')
}

console.log('\nRe: is added once and only once')
check(replySubject('Quote for Tuesday') === 'Re: Quote for Tuesday', 'a plain subject gets Re:')
check(replySubject('Re: Quote') === 'Re: Quote', 'an existing Re: is not doubled')
check(replySubject('RE: Quote') === 'RE: Quote', 'uppercase RE: counts')
check(replySubject('re:Quote') === 're:Quote', 'no-space re: counts')
check(replySubject('Re[2]: Quote') === 'Re[2]: Quote', 'Outlook Re[2]: counts')
check(replySubject('Fwd: Quote') === 'Re: Fwd: Quote', 'replying to a forward IS a reply')
check(replySubject('') === 'Re:', 'an empty subject still yields something valid')
check(replySubject(null) === 'Re:', 'a null subject does not throw')

console.log('\nA minted id is ours, on our domain, and unique')
{
  const a = mintMessageId('quick-reply')
  const b = mintMessageId('quick-reply')
  check(a !== b, 'two mints differ')
  check(normalizeMessageId(a) === a, 'a minted id is already canonical')
  check(a.endsWith('@sirreel.com>'), 'minted on the sending domain')
  check(a.startsWith('<quick-reply.'), 'the kind prefix is readable in a header dump')
  check(
    normalizeMessageId(mintMessageId('../../evil header')) !== null,
    'a hostile kind still yields a valid id',
  )
  check(
    !mintMessageId('../../evil header').includes('/'),
    'and the hostile characters are gone from it',
  )
}

console.log('\nThe headers handed to the mail API are always safe')
{
  const t = threadingForReplyTo({
    kind: 'quick-reply',
    parentMessageId: '<parent@x.com>',
    parentReferences: '<root@x.com>',
  })
  const h = buildThreadingHeaders(t)!
  check(h['In-Reply-To'] === '<parent@x.com>', 'In-Reply-To is the parent')
  check(h['References'] === '<root@x.com> <parent@x.com>', 'References carries root then parent')
  check(!!h['Message-ID'], 'we assign our own Message-ID')
  check(
    Object.values(h).every((v) => !/[\r\n]/.test(v)),
    'no header value contains CR or LF',
  )
}
{
  // A brand-new outbound with no parent: still gets a Message-ID so the
  // client's reply is linkable, but no empty In-Reply-To / References.
  const h = buildThreadingHeaders({ messageId: mintMessageId('quote') })!
  check(!!h['Message-ID'], 'a fresh send still carries a Message-ID')
  check(!('In-Reply-To' in h), 'no In-Reply-To when there is no parent')
  check(!('References' in h), 'no empty References header')
}
{
  // A poisoned parent must degrade to "no threading", not to a bad header.
  const t = threadingForReplyTo({
    kind: 'quick-reply',
    parentMessageId: '<a@b.com>\r\nBcc: attacker@evil.com',
    parentReferences: '<x@y.com>\r\nX-Evil: 1',
  })
  const h = buildThreadingHeaders(t)!
  check(!('In-Reply-To' in h), 'a poisoned parent id is dropped entirely')
  check(
    Object.values(h).every((v) => !/[\r\n]/.test(v)),
    'nothing injectable survives into any header',
  )
  check(!!h['Message-ID'], 'and the send still gets its own id')
}
check(buildThreadingHeaders(null) === undefined, 'no threading → no headers object')

console.log('\nPreview and send agree on the subject, always')
{
  // The agent approves the preview. If preview and send computed the
  // subject differently, the approval would be for an email nobody sent.
  const composed = 'SirReel — availability for your shoot'
  check(
    quickReplySendSubject(composed, 'Need a 5-ton Tuesday') === 'Re: Need a 5-ton Tuesday',
    'answering a real inbound replies under their subject',
  )
  check(
    quickReplySendSubject(composed, 'Re: Need a 5-ton') === 'Re: Need a 5-ton',
    'their existing Re: is not doubled',
  )
  check(
    quickReplySendSubject(composed, null) === composed,
    'no parent → the composed subject stands',
  )
  check(
    quickReplySendSubject(composed, '   ') === composed,
    'a whitespace-only parent subject is not a subject',
  )
}

console.log(
  failures.length === 0
    ? '\nAll threading checks passed.'
    : `\n${failures.length} FAILURE(S):\n` + failures.map((f) => `  - ${f}`).join('\n'),
)
process.exit(failures.length === 0 ? 0 : 1)

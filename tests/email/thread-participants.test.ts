/**
 * Who a reply from the Job page is addressed to.
 *
 * Worth a test because every failure here is silent and lands in a
 * client's inbox — or fails to. Three of them, all seen in real data:
 *
 *  · A junk token reaching the CC line. The Gmail ingest splits the raw
 *    To: header on commas, so a quoted display name shatters: Fox Sports'
 *    thread stores `"proval` beside `marc.proval@fox.com`. Resend rejects
 *    the WHOLE send on one malformed recipient, so this costs the agent
 *    the email, not just the copy.
 *  · An internal address echoed back at a client, making dani@ look like
 *    their contact.
 *  · The To: defaulting to ourselves on a thread whose last message is
 *    our own send — the person waiting on an answer is whoever wrote in.
 *
 * Run: npm run test:thread-participants
 */
import { participantsForReply, type ParticipantMessage } from '@/lib/email/threadParticipants'

let fail = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} → ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`)
}

const msg = (o: Partial<ParticipantMessage> & { id: string; sentAt: string }): ParticipantMessage => ({
  fromAddress: 'client@example.com',
  toAddresses: [],
  direction: 'inbound',
  routingHeaders: null,
  ...o,
})

// The Daydream thread, which is what Wes was looking at when he asked
// for the button: client writes in, loops two more people onto the last
// message, and the reply must carry all three.
const daydream = [
  msg({ id: 'm1', sentAt: '2026-09-09T17:54:00Z', fromAddress: 'm.makes.art@gmail.com', toAddresses: ['info@sirreel.com'] }),
  msg({
    id: 'm2', sentAt: '2026-09-09T19:37:00Z', fromAddress: 'Mikey Errante <mikey@daydream.com>',
    routingHeaders: { to: 'info@sirreel.com', cc: 'm woods <m.makes.art@gmail.com>, quinn biddle <quinnbiddle@gmail.com>' },
  }),
]
eq('to = who last wrote in', participantsForReply(daydream).to, 'mikey@daydream.com')
eq('cc = everyone else on the latest email', participantsForReply(daydream).cc, [
  'm.makes.art@gmail.com',
  'quinnbiddle@gmail.com',
])
eq('our own people reported, not CC\'d', participantsForReply(daydream).internal, ['info@sirreel.com'])

// Junk in toAddresses must never reach a recipient list.
const foxSports = [
  msg({
    id: 'f1', sentAt: '2026-09-09T18:00:00Z', fromAddress: 'Jose Pacheco <jose@sirreel.com>', direction: 'outbound',
    toAddresses: ['"proval', 'marc.proval@fox.com', 'dani@sirreel.com'],
    routingHeaders: { to: '"proval, marc" <marc.proval@fox.com>', cc: 'dani novoa <dani@sirreel.com>' },
  }),
]
eq('shattered display name dropped', participantsForReply(foxSports).cc, [])
eq('the real address survives it', participantsForReply(foxSports).to, 'marc.proval@fox.com')

// Our own send last: the To: comes off the last INBOUND message, not the
// latest one, or we would address the reply to ourselves.
const weSpokeLast = [
  msg({ id: 'a1', sentAt: '2026-09-01T10:00:00Z', fromAddress: 'client@example.com' }),
  msg({
    id: 'a2', sentAt: '2026-09-02T10:00:00Z', fromAddress: 'wes@sirreel.com', direction: 'outbound',
    toAddresses: ['client@example.com'], routingHeaders: { cc: 'coord@example.com' },
  }),
]
eq('to skips our own last send', participantsForReply(weSpokeLast).to, 'client@example.com')
eq('cc keeps the coordinator we added', participantsForReply(weSpokeLast).cc, ['coord@example.com'])

// Someone dropped from the conversation is not re-addressed by us.
const dropped = [
  msg({ id: 'd1', sentAt: '2026-09-01T10:00:00Z', fromAddress: 'gone@example.com' }),
  msg({ id: 'd2', sentAt: '2026-09-02T10:00:00Z', fromAddress: 'wes@sirreel.com', direction: 'outbound', toAddresses: ['still@example.com'] }),
]
eq('dropped participant not re-addressed', participantsForReply(dropped).to, 'still@example.com')

// Order independence — callers select desc, the page renders asc.
eq('input order does not matter', participantsForReply([...daydream].reverse()).cc, participantsForReply(daydream).cc)

eq('empty thread', participantsForReply([]), { to: null, cc: [], internal: [], sourceMessageId: null, sourceSentAt: null })

console.log(fail === 0 ? '\nall thread-participant checks passed' : `\n${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)

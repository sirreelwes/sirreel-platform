/**
 * One thread per job — the pure rules (no prisma, no I/O).
 *
 * Wes 2026-09-16: "figure out a way to have individual jobs stay on one
 * thread. For the client to have a single thread would be better."
 * Design: docs/specs/job-thread-one-conversation.md. Phase 1 is these
 * rules + jobThread.ts (the send wrapper) + the pubsub auto-filing.
 *
 * Why a thread shattered before: no send carried proof of its job. Every
 * client-facing email left Resend with a fresh Message-ID, no References,
 * its own subject and its own Reply-To, so the quote, the welcome, the
 * paperwork summary and the invoice were four conversations in the
 * client's inbox and four unfiled threads in HQ.
 *
 * The fix is three ANCHORS on every send:
 *   A. an HQ-minted Message-ID + In-Reply-To / References back to the
 *      job's earlier messages (the strong one — proves membership from
 *      any inbox, any mail program, and makes `hasKnownConversationLink`
 *      match a FIRST reply, which is what wes@'s private LINKED mode
 *      could never do before);
 *   B. the job address `jobs+<jobcode>@sirreel.com` on Cc — the driver-
 *      relay plus-address mechanism (driverRelay.ts) pointed at a job
 *      code. Lands in jobs@ (watched), needs no Workspace change, and
 *      survives a retitled subject, a reply-all and a forward. Cc, NEVER
 *      Reply-To: Reply-To replaces the human, and the client's plain
 *      "Reply" must still reach Jose;
 *   C. one stable subject per job — Gmail groups on the References chain
 *      AND a matching subject (prefixes stripped), so every send on the
 *      thread carries the same one, with "Re:" once.
 *
 * Tested by `npm run test:job-thread`.
 */

/** The watched Workspace mailbox the job address rides on — same as the driver relay. */
export const JOB_THREAD_MAILBOX = 'jobs'
export const JOB_THREAD_DOMAIN = 'sirreel.com'

/**
 * Custom header carrying the minted Message-ID. Resend may or may not
 * honour a caller-supplied Message-ID; this header always survives, so
 * the ingest can recognise HQ's OWN copy (it lands in jobs@ via anchor B)
 * and fold it onto the row the send already recorded instead of storing
 * it twice. If Resend does rewrite the Message-ID, that ingested copy
 * carries the REAL one — and a client reply referencing it still
 * resolves, because the copy is a row on a thread filed to the job.
 */
export const JOB_MESSAGE_HEADER = 'X-SirReel-Job-Message'

/** Job codes are `SR-JOB-0001`. Lower-cased in the address; matched either way. */
const JOB_CODE_RE = /^sr-job-\d{1,6}$/i

export function isJobCode(s: string | null | undefined): boolean {
  return !!s && JOB_CODE_RE.test(s.trim())
}

/** `jobs+sr-job-0219@sirreel.com` */
export function jobThreadAddress(jobCode: string): string {
  return `${JOB_THREAD_MAILBOX}+${jobCode.trim().toLowerCase()}@${JOB_THREAD_DOMAIN}`
}

/**
 * Pull a job code out of whatever the mail server put on the message.
 * Accepts the plus form we mint and the dotted form (`sr-job-0219.jobs@`)
 * a future routing rule would enable — same tolerance as parseRelayTag.
 * Returns the code UPPER-CASED as Job.jobCode stores it, or null for
 * ordinary jobs@ mail and for driver-relay tags — this must never claim
 * a message that isn't a job thread's.
 */
export function parseJobThreadTag(header: string | null | undefined): string | null {
  if (!header) return null
  const candidates = header.toLowerCase().match(/[^\s<>,;"]+@[^\s<>,;"]+/g) ?? []
  for (const raw of candidates) {
    const [local, domain] = raw.split('@')
    if (domain !== JOB_THREAD_DOMAIN || !local) continue
    let tag: string | null = null
    if (local.startsWith(`${JOB_THREAD_MAILBOX}+`)) tag = local.slice(JOB_THREAD_MAILBOX.length + 1)
    else if (local.endsWith(`.${JOB_THREAD_MAILBOX}`)) tag = local.slice(0, -(JOB_THREAD_MAILBOX.length + 1))
    if (tag && JOB_CODE_RE.test(tag)) return tag.toUpperCase()
  }
  return null
}

/** First job code found across several headers (To, Cc, Delivered-To, X-Original-To). */
export function jobCodeFromHeaders(headers: Array<string | null | undefined>): string | null {
  for (const h of headers) {
    const code = parseJobThreadTag(h)
    if (code) return code
  }
  return null
}

/**
 * The subject a job's thread is born with when HQ opens the
 * conversation: `Big Production — SirReel (SR-JOB-0219)`. When the
 * CLIENT opened it (a filed inbound thread exists) the root adopts THAT
 * subject instead — see rootSubjectFor — because continuing their thread
 * is more "one thread" than starting ours.
 */
export function mintedJobSubject(jobName: string, jobCode: string): string {
  const name = (jobName || '').trim() || 'Your production'
  return `${name} — SirReel (${jobCode.trim().toUpperCase()})`
}

/** Strip reply/forward prefixes so "Re: Re: Fwd: X" and "X" agree. */
export function normalizeSubject(subject: string | null | undefined): string {
  let s = (subject || '').trim()
  // Loop: prefixes stack ("Re: Fwd: Re:") and come in several spellings.
  for (let i = 0; i < 6; i++) {
    const next = s.replace(/^(re|fwd?|fw|aw|wg)\s*(\[\d+\])?\s*:\s*/i, '').trim()
    if (next === s) break
    s = next
  }
  return s
}

/**
 * Pick the root subject for a job whose thread is being created now.
 * `filedSubject` is the subject of the newest thread already filed to the
 * job (the client's inquiry, typically). Empty / placeholder → minted.
 */
export function rootSubjectFor(args: {
  jobName: string
  jobCode: string
  filedSubject?: string | null
}): string {
  const adopted = normalizeSubject(args.filedSubject)
  if (adopted && adopted.toLowerCase() !== '(no subject)') return adopted
  return mintedJobSubject(args.jobName, args.jobCode)
}

/** Gmail's rule: prefix once, never stack. First message on the thread carries none. */
export function threadSendSubject(rootSubject: string, isFirst: boolean): string {
  const base = normalizeSubject(rootSubject) || rootSubject.trim()
  return isFirst ? base : `Re: ${base}`
}

/**
 * `<jt.sr-job-0219.<uuid>@sirreel.com>` — recognisable, never collides
 * with a Gmail or Resend id. Angle brackets included: that is the RFC
 * 5322 form, and it is what EmailMessage.rfc822MessageId stores off the
 * wire, so equality against ingested headers holds byte for byte.
 */
export function mintJobMessageId(jobCode: string, uuid: string): string {
  return `<jt.${jobCode.trim().toLowerCase()}.${uuid}@${JOB_THREAD_DOMAIN}>`
}

/** Angle-bracket tokens from a References / In-Reply-To header. */
export function parseMessageIds(header: string | null | undefined): string[] {
  if (!header) return []
  return header.match(/<[^<>\s]+>/g) ?? []
}

/**
 * The threading headers for the next send. `root` is the job's earliest
 * message id, `last` its newest (the one we are answering). References
 * lists root → last, deduped; In-Reply-To names the last. An empty
 * chain (first send on a job with nothing filed) sets neither.
 */
export function threadingHeaders(args: {
  messageId: string
  rootMessageId?: string | null
  lastMessageId?: string | null
}): Record<string, string> {
  const headers: Record<string, string> = {
    'Message-ID': args.messageId,
    [JOB_MESSAGE_HEADER]: args.messageId,
  }
  const chain = Array.from(
    new Set([args.rootMessageId, args.lastMessageId].filter((x): x is string => !!x)),
  )
  if (chain.length > 0) {
    headers['In-Reply-To'] = chain[chain.length - 1]
    headers['References'] = chain.join(' ')
  }
  return headers
}

/**
 * Add the job address to a Cc list without ever duplicating it or
 * putting it beside itself in To. Returns a NEW array; input untouched.
 */
export function withJobAddress(cc: string[] | undefined, to: string[], jobCode: string): string[] {
  const address = jobThreadAddress(jobCode)
  const seen = new Set(to.map((a) => a.trim().toLowerCase()))
  const out: string[] = []
  for (const a of cc ?? []) {
    const k = a.trim().toLowerCase()
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(a.trim())
  }
  if (!seen.has(address)) out.push(address)
  return out
}

/** The job address is ours; keep it out of the stored participant list. */
export function withoutJobAddress(addresses: string[]): string[] {
  return addresses.filter((a) => !parseJobThreadTag(a))
}

/** EmailThread.gmailThreadId of the job's root thread — deterministic, one per job. */
export function jobRootThreadKey(jobId: string): string {
  return `hq-job-${jobId}`
}

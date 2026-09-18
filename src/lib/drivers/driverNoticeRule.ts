/**
 * "Does the driver need to be told, and what do we say?" — pure, no
 * prisma, so the test runs offline and a client component could read it.
 * The database half and the story are in ./driverChangeNotice.ts, which
 * re-exports everything here.
 *
 * Jose, 2026-09-18 (SR-JOB-0379, Bryght Young Things): "This was on P2
 * and driver info was already submitted. I just changed it to P10 and
 * made it Blind pick up. Will driver get updated vehicle info and
 * instructions for Blind pick up?"
 *
 * The page did. Nothing else did. The driver's link is recomputed on
 * every open (api/drive/[token]) and the swap re-points the
 * DriverAssignment at the replacement (scheduling/assignUnit), so David
 * Trinidad's page already said Pass 10. But `unattendedPickup` on his
 * INVITE was computed once, at send time — so the only message he ever
 * received named Pass 2 and, if the job was not blind that morning, told
 * him someone would meet him. A driver who does not re-open the link
 * drives to the yard looking for the wrong van expecting the wrong
 * handoff.
 *
 * ── What counts as worth a message ────────────────────────────────
 *
 * Only what a driver would DO differently: the vehicle they are looking
 * for, and whether anybody will be there at either end. A date move, a
 * kit change or a rate is not this — those reach them through the page.
 * Nothing changed means nothing is sent; that is what keeps a rep
 * flipping a chip back and forth off a stranger's phone.
 *
 * ── The line that earns the feature ───────────────────────────────
 *
 * `lockboxMoved`. A swap on a blind handoff replaces the one secret the
 * driver was given: the lockbox code on their page is the NEW van's, and
 * the old one does not open it. A driver told only "you're on Pass 10"
 * will still try the code they wrote down.
 */

export type DriverChange =
  | 'vehicle'
  /** Nobody meets them at pickup now; somebody did before. */
  | 'pickup-unattended'
  | 'pickup-attended'
  | 'return-unattended'
  | 'return-attended'

/** One edge of the handoff, before and after the rep's change. */
export interface EdgeChange {
  before: boolean
  now: boolean
}

export interface DriverNoticeFacts {
  /**
   * TRUE when this is a swap, whatever we can or cannot name. The
   * authoritative signal, and a caller that knows it swapped must pass
   * it: `previousUnitName` alone is not enough, because a failed lookup
   * of the outgoing asset would then read as "nothing changed" and the
   * driver would be told nothing at all — the exact case this exists for.
   * Left out, it is inferred from `previousUnitName`.
   */
  vehicleChanged?: boolean
  /** The unit swapped out, when we can name it. */
  previousUnitName?: string | null
  unitName: string
  productionName?: string | null
  /** YYYY-MM-DD. */
  pickupDate?: string | null
  pickup: EdgeChange
  dropoff: EdgeChange
}

/**
 * What changed, in the order a driver needs to hear it. The vehicle leads
 * because it is the fact they act on first — they have to find the truck
 * before anything else about the handoff matters.
 */
export function driverChanges(f: DriverNoticeFacts): DriverChange[] {
  const out: DriverChange[] = []
  const swapped = f.vehicleChanged ?? !!f.previousUnitName
  // A swap onto the SAME unit name is not a change to anybody outside the
  // database: the rep re-picked the truck that was already there.
  if (swapped && f.previousUnitName !== f.unitName) out.push('vehicle')
  if (f.pickup.now !== f.pickup.before) out.push(f.pickup.now ? 'pickup-unattended' : 'pickup-attended')
  if (f.dropoff.now !== f.dropoff.before) out.push(f.dropoff.now ? 'return-unattended' : 'return-attended')
  return out
}

/**
 * The swap that replaced the code. True only when the vehicle moved AND
 * this handoff releases a lockbox code at either end — the case where the
 * driver is holding a secret that no longer opens anything.
 */
export function lockboxMoved(f: DriverNoticeFacts, changes: DriverChange[]): boolean {
  return changes.includes('vehicle') && (f.pickup.now || f.dropoff.now)
}

/**
 * What a repeat of this exact message would look like, for the dedupe.
 *
 * It carries the RESULT, not just the kinds of change: a rep swapping
 * A→B and then B→C within the window produces `['vehicle']` both times,
 * and swallowing the second would leave the driver believing they are on
 * B. Two taps on one swap produce the same string and are collapsed;
 * two different swaps never do.
 */
export function noticeSignature(f: DriverNoticeFacts, changes: DriverChange[]): string {
  return JSON.stringify({
    changes,
    unit: f.unitName,
    pickup: f.pickup.now,
    dropoff: f.dropoff.now,
  })
}

/** The subject line. The vehicle outranks the edges — see driverChanges. */
export function noticeSubject(f: DriverNoticeFacts, changes: DriverChange[]): string {
  const show = f.productionName?.trim() ? ` for ${f.productionName.trim()}` : ''
  if (changes.includes('vehicle')) return `Change of vehicle — you're driving ${f.unitName}${show}`
  if (changes.includes('pickup-unattended')) return `Nobody will meet you at pickup${show}`
  if (changes.includes('pickup-attended')) return `Someone will meet you at pickup${show}`
  if (changes.includes('return-unattended')) return `Your drop-off is now unattended${show}`
  if (changes.includes('return-attended')) return `Someone will receive your drop-off${show}`
  return `An update on your SirReel pickup${show}`
}

/**
 * The body, as plain sentences. ONE source for the email's html, the
 * email's text and (trimmed) the text message, so the three cannot
 * describe the same change differently.
 */
export function noticeLines(f: DriverNoticeFacts, changes: DriverChange[]): string[] {
  const out: string[] = []
  for (const c of changes) {
    if (c === 'vehicle') {
      out.push(
        f.previousUnitName
          ? `You're now driving ${f.unitName}, not ${f.previousUnitName}. Same production, same dates — different vehicle.`
          : `You're now driving ${f.unitName}.`,
      )
    } else if (c === 'pickup-unattended') {
      out.push(
        `Nobody will be at the yard to meet you. Your driver page has the gate code, the lockbox code for the keys and the pickup instructions — and before you drive off it will ask you to photograph all four sides of the vehicle and note the mileage.`,
      )
    } else if (c === 'pickup-attended') {
      out.push(`Someone from SirReel will now meet you at the yard, so you don't need to do the walk-around yourself.`)
    } else if (c === 'return-unattended') {
      out.push(`Nobody will be there to receive the vehicle when you bring it back. Your page has the drop-off steps.`)
    } else if (c === 'return-attended') {
      out.push(`Someone from SirReel will now be there to receive the vehicle when you bring it back.`)
    }
  }
  if (lockboxMoved(f, changes)) {
    out.push(
      `The lockbox code on your page is ${f.unitName}'s — the code you were given for ${f.previousUnitName ?? 'the other vehicle'} will not open it. Please check the page before you set off.`,
    )
  }
  return out
}

/**
 * The text-message version. Short enough to read on a lock screen, and it
 * never carries a code — those are released on the page, once, to a
 * driver who has a name, a number and a licence on file.
 */
export function driverNoticeSms(args: {
  driverFirstName?: string | null
  facts: DriverNoticeFacts
  changes: DriverChange[]
  jobLink: string
}): string {
  const { facts: f, changes } = args
  const hi = args.driverFirstName?.trim() ? `${args.driverFirstName.trim()}, ` : ''
  const show = f.productionName?.trim() ? ` for ${f.productionName.trim()}` : ''
  const head = changes.includes('vehicle')
    ? f.previousUnitName
      ? `${hi}change of vehicle${show}: you're on ${f.unitName} now, not ${f.previousUnitName}.`
      : `${hi}you're on ${f.unitName} now${show}.`
    : changes.includes('pickup-unattended')
      ? `${hi}nobody will meet you at the yard for ${f.unitName}${show}.`
      : changes.includes('pickup-attended')
        ? `${hi}someone will meet you at the yard for ${f.unitName}${show}.`
        : changes.includes('return-unattended')
          ? `${hi}your drop-off of ${f.unitName}${show} is now unattended.`
          : `${hi}someone will be there to take ${f.unitName} back${show}.`
  const extra = lockboxMoved(f, changes)
    ? ` The lockbox code on your page is ${f.unitName}'s — the old one won't open it.`
    : changes.includes('vehicle') && changes.includes('pickup-unattended')
      ? ' Nobody will meet you — your page has the steps and the codes.'
      : ''
  return `SirReel: ${head}${extra} Your link is the same: ${args.jobLink}`
}

// ── Which way the message travels ────────────────────────────────────

export interface DriverReach {
  /** Where the INVITE went — the channel this driver is already on. */
  invitedByEmail?: string | null
  invitedBySms?: string | null
  /** Their file, which may have learned the other one since. */
  email?: string | null
  phone?: string | null
}

export interface NoticeRoute {
  channel: 'SMS' | 'EMAIL'
  to: string
}

/**
 * The invite's own channel first: it is where this driver has heard from
 * us, and a change notice arriving somewhere new reads like a different
 * conversation. Only when that channel has nothing on file do we fall
 * back to the other. Neither → nothing is sent, and the caller is told so
 * rather than left believing the driver was reached.
 */
export function noticeRoute(r: DriverReach): NoticeRoute | null {
  const sms = (r.invitedBySms || '').trim()
  const mail = (r.invitedByEmail || '').trim()
  if (sms) return { channel: 'SMS', to: sms }
  if (mail) return { channel: 'EMAIL', to: mail }
  const ownMail = (r.email || '').trim()
  if (ownMail) return { channel: 'EMAIL', to: ownMail }
  const ownPhone = (r.phone || '').trim()
  if (ownPhone) return { channel: 'SMS', to: ownPhone }
  return null
}

// ── Reporting it back to the rep ─────────────────────────────────────

export interface DriverNoticeOutcome {
  driverAssignmentId: string
  driverName: string
  changes: DriverChange[]
  channel: 'SMS' | 'EMAIL' | null
  sentTo: string | null
  status: 'sent' | 'failed' | 'unreachable' | 'duplicate'
  /** Why it failed, for the rep's line. */
  detail?: string
}

/**
 * One sentence for the screen the rep is standing on: who was reached and
 * who was not. A driver we could NOT reach is the whole point of saying
 * anything — that rep has to pick up a phone — so an unreachable or
 * failed row is never folded into a count.
 *
 * Null when there is nothing to report (nobody named, or the only rows
 * are repeats of a message already sent).
 */
export function describeNotices(outcomes: DriverNoticeOutcome[]): {
  text: string
  tone: 'good' | 'warn'
} | null {
  const sent = outcomes.filter((o) => o.status === 'sent')
  const stuck = outcomes.filter((o) => o.status === 'failed' || o.status === 'unreachable')
  if (sent.length === 0 && stuck.length === 0) return null
  const parts: string[] = []
  if (sent.length) {
    parts.push(
      sent
        .map((o) => `${o.driverName} was ${o.channel === 'SMS' ? 'texted' : 'emailed'}`)
        .join(' · '),
    )
  }
  for (const o of stuck) {
    parts.push(
      o.status === 'unreachable'
        ? `${o.driverName} has no email or mobile on file — tell them yourself`
        : `${o.driverName} could NOT be reached (${o.detail || 'send failed'}) — tell them yourself`,
    )
  }
  return { text: parts.join(' · '), tone: stuck.length ? 'warn' : 'good' }
}

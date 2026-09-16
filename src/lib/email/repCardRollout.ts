/**
 * ONE switch over both places a rep's face reaches a client.
 *
 * Wes 2026-09-16: "I want to test the system personally before we make it
 * live for the team", and then "gate the thank-you behind the same switch".
 * So `SiteSetting.repCardEnabled` is DARK by default and covers two
 * surfaces, which it gates differently because the risk is different:
 *
 *   WELCOME EMAIL — the rep CARD is suppressed. The mail itself is long
 *     since live and approved, so it goes out exactly as it did before;
 *     only the photo block waits. Keyed on the JOB'S AGENT, because that
 *     is whose face and signature the card carries.
 *
 *   THANK-YOU EMAIL — the whole SEND is held. Its copy still says
 *     "[[PLACEHOLDER]] — NEEDS WES REVIEW BEFORE FIRST REAL SEND" and
 *     nothing has ever been sent through it, so letting a rep send draft
 *     wording without a photo would be worse than holding it, not better.
 *     Keyed on the SENDER, because the question there is who may press the
 *     button. Preview stays open to everyone — reading it is how the copy
 *     gets reviewed.
 *
 * Either way Wes sends himself the real thing and reads it in a real inbox,
 * which is the only way to know a 72px photo actually arrives. Nothing about
 * Jose's or Oliver's mail changes in the meantime.
 *
 * An EMAIL allowlist, not a role check, for the reason ownerAllowlist.ts and
 * exports/approver.ts both give: ADMIN is held by Wes AND Dani, so
 * `role === 'ADMIN'` would quietly make this a two-person test.
 *
 * Turning it on for everyone is one toggle on /admin/who-we-are — no deploy,
 * and flipping it back off is the same toggle, which is what makes it a safe
 * thing to try on a Tuesday.
 */

import { prisma } from '@/lib/prisma'

/** Who may exercise either surface while the rollout is still off. */
const REP_CARD_TESTERS: ReadonlyArray<string> = ['wes@sirreel.com']

export function isRepCardTester(email: string | null | undefined): boolean {
  if (!email) return false
  return REP_CARD_TESTERS.includes(email.trim().toLowerCase())
}

/**
 * Pure: may THIS agent's mail carry the card right now?
 *
 * Live → everyone. Dark → the testers only. Kept pure so the email path and
 * the banner that tells the team what is going on cannot disagree.
 */
export function repCardVisibleFor(agentEmail: string | null | undefined, enabled: boolean): boolean {
  return enabled || isRepCardTester(agentEmail)
}

/**
 * Pure: may THIS person press Send on a thank-you right now?
 *
 * Keyed on the SENDER, not the order's agent — the question is who may put
 * the still-unapproved copy in front of a client, and that is Wes until he
 * says otherwise. Previewing is not gated.
 */
export function maySendThankYou(senderEmail: string | null | undefined, enabled: boolean): boolean {
  return enabled || isRepCardTester(senderEmail)
}

/** What a blocked sender is told, in the route and on the page alike. */
export const THANK_YOU_HELD_MESSAGE =
  'Thank-you emails are being tested — Wes is reviewing the wording and the ' +
  'photo before the team starts sending them. Preview all you like; sending ' +
  'opens up once he turns it on.'

/**
 * The stored switch. Fails soft to OFF — a missing column (the additive SQL
 * has not run) or an unreachable settings row must leave client email exactly
 * as it was, never light this up by accident.
 */
export async function repCardEnabled(): Promise<boolean> {
  try {
    const s = await prisma.siteSetting.findFirst({ select: { repCardEnabled: true } })
    return !!s?.repCardEnabled
  } catch {
    return false
  }
}

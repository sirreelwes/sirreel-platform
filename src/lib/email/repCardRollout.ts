/**
 * Who the rep card is live for.
 *
 * Wes 2026-09-16: "I want to test the system personally before we make it
 * live for the team." So the card is DARK by default and, until it is turned
 * on, renders only when the agent on the job is a tester — Wes. He sends
 * himself a real welcome email from one of his own jobs and reads it in a
 * real inbox, which is the only way to know a 72px photo actually arrives.
 * Nothing about Jose's or Oliver's mail changes in the meantime.
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

/** Who may send a rep card while the rollout is still off. */
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

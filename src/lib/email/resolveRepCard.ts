/**
 * The DB half of the rep card — reading the two photo stores and turning a
 * job's agent into a `RepCard`.
 *
 * Separate from `repCard.ts` so the pure ladder and the HTML stay importable
 * without prisma, and shared by the two callers that MUST agree:
 *   - the email composer, which decides whether a card is drawn, and
 *   - `/api/public/agent-photo/[id]`, which serves the bytes to the inbox.
 *
 * Fails soft on `TeamMember.user_id` not existing yet (see
 * scripts/add-team-member-user-column.ts): the headshot rung is skipped and
 * the weekly candid still carries the card, rather than the send 500ing on a
 * column the live DB has not been given.
 */

import { prisma } from '@/lib/prisma'
import {
  pickRepPhoto,
  agentPhotoEmailUrl,
  type RepCard,
  type RepPhotoSources,
  type RepPhotoChoice,
} from '@/lib/email/repCard'

/** The agent fields every caller already has on hand. */
export interface RepAgent {
  id: string
  name: string
  phone?: string | null
  email?: string | null
  displayTitle?: string | null
}

export async function loadRepPhotoSources(userId: string): Promise<RepPhotoSources> {
  const candid = await prisma.agentWeeklyCandid
    .findFirst({
      where: { userId },
      orderBy: { capturedAt: 'desc' },
      select: { id: true, capturedAt: true },
    })
    .catch(() => null)

  // The Who-we-are link is a newer column; a checkout that has not run the
  // additive-SQL script still sends mail, just without this rung.
  const headshot = await prisma.teamMember
    .findFirst({
      where: { userId, published: true, photoUrl: { not: null } },
      select: { id: true },
    })
    .catch((err) => {
      console.warn(
        '[rep-card] team member lookup skipped (run scripts/add-team-member-user-column.ts):',
        err instanceof Error ? err.message : err,
      )
      return null
    })

  return { candid, headshot }
}

/** The title line: the curated one if there is a roster row, else the User's. */
async function repTitle(agent: RepAgent): Promise<string | null> {
  const member = await prisma.teamMember
    .findFirst({ where: { userId: agent.id, published: true }, select: { title: true } })
    .catch(() => null)
  return member?.title?.trim() || agent.displayTitle?.trim() || null
}

/**
 * The card for a job's agent, or null when there is no photo to show —
 * which is the signal NOT to render the card at all.
 */
export async function resolveRepCard(
  agent: RepAgent | null | undefined,
  now: Date = new Date(),
): Promise<RepCard | null> {
  if (!agent?.id || !agent.name?.trim()) return null

  const sources = await loadRepPhotoSources(agent.id)
  const pick: RepPhotoChoice = pickRepPhoto(sources, now)
  if (!pick) return null

  return {
    name: agent.name.trim(),
    title: await repTitle(agent),
    phone: agent.phone?.trim() || null,
    email: agent.email?.trim() || null,
    photoUrl: agentPhotoEmailUrl(agent.id, pick.id),
  }
}

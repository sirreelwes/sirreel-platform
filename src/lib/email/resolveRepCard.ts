/**
 * The DB half of the rep card — reading the two photo stores and turning a
 * job's agent into a `RepCard`.
 *
 * Separate from `repCard.ts` so the pure ladder and the HTML stay importable
 * without prisma, and shared by the two callers that MUST agree:
 *   - the email composer, which decides whether a card is drawn, and
 *   - `/api/public/agent-photo/[id]`, which serves the bytes to the inbox.
 *
 * Also the ROLLOUT gate: while the card is still dark (Wes testing before
 * the team gets it), only a tester's own jobs carry one — see
 * repCardRollout.ts. The gate is checked BEFORE any photo lookup, so a dark
 * rollout costs the send nothing.
 *
 * Fails soft on `TeamMember.user_id` not existing yet (see
 * scripts/add-team-member-user-column.ts): no link means no photo means no
 * card, rather than the send 500ing on a column the live DB has not been
 * given. That is also the whole setup step — until a roster row is linked to
 * an HQ login on /admin/who-we-are, that person's mail is unchanged.
 */

import { prisma } from '@/lib/prisma'
import { repCardEnabled, repCardVisibleFor } from '@/lib/email/repCardRollout'
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
  // The Who-we-are link is a newer column; a checkout that has not run the
  // additive-SQL script still sends mail, just without the card.
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

  return { headshot }
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
export async function resolveRepCard(agent: RepAgent | null | undefined): Promise<RepCard | null> {
  if (!agent?.id || !agent.name?.trim()) return null

  // Is the card live for this agent at all? Checked first: while the rollout
  // is dark this is one settings read and then nothing, and every other
  // agent's mail is untouched.
  if (!repCardVisibleFor(agent.email, await repCardEnabled())) return null

  const pick: RepPhotoChoice = pickRepPhoto(await loadRepPhotoSources(agent.id))
  if (!pick) return null

  return {
    name: agent.name.trim(),
    title: await repTitle(agent),
    phone: agent.phone?.trim() || null,
    email: agent.email?.trim() || null,
    photoUrl: agentPhotoEmailUrl(agent.id, pick.id),
  }
}

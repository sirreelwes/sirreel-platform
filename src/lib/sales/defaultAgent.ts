/**
 * Who a self-serve job gets assigned to when no agent was involved.
 *
 * The client SEES this person: the job portal renders them as "Your SirReel
 * rep", with their name, phone and email. So it is a client-facing routing
 * decision, not an internal default.
 *
 * It used to be "first active ADMIN, oldest account first". That is not a
 * business rule — it silently routed every self-serve job to whoever happened
 * to hold the oldest admin account, and because the filter required role
 * ADMIN it could never pick a salesperson at all, which is who these
 * actually belong to.
 *
 * Now: an explicit setting, falling back to a salesperson, and only then to
 * an admin. The fallbacks exist so a fresh database still assigns SOMEBODY —
 * a job with no rep would show a client an empty contact card.
 */

import { prisma } from '@/lib/prisma'

export interface ResolvedDefaultAgent {
  id: string
  /** How we arrived at this person — logged when it is not the configured
   *  choice, because a silent fallback is what hid the original problem. */
  via: 'configured' | 'first-agent' | 'first-admin'
}

export async function resolveDefaultSalesAgent(): Promise<ResolvedDefaultAgent> {
  const setting = await prisma.siteSetting.findUnique({
    where: { id: 'singleton' },
    select: { defaultSalesAgentId: true },
  })

  // Re-checked against the user table rather than trusted: a configured rep
  // who has since been deactivated must not keep receiving jobs, and the
  // client must not be shown a rep who no longer works here.
  if (setting?.defaultSalesAgentId) {
    const configured = await prisma.user.findFirst({
      where: { id: setting.defaultSalesAgentId, isActive: true },
      select: { id: true },
    })
    if (configured) return { id: configured.id, via: 'configured' }
    console.error(
      '[default-agent] configured rep %s is missing or inactive — falling back',
      setting.defaultSalesAgentId,
    )
  }

  const agent = await prisma.user.findFirst({
    where: { role: 'AGENT', isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  })
  if (agent) return { id: agent.id, via: 'first-agent' }

  const admin = await prisma.user.findFirst({
    where: { role: 'ADMIN', isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  })
  if (admin) return { id: admin.id, via: 'first-admin' }

  throw new Error('no active AGENT or ADMIN user for self-serve assignment')
}

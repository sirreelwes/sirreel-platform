import { prisma } from '@/lib/prisma'

/**
 * Public "Who we are" team roster. Returns members ONLY when the section is
 * enabled (SiteSetting.whoWeAreEnabled) — otherwise the section is hidden.
 * Only published members with a photo are shown (a headshot grid needs one).
 * Managed at /admin/who-we-are.
 */
export interface PublicTeamMember {
  id: string
  name: string
  title: string
}

export async function getTeamSection(): Promise<{ enabled: boolean; members: PublicTeamMember[] }> {
  const settings = await prisma.siteSetting.findFirst({ select: { whoWeAreEnabled: true } })
  const enabled = Boolean(settings?.whoWeAreEnabled)
  if (!enabled) return { enabled: false, members: [] }

  const members = await prisma.teamMember.findMany({
    where: { published: true, photoUrl: { not: null } },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, name: true, title: true },
  })
  return { enabled: true, members }
}

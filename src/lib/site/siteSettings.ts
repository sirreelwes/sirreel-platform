import { prisma } from '@/lib/prisma'
import { PAGE_TITLE_DEFAULTS, type PageTitles } from './pageTitleDefaults'

/**
 * Editable public-page hero titles, each falling back to its built-in default
 * (pageTitleDefaults.ts) when the admin hasn't set one. Reads the SiteSetting
 * singleton. Server-only (prisma-backed) — the public marketing pages call
 * this to render their H1.
 */
export async function getPageTitles(): Promise<PageTitles> {
  const s = await prisma.siteSetting.findUnique({
    where: { id: 'singleton' },
    select: { titleStandingSets: true, titleVehicles: true, titleContact: true },
  })
  return {
    standingSets: s?.titleStandingSets?.trim() || PAGE_TITLE_DEFAULTS.standingSets,
    vehicles: s?.titleVehicles?.trim() || PAGE_TITLE_DEFAULTS.vehicles,
    contact: s?.titleContact?.trim() || PAGE_TITLE_DEFAULTS.contact,
  }
}

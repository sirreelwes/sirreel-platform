/**
 * Built-in fallback copy for the editable public-page hero titles. Used when
 * the admin hasn't set a custom title (the SiteSetting column is null), and as
 * placeholders in the /admin/site-settings editor.
 *
 * Prisma-free on purpose so it is safe to import from the client-side admin
 * page (importing the prisma-backed reader would pull the Prisma client into
 * the browser bundle).
 */
export const PAGE_TITLE_DEFAULTS = {
  standingSets: 'Turnkey standing sets',
  vehicles: 'Production vehicles, ready to roll',
  contact: 'Let’s get your production rolling.',
} as const

export type PageTitleKey = keyof typeof PAGE_TITLE_DEFAULTS

export interface PageTitles {
  standingSets: string
  vehicles: string
  contact: string
}

import type { MetadataRoute } from 'next'
import { getPublicVehicles } from '@/lib/site/vehicleCatalog'
import { getPublicSpaces } from '@/lib/site/spaces'
import { STAGES } from '@/lib/site/stages'
import { publicUrl } from '@/lib/site/publicUrl'

/**
 * Sitemap for the public marketing site.
 *
 * Built from the same sources the pages render from, so a vehicle that is
 * unpublished (or published but photo-less, which the catalog hides) never
 * appears here — submitting URLs that render nothing is worse than
 * omitting them.
 *
 * Detail pages are included only where they actually resolve: STAGES
 * entries that carry an `href` are external pointers rather than pages of
 * their own, and /stages/[slug] notFound()s on them.
 *
 * Dynamic because the vehicle and space lists come from the database —
 * a static build would freeze the sitemap at deploy time.
 */
export const dynamic = 'force-dynamic'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date()

  const staticEntries: MetadataRoute.Sitemap = [
    { url: publicUrl('/'), lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: publicUrl('/vehicles'), lastModified: now, changeFrequency: 'weekly', priority: 0.9 },
    { url: publicUrl('/stages'), lastModified: now, changeFrequency: 'weekly', priority: 0.9 },
    { url: publicUrl('/standing-sets'), lastModified: now, changeFrequency: 'weekly', priority: 0.9 },
    { url: publicUrl('/contact'), lastModified: now, changeFrequency: 'monthly', priority: 0.7 },
    { url: publicUrl('/help'), lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: publicUrl('/rental-agreement'), lastModified: now, changeFrequency: 'yearly', priority: 0.4 },
    { url: publicUrl('/stage-contract'), lastModified: now, changeFrequency: 'yearly', priority: 0.4 },
    { url: publicUrl('/payment-info'), lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
  ]

  // Detail pages. Any of these can fail if the DB is unreachable at crawl
  // time; degrade to the static list rather than 500 the sitemap.
  let detailEntries: MetadataRoute.Sitemap = []
  try {
    const [vehicles, standingSets] = await Promise.all([
      getPublicVehicles(),
      getPublicSpaces('STANDING_SET'),
    ])

    detailEntries = [
      ...vehicles.map((v) => ({
        url: publicUrl(`/vehicles/${v.slug}`),
        lastModified: now,
        changeFrequency: 'monthly' as const,
        priority: 0.8,
      })),
      ...standingSets.map((s) => ({
        url: publicUrl(`/standing-sets/${s.id}`),
        lastModified: now,
        changeFrequency: 'monthly' as const,
        priority: 0.8,
      })),
      // `href` entries point somewhere else and have no detail page.
      ...STAGES.filter((s) => !s.href).map((s) => ({
        url: publicUrl(`/stages/${s.slug}`),
        lastModified: now,
        changeFrequency: 'monthly' as const,
        priority: 0.8,
      })),
    ]
  } catch (err) {
    console.error('[sitemap] detail pages unavailable, serving static entries only:', err)
  }

  return [...staticEntries, ...detailEntries]
}

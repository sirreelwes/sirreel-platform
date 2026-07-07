/**
 * Public site Home — diagonal service-nav (2026-07-06).
 *
 * The page IS the five diagonal service bands (see ServiceTiles). No
 * fleet grid or contact band here anymore — those live on their own
 * routes (/vehicles, /contact) and the header nav. The (public) shell
 * header renders on top from the group layout.
 *
 * Tile photos come from SiteSetting (admin-uploaded at /admin/home-tiles)
 * and are served through the public proxy /api/public/site-media/tile-*
 * — never a raw private blob URL. An unset tile falls back to its solid
 * color. The settings fetch is guarded so a schema/deploy mismatch can
 * never take the page down (it degrades to all-solid-color tiles).
 */

import { prisma } from '@/lib/prisma'
import { HOME_TILES } from '@/lib/site/homeTiles'
import { ServiceTiles } from '@/components/site/ServiceTiles'
import { hasPublishedSpaces } from '@/lib/site/spaces'

export const dynamic = 'force-dynamic'

export default async function PublicHomePage() {
  const settings = await prisma.siteSetting
    .findUnique({
      where: { id: 'singleton' },
      select: {
        tileTruckingUrl: true, tileStagesUrl: true, tileStandingSetsUrl: true,
        tileLedWallUrl: true, tileSuppliesUrl: true,
        tileRadiosWifiUrl: true, tileGripElectricUrl: true, tileWardrobeMakeupUrl: true,
      },
    })
    .catch((err) => {
      console.error('[home] tile settings fetch failed — falling back to solid tiles:', err)
      return null
    })

  const setBySlot: Record<string, boolean> = {
    trucking: !!settings?.tileTruckingUrl,
    stages: !!settings?.tileStagesUrl,
    'standing-sets': !!settings?.tileStandingSetsUrl,
    'led-wall': !!settings?.tileLedWallUrl,
    supplies: !!settings?.tileSuppliesUrl,
    'radios-wifi': !!settings?.tileRadiosWifiUrl,
    'grip-electric': !!settings?.tileGripElectricUrl,
    'wardrobe-makeup': !!settings?.tileWardrobeMakeupUrl,
  }

  // Publish gate: the Standing Sets tile stays "coming soon" until at least
  // one standing set is PUBLISHED with a photo. The moment Wes publishes
  // one, this flips the tile to a live link (tap → gallery, swipe → the
  // on-page Check Availability form) — no code change needed.
  const standingSetsLive = await hasPublishedSpaces('STANDING_SET').catch(() => false)

  const tiles = HOME_TILES.map((t) => {
    const base = {
      ...t,
      image: setBySlot[t.slot] ? `/api/public/site-media/tile-${t.slot}` : null,
    }
    if (t.slot === 'standing-sets' && standingSetsLive) {
      return {
        ...base,
        mode: 'link' as const,
        href: '/standing-sets',
        swipe: { label: 'Check Availability', href: '/standing-sets#availability' },
      }
    }
    return base
  })

  return <ServiceTiles tiles={tiles} />
}

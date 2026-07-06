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

export const dynamic = 'force-dynamic'

export default async function PublicHomePage() {
  const settings = await prisma.siteSetting
    .findUnique({
      where: { id: 'singleton' },
      select: {
        tileTruckingUrl: true, tileStagesUrl: true, tileStandingSetsUrl: true,
        tileLedWallUrl: true, tileSuppliesUrl: true,
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
  }

  const tiles = HOME_TILES.map((t) => ({
    ...t,
    image: setBySlot[t.slot] ? `/api/public/site-media/tile-${t.slot}` : null,
  }))

  return <ServiceTiles tiles={tiles} />
}

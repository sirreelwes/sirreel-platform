import type { MetadataRoute } from 'next';

/**
 * PWA manifest — makes HQ installable to a phone home screen so the
 * team opens it as an app rather than hunting a browser tab.
 *
 * NO service worker is registered, deliberately: an offline cache in an
 * ops tool serves yesterday's holds, yesterday's paperwork status, and
 * yesterday's balances, and a stale answer here is worse than no
 * answer. `display: standalone` still gets the app frame; every request
 * still hits the network.
 *
 * start_url is `/` — the role router. Sales land on /jobs, yard roles on
 * /yard, billing on /collections, everyone else on /dashboard, so
 * one installed icon is correct for every role on the roster.
 *
 * Icons are the existing brand assets already shipped in public/.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'SirReel HQ',
    short_name: 'SirReel HQ',
    description: 'SirReel HQ — internal operations platform',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    // The dark nav chrome, so the status bar and splash match the shell
    // instead of flashing white on launch.
    background_color: '#1a1a1a',
    theme_color: '#1a1a1a',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  };
}

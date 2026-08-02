import type { MetadataRoute } from 'next'
import { headers } from 'next/headers'
import { PUBLIC_SITE_HOSTS, PUBLIC_SITE_ORIGIN } from '@/lib/site/publicUrl'

/**
 * robots.txt, per host.
 *
 * One Vercel project serves three hostnames, and only one of them should
 * ever be crawled:
 *
 *   sirreel.com      — the marketing site. Crawl the marketing paths.
 *   hq.sirreel.com   — staff dashboard. Disallow everything.
 *   tsx.sirreel.com  — client portal, reached by tokenised links that must
 *                      never be indexed. Disallow everything.
 *
 * A single static robots.txt would have to pick one of those answers and
 * be wrong for the other two, so this reads the Host header. That makes
 * the route dynamic, which is correct here — it is a tiny text response.
 *
 * Note the portal paths stay disallowed even on the marketing host:
 * middleware 308s them to tsx, and a tokenised URL is a credential.
 */
export const dynamic = 'force-dynamic'

export default async function robots(): Promise<MetadataRoute.Robots> {
  const host = (await headers()).get('host')?.split(':')[0]?.toLowerCase() ?? ''
  const isPublicSite = PUBLIC_SITE_HOSTS.includes(host)

  if (!isPublicSite) {
    // Staff dashboard / client portal — nothing here is for search engines.
    return { rules: [{ userAgent: '*', disallow: '/' }] }
  }

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/portal/',
          '/client/',
          '/coi/',
          '/intake/',
          '/login',
          '/client-login',
          '/dashboard',
          // The supply-order form is a working tool for existing clients,
          // not a landing page — it lives on orders.sirreel.com.
          '/order/',
        ],
      },
    ],
    sitemap: `${PUBLIC_SITE_ORIGIN}/sitemap.xml`,
    host: PUBLIC_SITE_ORIGIN,
  }
}

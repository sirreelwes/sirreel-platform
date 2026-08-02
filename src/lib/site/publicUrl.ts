/**
 * Canonical origin for the public marketing site.
 *
 * One constant so metadataBase, the sitemap and robots.txt can never
 * disagree about what the canonical host is — a mismatch there is how
 * duplicate-content and wrong-canonical problems start.
 *
 * sirreel.com is the marketing host; hq. and tsx. are the staff dashboard
 * and client portal respectively and must never be indexed (see robots.ts).
 */
export const PUBLIC_SITE_ORIGIN = 'https://sirreel.com'

/** Hosts that serve the public marketing site. Mirrors middleware.ts. */
export const PUBLIC_SITE_HOSTS = ['sirreel.com', 'www.sirreel.com']

/** Absolute URL on the marketing site, for canonicals and the sitemap. */
export function publicUrl(path: string): string {
  return `${PUBLIC_SITE_ORIGIN}${path.startsWith('/') ? path : `/${path}`}`
}

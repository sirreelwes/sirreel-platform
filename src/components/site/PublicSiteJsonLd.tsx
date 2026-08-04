import { PUBLIC_CONTACT, PUBLIC_SOCIAL } from '@/lib/site/publicNav'
import { PUBLIC_SITE_ORIGIN } from '@/lib/site/publicUrl'

/**
 * Organization / LocalBusiness structured data for the marketing home page.
 *
 * SirReel is a physical rental business serving one metro, so the things
 * search engines want are the address, the phone number and the service
 * area — that is what drives the knowledge panel and local results. All
 * values come from the SAME constants the page renders, so the markup
 * can't drift from what a visitor actually sees (which is the one thing
 * that gets structured data flagged as spam).
 *
 * Rendered once, on Home only — repeating it per page adds nothing.
 */
export function PublicSiteJsonLd() {
  const [street, cityStateZip] = PUBLIC_CONTACT.address.split(', ').reduce<[string, string]>(
    (acc, part, i, arr) => (i === 0 ? [part, arr.slice(1).join(', ')] : acc),
    ['', ''],
  )
  const [city, stateZip = ''] = cityStateZip.split(', ')
  const [region, postal] = stateZip.split(' ')

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    '@id': `${PUBLIC_SITE_ORIGIN}/#business`,
    name: 'SirReel Production Vehicles',
    description:
      'Production vehicle, sound stage and standing-set rentals for film and television production in Los Angeles.',
    url: PUBLIC_SITE_ORIGIN,
    telephone: PUBLIC_CONTACT.phoneHref.replace('tel:', ''),
    email: PUBLIC_CONTACT.email,
    address: {
      '@type': 'PostalAddress',
      streetAddress: street,
      addressLocality: city,
      addressRegion: region,
      postalCode: postal,
      addressCountry: 'US',
    },
    areaServed: { '@type': 'City', name: 'Los Angeles' },
    // sameAs links the official profiles to this business entity, which
    // is how search engines associate them rather than guessing.
    sameAs: [PUBLIC_SOCIAL.instagram, PUBLIC_SOCIAL.tiktok].filter((u) => u && u !== '#'),
    logo: `${PUBLIC_SITE_ORIGIN}/sirreel-logo.png`,
    image: `${PUBLIC_SITE_ORIGIN}/full-logo.jpg`,
  }

  return (
    <script
      type="application/ld+json"
      // Values are our own constants, not user input.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  )
}

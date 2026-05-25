import type { Metadata } from 'next'
import { Archivo, Hanken_Grotesk } from 'next/font/google'
import { SupplyOrderApp } from '@/components/supplies/SupplyOrderApp'

/**
 * Public supply-ordering surface. No auth — anyone can browse the
 * catalog and submit a request. Submission lands as an
 * Inquiry(WEB_FORM) via the hardened /api/public/supply-request
 * endpoint (rate-limited, honeypot-guarded, captcha-gated).
 *
 * The Sign-in header link routes to /portal/auth/sign-in (the
 * Phase 1 magic-link page); when the portal mount of SupplyOrderApp
 * lands, that mount will set signInHref={null} since the user is
 * already inside the portal.
 */

const archivo = Archivo({
  subsets: ['latin'],
  weight: ['500', '600', '700', '800', '900'],
  variable: '--font-archivo',
  display: 'swap',
})
const hanken = Hanken_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-hanken',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'SirReel · Production Supplies',
  description: 'Build a supply order — basecamp, grip, power, safety, expendables.',
}

export default function PublicSupplyOrderPage() {
  return (
    <div className={`${archivo.variable} ${hanken.variable}`}>
      <SupplyOrderApp
        submitEndpoint="/api/public/supply-request"
        signInHref="/portal/auth/sign-in"
      />
    </div>
  )
}

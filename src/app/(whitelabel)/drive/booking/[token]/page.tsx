/**
 * /drive/booking/[token] — a partner's DRIVER's page for one of the
 * partner's own Utliiz bookings. Phone-first; the token is the login.
 * Wears the partner's brand and accent, never SirReel's.
 */
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { loadDriverBooking } from '@/lib/hq-white-label/driverFlow'
import { DriverBookingView } from '@/components/hq-white-label/DriverBookingView'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: { token: string } }): Promise<Metadata> {
  const v = await loadDriverBooking(params.token)
  return {
    title: v ? `${v.unitName} · ${v.brandName}` : 'Your job',
    robots: { index: false, follow: false },
    viewport: 'width=device-width, initial-scale=1, viewport-fit=cover',
  icons: {
    icon: [{ url: '/utliiz-icon.svg', type: 'image/svg+xml' }, { url: '/utliiz-icon-192.png', type: 'image/png', sizes: '192x192' }, { url: '/utliiz-icon-512.png', type: 'image/png', sizes: '512x512' }],
    apple: '/utliiz-apple-touch-icon.png',
  },
  }
}

export default async function DriverBookingPage({ params }: { params: { token: string } }) {
  const v = await loadDriverBooking(params.token)
  if (!v) notFound()
  return <DriverBookingView token={params.token} initial={v} />
}

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getVendorViewByToken } from '@/lib/sub-rentals/potentialSubRental'
import VehicleGallery from '@/components/site/VehicleGallery'
import VendorDriverCard from '@/components/site/VendorDriverCard'

/**
 * VENDOR page — /vendor/[token]. The partner's own view of a sub-rental of
 * their unit: which coach, which dates, where it stands.
 *
 * It names no client. The production, the company and the contacts are not
 * loaded by getVendorViewByToken at all — the vendor's shared reference is
 * our job code. That is the conduit working as intended: neither side of a
 * sub-rental deals with the other directly, and anything added to this page
 * later (location, call time, driver details) has to keep clearing that bar.
 *
 * Unlisted and noindex for the same reasons as /unit/[token].
 */
export const dynamic = 'force-dynamic'

const STATUS_COPY: Record<string, { label: string; blurb: string; tone: string }> = {
  ESTIMATED: {
    label: 'Estimate submitted',
    blurb:
      'We have quoted this unit to a production for the dates below. Nothing is booked yet — this is advance notice so the dates are on your radar. We will confirm here as soon as we hear back.',
    tone: '#a37f2c',
  },
  REQUESTED: {
    label: 'Hold requested',
    blurb:
      'The production has accepted — please hold this unit for the dates below and reply to the email that brought you here to confirm. We will follow up with the PO. Name your driver below whenever you are ready; call time and location appear here once the production confirms them.',
    tone: '#a37f2c',
  },
  CONFIRMED: { label: 'Confirmed', blurb: 'This booking is confirmed.', tone: '#2f7d5d' },
  PICKED_UP: { label: 'Picked up', blurb: 'The unit is with us.', tone: '#2f7d5d' },
  ON_RENT: { label: 'On rent', blurb: 'The unit is out on the job.', tone: '#2f7d5d' },
  RETURNED: { label: 'Returned', blurb: 'The unit is back with you. Thank you.', tone: '#5a554c' },
  CANCELLED: { label: 'Cancelled', blurb: 'This booking is no longer going ahead.', tone: '#8b857a' },
}

function fmtDate(d: Date | null): string {
  if (!d) return '—'
  return d.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  })
}

export async function generateMetadata(): Promise<Metadata> {
  return { title: 'SirReel — Sub-rental', robots: { index: false, follow: false } }
}

export default async function VendorPage({ params }: { params: { token: string } }) {
  const v = await getVendorViewByToken(params.token)
  if (!v) notFound()

  const status = STATUS_COPY[v.status] ?? {
    label: v.status,
    blurb: '',
    tone: '#5a554c',
  }
  const photos = v.photos.map((p) => ({
    id: p.id,
    src: `/api/public/vendor/${params.token}/photo/${p.id}`,
  }))

  return (
    <div className="max-w-[1100px] mx-auto px-5 py-8 sm:py-12">
      <div
        className="text-[12px] font-semibold tracking-[0.16em] uppercase mb-2"
        style={{ fontFamily: 'Archivo, sans-serif', color: status.tone }}
      >
        {status.label}
      </div>
      <h1
        className="font-black tracking-tight leading-[0.98] text-[32px] sm:text-[42px]"
        style={{ fontFamily: 'Archivo, sans-serif' }}
      >
        {v.vehicleName}
      </h1>
      {v.reference && (
        <p className="mt-1.5 text-[14px] text-[#8b857a]">
          SirReel reference <span className="font-semibold text-[#3a362f]">{v.reference}</span>
        </p>
      )}
      {status.blurb && (
        <p className="mt-4 text-[16px] text-[#3a362f] leading-relaxed max-w-[60ch]">{status.blurb}</p>
      )}

      <div className="mt-7 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start">
        <div>
          <div
            className="text-[12px] font-semibold tracking-[0.16em] uppercase text-[#8b857a] mb-3"
            style={{ fontFamily: 'Archivo, sans-serif' }}
          >
            Dates quoted
          </div>
          <dl className="rounded-[14px] border border-[#e4dfd4] bg-white overflow-hidden">
            <div className="flex items-center justify-between gap-4 px-4 py-3">
              <dt className="text-[13px] font-semibold uppercase tracking-[0.06em] text-[#8b857a]">Start</dt>
              <dd className="text-[15px] font-semibold text-[#0c0c0d]">{fmtDate(v.startDate)}</dd>
            </div>
            <div className="flex items-center justify-between gap-4 px-4 py-3 border-t border-[#efe9dd]">
              <dt className="text-[13px] font-semibold uppercase tracking-[0.06em] text-[#8b857a]">End</dt>
              <dd className="text-[15px] font-semibold text-[#0c0c0d]">{fmtDate(v.endDate)}</dd>
            </div>
            <div className="flex items-center justify-between gap-4 px-4 py-3 border-t border-[#efe9dd]">
              <dt className="text-[13px] font-semibold uppercase tracking-[0.06em] text-[#8b857a]">Units</dt>
              <dd className="text-[15px] font-semibold text-[#0c0c0d]">{v.quantity}</dd>
            </div>
          </dl>

          <VendorDriverCard
            token={params.token}
            initialDriverName={v.driverName}
            initialDriverEmail={v.driverEmail}
            initialDriverPhone={v.driverPhone}
            initialRelayAddress={v.relayAddress}
          />

          <div className="mt-6 rounded-[14px] border border-[#e4dfd4] bg-[#faf7f0] px-4 py-3.5">
            <p className="text-[13px] text-[#5a554c] leading-relaxed">
              Location and call time will appear here as the production confirms them.
              Questions about this booking go to SirReel — please reply to the email that
              brought you here rather than contacting the production directly.
            </p>
          </div>
        </div>

        <div>
          {photos.length > 0 && <VehicleGallery photos={photos} fallbackSrc={null} alt={v.vehicleName} />}
          {v.specs.length > 0 && (
            <div className="mt-5">
              <div
                className="text-[12px] font-semibold tracking-[0.16em] uppercase text-[#8b857a] mb-3"
                style={{ fontFamily: 'Archivo, sans-serif' }}
              >
                Unit on file
              </div>
              <ul className="rounded-[14px] border border-[#e4dfd4] bg-white px-5 py-4 space-y-2">
                {v.specs.map((sp) => (
                  <li key={sp} className="flex items-start gap-2.5 text-[14px] text-[#3a362f] leading-relaxed">
                    <span aria-hidden className="mt-[8px] w-1.5 h-1.5 rounded-full bg-[#c39a3f] shrink-0" />
                    {sp}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

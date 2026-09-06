import Link from 'next/link'
import Image from 'next/image'
import type { Metadata } from 'next'
import { getPublicVehicles, PARTNER_SECTION, type PublicVehicle } from '@/lib/site/vehicleCatalog'
import { getPageTitles } from '@/lib/site/siteSettings'
import { SWatermark } from '@/components/site/SWatermark'

/**
 * Public /vehicles landing — the "Vehicles" nav destination. Lists every
 * client-visible VehicleCategory (published + has a photo) as a card linking
 * to its detail page. Reads LIVE from the same rows the order form shows;
 * tiles use the primary gallery photo (legacy image fallback) via the proxy.
 *
 * Two sections: the owned fleet, then "Motorhomes & Location Trailers" —
 * partner-supplied units, every partner side by side, no vendor named. The
 * partner section exists only while at least one partner has signed and has
 * a listed unit (SUB_LISTED_WHERE), so it appears on its own the moment a
 * partner approves in their portal (Wes 2026-09-06).
 */
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'SirReel · Production Vehicles',
  description:
    'Cargo vans, supercubes, passenger vans, talent trailers and more — the SirReel production fleet.',
  alternates: { canonical: '/vehicles' },
}

function fmtMoney(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function TruckPlaceholder() {
  // Photo-less card → a quiet S-mark instead of a generic truck glyph.
  return (
    <div className="w-full h-[160px] bg-gradient-to-br from-[#1a1a1c] to-[#0c0c0d] flex items-center justify-center">
      <Image src="/s-logo-white.png" alt="" aria-hidden width={1118} height={1065} className="h-12 w-auto opacity-20" />
    </div>
  )
}

function VehicleCard({ v }: { v: PublicVehicle }) {
  const priceOnQuote = v.dailyRate == null || v.dailyRate === 0
  return (
    <Link
      href={`/vehicles/${v.slug}`}
      className="group bg-white rounded-[16px] overflow-hidden border border-[#e4dfd4] shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all flex flex-col"
    >
      {v.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={v.photoUrl}
          alt={v.name}
          className="w-full h-[160px] object-cover bg-[#f0eadb]"
          loading="lazy"
        />
      ) : (
        <TruckPlaceholder />
      )}
      <div className="p-4 flex flex-col gap-1.5 flex-1">
        <div className="font-extrabold text-[17px] leading-tight tracking-tight" style={{ fontFamily: 'Archivo, sans-serif' }}>
          {v.name}
        </div>
        {(v.tagline || v.subtitle) && (
          <div className="text-[13px] text-[#8b857a] leading-snug">
            {v.tagline || v.subtitle}
          </div>
        )}
        <div className="mt-auto pt-2 flex items-center justify-between">
          <div className="font-semibold text-[13px] text-[#8b857a]" style={{ fontFamily: 'Archivo, sans-serif' }}>
            {priceOnQuote ? (
              <span className="text-[#a37f2c] font-extrabold">PRICE ON QUOTE</span>
            ) : (
              <>
                <b className="text-[#0c0c0d] font-extrabold text-[15px]">{fmtMoney(v.dailyRate!)}</b> /day
              </>
            )}
          </div>
          <span className="text-[13px] font-bold text-[#c39a3f] group-hover:translate-x-0.5 transition-transform" style={{ fontFamily: 'Archivo, sans-serif' }}>
            View →
          </span>
        </div>
      </div>
    </Link>
  )
}

function Grid({ items }: { items: PublicVehicle[] }) {
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {items.map((v) => <VehicleCard key={v.id} v={v} />)}
    </div>
  )
}

export default async function VehiclesIndexPage() {
  const [vehicles, titles] = await Promise.all([getPublicVehicles(), getPageTitles()])
  const fleet = vehicles.filter((v) => !v.partner)
  const partners = vehicles.filter((v) => v.partner)

  return (
    <>
      {/* Hero band — matches the order form's dark editorial band. */}
      <section className="bg-[#0c0c0d] text-white relative overflow-hidden">
        <SWatermark />
        <div className="relative max-w-[1480px] mx-auto px-5 py-12 sm:py-16">
          <div className="text-[12px] font-semibold tracking-[0.22em] uppercase text-[#c39a3f] mb-3.5" style={{ fontFamily: 'Archivo, sans-serif' }}>
            The Fleet
          </div>
          <h1 className="font-black tracking-tight leading-[0.95] text-[40px] sm:text-[56px] md:text-[64px] max-w-[16ch]" style={{ fontFamily: 'Archivo, sans-serif' }}>
            {titles.vehicles}
          </h1>
          <p className="mt-4 max-w-[56ch] text-[#cfc9bd] text-base leading-relaxed">
            Cargo vans, supercubes, passenger vans, talent trailers and honeywagons{partners.length > 0 ? ', plus motorhomes and location trailers' : ''}. Pick a vehicle
            to see specs and pricing — then add it to your reservation.
          </p>
        </div>
      </section>

      {/* Grid(s) */}
      <section className="max-w-[1480px] mx-auto px-5 py-10 sm:py-14" data-catalog="sections">
        {vehicles.length === 0 ? (
          <p className="text-[#8b857a]">No vehicles are listed right now. Please check back soon.</p>
        ) : (
          <>
            {fleet.length > 0 && <Grid items={fleet} />}
            {partners.length > 0 && (
              <div className={fleet.length > 0 ? 'mt-14 pt-10 border-t border-[#e4dfd4]' : ''} data-section="partner-vehicles">
                <div className="text-[12px] font-semibold tracking-[0.22em] uppercase text-[#c39a3f] mb-2" style={{ fontFamily: 'Archivo, sans-serif' }}>
                  Also from SirReel
                </div>
                <h2 className="font-black tracking-tight text-[28px] sm:text-[36px] leading-tight" style={{ fontFamily: 'Archivo, sans-serif' }}>
                  {PARTNER_SECTION.title}
                </h2>
                <p className="mt-2 mb-6 max-w-[60ch] text-[#8b857a] text-[15px] leading-relaxed">{PARTNER_SECTION.blurb}</p>
                <Grid items={partners} />
              </div>
            )}
          </>
        )}
      </section>
    </>
  )
}

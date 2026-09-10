import Link from 'next/link'
import Image from 'next/image'
import type { Metadata } from 'next'
import { getPublicVehicles, groupPartnerUnits, type PublicVehicle } from '@/lib/site/vehicleCatalog'
import { getPageTitles } from '@/lib/site/siteSettings'
import { SWatermark } from '@/components/site/SWatermark'

/**
 * Public /vehicles landing — the "Vehicles" nav destination. Lists every
 * client-visible VehicleCategory (published + has a photo) as a card linking
 * to its detail page. Reads LIVE from the same rows the order form shows;
 * tiles use the primary gallery photo (legacy image fallback) via the proxy.
 *
 * The owned fleet first, then one section per partner CATEGORY — motorhomes
 * & location trailers, power & generators, HVAC, lifts, lighting… — each
 * with every partner's units side by side and no vendor named. A section
 * exists only while at least one partner has signed and has a listed unit
 * in it (SUB_LISTED_WHERE), so it appears on its own the moment a partner
 * approves in their portal (Wes 2026-09-06) and vanishes when the last unit
 * is withdrawn. Sections are anchored (#power, #lifts…) so the nav and
 * emails can point at one.
 */
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'SirReel · Production Vehicles',
  description:
    'Cargo vans, supercubes, passenger vans, talent trailers, motorhomes, generators and more — the SirReel production fleet and partner equipment.',
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
        {/* Named only where the partner gave written permission (agreement
            cl. 10) — our own fleet and un-permissioned partners both render
            nothing, so an absent line tells a client nothing. */}
        {v.suppliedBy && (
          <div className="text-[12px] text-[#8b857a] leading-snug">
            Supplied by <span className="text-[#0C657A] font-semibold">{v.suppliedBy}</span>
          </div>
        )}
        <div className="mt-auto pt-2 flex items-center justify-between">
          <div className="font-semibold text-[13px] text-[#8b857a]" style={{ fontFamily: 'Archivo, sans-serif' }}>
            {priceOnQuote ? (
              <span className="text-[#0C657A] font-extrabold">PRICE ON QUOTE</span>
            ) : (
              <>
                <b className="text-[#0c0c0d] font-extrabold text-[15px]">{fmtMoney(v.dailyRate!)}</b> /day
              </>
            )}
          </div>
          <span className="text-[13px] font-bold text-[#0F7A93] group-hover:translate-x-0.5 transition-transform" style={{ fontFamily: 'Archivo, sans-serif' }}>
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
  const partnerGroups = groupPartnerUnits(vehicles)
  // The hero names what is actually listed, so a power partner going live
  // changes the sentence on its own.
  const alsoList = partnerGroups.map((g) => g.meta.title.toLowerCase())
  const also = alsoList.length === 0 ? '' : alsoList.length === 1 ? `, plus ${alsoList[0]}` : `, plus ${alsoList.slice(0, -1).join(', ')} and ${alsoList[alsoList.length - 1]}`

  return (
    <>
      {/* Hero band — matches the order form's dark editorial band. */}
      <section className="bg-[#0c0c0d] text-white relative overflow-hidden">
        <SWatermark />
        <div className="relative max-w-[1480px] mx-auto px-5 py-12 sm:py-16">
          <div className="text-[12px] font-semibold tracking-[0.22em] uppercase text-[#4DB1C6] mb-3.5" style={{ fontFamily: 'Archivo, sans-serif' }}>
            The Fleet
          </div>
          <h1 className="font-black tracking-tight leading-[0.95] text-[40px] sm:text-[56px] md:text-[64px] max-w-[16ch]" style={{ fontFamily: 'Archivo, sans-serif' }}>
            {titles.vehicles}
          </h1>
          <p className="mt-4 max-w-[56ch] text-[#cfc9bd] text-base leading-relaxed">
            Cargo vans, supercubes, passenger vans, talent trailers and honeywagons{also}. Pick one
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
            {partnerGroups.map((g, i) => (
              <div
                key={g.meta.key}
                id={g.meta.anchor}
                className={fleet.length > 0 || i > 0 ? 'mt-14 pt-10 border-t border-[#e4dfd4] scroll-mt-6' : 'scroll-mt-6'}
                data-section="partner-vehicles"
                data-partner-section={g.meta.key}
              >
                <div className="text-[12px] font-semibold tracking-[0.22em] uppercase text-[#0F7A93] mb-2" style={{ fontFamily: 'Archivo, sans-serif' }}>
                  Also from SirReel
                </div>
                <h2 className="font-black tracking-tight text-[28px] sm:text-[36px] leading-tight" style={{ fontFamily: 'Archivo, sans-serif' }}>
                  {g.meta.title}
                </h2>
                <p className="mt-2 mb-6 max-w-[60ch] text-[#8b857a] text-[15px] leading-relaxed">{g.meta.blurb}</p>
                <Grid items={g.items} />
              </div>
            ))}
          </>
        )}
      </section>
    </>
  )
}

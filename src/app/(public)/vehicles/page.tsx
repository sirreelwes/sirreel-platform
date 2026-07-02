import Link from 'next/link'
import type { Metadata } from 'next'
import { getPublicVehicles } from '@/lib/site/vehicleCatalog'

/**
 * Public /vehicles landing — the "Vehicles" nav destination. Lists every active
 * VehicleCategory as a card linking to its detail page. Reads LIVE from the
 * same rows the order form shows.
 */
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'SirReel · Production Vehicles',
  description:
    'Cargo vans, supercubes, passenger vans, talent trailers and more — the SirReel production fleet.',
}

function fmtMoney(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function TruckPlaceholder() {
  return (
    <div className="w-full h-[160px] bg-gradient-to-br from-[#1a1a1c] to-[#0c0c0d] flex items-center justify-center">
      <svg width={54} height={54} viewBox="0 0 24 24" fill="none" stroke="#c39a3f" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="opacity-70">
        <path d="M5 17h14M5 17a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h11l3 4h0a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2M5 17a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2m6 0a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2" />
      </svg>
    </div>
  )
}

export default async function VehiclesIndexPage() {
  const vehicles = await getPublicVehicles()

  return (
    <>
      {/* Hero band — matches the order form's dark editorial band. */}
      <section className="bg-[#0c0c0d] text-white">
        <div className="max-w-[1480px] mx-auto px-5 py-12 sm:py-16">
          <div className="text-[12px] font-semibold tracking-[0.22em] uppercase text-[#c39a3f] mb-3.5" style={{ fontFamily: 'Archivo, sans-serif' }}>
            The Fleet
          </div>
          <h1 className="font-black tracking-tight leading-[0.95] text-[40px] sm:text-[56px] md:text-[64px] max-w-[16ch]" style={{ fontFamily: 'Archivo, sans-serif' }}>
            Production vehicles, ready to roll
          </h1>
          <p className="mt-4 max-w-[56ch] text-[#cfc9bd] text-base leading-relaxed">
            Cargo vans, supercubes, passenger vans, talent trailers and honeywagons. Pick a vehicle
            to see specs and pricing — then add it to your reservation.
          </p>
        </div>
      </section>

      {/* Grid */}
      <section className="max-w-[1480px] mx-auto px-5 py-10 sm:py-14">
        {vehicles.length === 0 ? (
          <p className="text-[#8b857a]">No vehicles are listed right now. Please check back soon.</p>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {vehicles.map((v) => {
              const priceOnQuote = v.dailyRate == null || v.dailyRate === 0
              return (
                <Link
                  key={v.id}
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
            })}
          </div>
        )}
      </section>
    </>
  )
}

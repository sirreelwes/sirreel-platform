import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getPublicVehicleBySlug } from '@/lib/site/vehicleCatalog'

/**
 * Public vehicle detail — /vehicles/[slug]. Reads LIVE from VehicleCategory by
 * slug (active only). Hero image via the public proxy, name + tagline, a spec
 * list (missing specs are simply omitted), the live resolved price
 * (price-on-quote when null), and an ORDER CTA into the order form.
 */
export const dynamic = 'force-dynamic'

function fmtMoney(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

export async function generateMetadata({
  params,
}: {
  params: { slug: string }
}): Promise<Metadata> {
  const v = await getPublicVehicleBySlug(params.slug)
  if (!v) return { title: 'SirReel · Vehicle' }
  return {
    title: `SirReel · ${v.name}`,
    description: v.tagline || v.subtitle || `${v.name} — SirReel production fleet.`,
  }
}

export default async function VehicleDetailPage({ params }: { params: { slug: string } }) {
  const v = await getPublicVehicleBySlug(params.slug)
  if (!v) notFound()

  const priceOnQuote = v.dailyRate == null || v.dailyRate === 0

  // Spec rows — omit any line with no value (graceful fallback).
  const specRows: { label: string; value: string }[] = [
    { label: 'Base vehicle', value: v.specs.baseVehicle ?? '' },
    { label: 'Model', value: v.specs.model ?? '' },
    { label: 'Fuel', value: v.specs.fuelType ?? '' },
    { label: 'Length', value: v.specs.lengthFt != null ? `${v.specs.lengthFt} ft` : '' },
    { label: 'Height clearance', value: v.specs.heightClearance ?? '' },
    { label: 'Interior box height', value: v.specs.interiorBoxHeight ?? '' },
    { label: 'Lift gate', value: v.specs.liftGateSpec ?? '' },
  ].filter((r) => r.value.trim() !== '')

  return (
    <div className="max-w-[1480px] mx-auto px-5 py-8 sm:py-12">
      <Link
        href="/vehicles"
        className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#8b857a] hover:text-[#0c0c0d] transition-colors"
        style={{ fontFamily: 'Archivo, sans-serif' }}
      >
        ← All vehicles
      </Link>

      <div className="mt-5 grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] items-start">
        {/* Hero image */}
        <div className="rounded-[18px] overflow-hidden border border-[#e4dfd4] bg-white shadow-sm">
          {v.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={v.photoUrl}
              alt={v.name}
              className="w-full h-[280px] sm:h-[400px] object-cover bg-[#f0eadb]"
            />
          ) : (
            <div className="w-full h-[280px] sm:h-[400px] bg-gradient-to-br from-[#1a1a1c] to-[#0c0c0d] flex items-center justify-center">
              <svg width={90} height={90} viewBox="0 0 24 24" fill="none" stroke="#c39a3f" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" className="opacity-70">
                <path d="M5 17h14M5 17a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h11l3 4h0a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2M5 17a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2m6 0a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2" />
              </svg>
            </div>
          )}
        </div>

        {/* Right column: name, tagline, price, specs, CTA */}
        <div>
          <h1 className="font-black tracking-tight leading-[0.98] text-[36px] sm:text-[46px]" style={{ fontFamily: 'Archivo, sans-serif' }}>
            {v.name}
          </h1>
          {(v.tagline || v.subtitle) && (
            <p className="mt-3 text-[17px] text-[#5a554c] leading-relaxed max-w-[46ch]">
              {v.tagline || v.subtitle}
            </p>
          )}

          {/* Price */}
          <div className="mt-5 flex items-baseline gap-2" style={{ fontFamily: 'Archivo, sans-serif' }}>
            {priceOnQuote ? (
              <span className="text-[#a37f2c] font-extrabold text-[20px]">PRICE ON QUOTE</span>
            ) : (
              <>
                <span className="text-[#0c0c0d] font-black text-[30px]">{fmtMoney(v.dailyRate!)}</span>
                <span className="text-[#8b857a] font-semibold text-[15px]">/day</span>
              </>
            )}
          </div>

          {/* Order CTA */}
          <div className="mt-5">
            <Link
              href="/order/supplies"
              className="inline-flex items-center gap-2 rounded-full bg-amber-600 hover:bg-amber-500 text-white px-6 py-3 text-[15px] font-bold transition-colors"
              style={{ fontFamily: 'Archivo, sans-serif' }}
            >
              Reserve this vehicle →
            </Link>
          </div>

          {/* Description */}
          {v.description && (
            <p className="mt-7 text-[15px] text-[#3a362f] leading-relaxed max-w-[52ch] whitespace-pre-line">
              {v.description}
            </p>
          )}

          {/* Specs */}
          {specRows.length > 0 && (
            <div className="mt-7">
              <div className="text-[12px] font-semibold tracking-[0.16em] uppercase text-[#8b857a] mb-3" style={{ fontFamily: 'Archivo, sans-serif' }}>
                Specifications
              </div>
              <dl className="rounded-[14px] border border-[#e4dfd4] bg-white overflow-hidden">
                {specRows.map((r, i) => (
                  <div
                    key={r.label}
                    className={`flex items-center justify-between gap-4 px-4 py-3 ${
                      i !== 0 ? 'border-t border-[#efe9dd]' : ''
                    }`}
                  >
                    <dt className="text-[13px] font-semibold uppercase tracking-[0.06em] text-[#8b857a]" style={{ fontFamily: 'Archivo, sans-serif' }}>
                      {r.label}
                    </dt>
                    <dd className="text-[15px] font-semibold text-[#0c0c0d] text-right">{r.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

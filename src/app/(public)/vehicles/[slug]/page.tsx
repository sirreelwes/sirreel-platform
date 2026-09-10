import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getPublicVehicleBySlug } from '@/lib/site/vehicleCatalog'
import { partnerSection } from '@/lib/site/partnerSections'
import { contactPrefillHref } from '@/lib/site/publicNav'
import VehicleGallery from '@/components/site/VehicleGallery'

/**
 * Public vehicle detail — /vehicles/[slug]. Reads LIVE from VehicleCategory by
 * slug (client-visible rows only — unpublished/hidden vehicles 404). Photo
 * gallery via the public proxy (primary hero + tap-to-swap thumbnails), name +
 * tagline, a spec list (missing specs are simply omitted), feature bullets, the
 * live resolved price (price-on-quote when null), and an ORDER CTA into the
 * order form.
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
    alternates: { canonical: `/vehicles/${params.slug}` },
  }
}

export default async function VehicleDetailPage({ params }: { params: { slug: string } }) {
  const v = await getPublicVehicleBySlug(params.slug)
  if (!v) notFound()

  const priceOnQuote = v.dailyRate == null || v.dailyRate === 0
  // A partner generator is not a "vehicle" to the client reading the button.
  const noun = v.partner ? partnerSection(v.section).noun : 'vehicle'
  const backHref = v.partner ? `/vehicles#${partnerSection(v.section).anchor}` : '/vehicles'

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
        href={backHref}
        className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#8b857a] hover:text-[#0c0c0d] transition-colors"
        style={{ fontFamily: 'Archivo, sans-serif' }}
      >
        ← {v.partner ? partnerSection(v.section).title : 'All vehicles'}
      </Link>

      <div className="mt-5 grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] items-start">
        {/* Photo gallery — primary hero + tap-to-swap thumbnails. */}
        <VehicleGallery
          photos={v.photos.map((p) => ({ id: p.id, src: p.src }))}
          fallbackSrc={v.photoUrl}
          alt={v.name}
        />

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
          {/* Partner attribution — permission-gated, see partnerAttribution.ts */}
          {v.suppliedBy && (
            <div className="mt-2 text-[14px] text-[#8b857a]">
              Supplied by <span className="text-[#0C657A] font-semibold">{v.suppliedBy}</span> for SirReel
            </div>
          )}

          {/* Price */}
          <div className="mt-5 flex items-baseline gap-2" style={{ fontFamily: 'Archivo, sans-serif' }}>
            {priceOnQuote ? (
              <span className="text-[#0C657A] font-extrabold text-[20px]">PRICE ON QUOTE</span>
            ) : (
              <>
                <span className="text-[#0c0c0d] font-black text-[30px]">{fmtMoney(v.dailyRate!)}</span>
                <span className="text-[#8b857a] font-semibold text-[15px]">/day</span>
              </>
            )}
          </div>

          {/* Order CTA */}
          <div className="mt-5">
            {v.partner ? (
              // A partner unit is quoted by a rep (the sub-rental conduit holds
              // the partner's dates and confirms the hold), and the self-serve
              // order form's vehicle rail carries only the owned fleet — so
              // "Reserve" would have dropped the client on a form without it.
              // Same door as the unlisted /unit page: a prefilled request.
              <>
                <Link
                  href={contactPrefillHref(`Availability request: ${v.name}`)}
                  className="inline-flex items-center gap-2 rounded-full bg-amber-600 hover:bg-amber-500 text-white px-6 py-3 text-[15px] font-bold transition-colors"
                  style={{ fontFamily: 'Archivo, sans-serif' }}
                >
                  Check availability for this {noun} →
                </Link>
                <p className="mt-2.5 text-[13px] text-[#8b857a]">Tell us your dates and location — your SirReel rep confirms the hold and sends a written estimate, usually the same day.</p>
              </>
            ) : (
              // Carries the vehicle through. Without the slug this dropped the
              // client on a generic order form with the vehicle rail far below
              // the fold — they had just told us exactly what they wanted and
              // then had to go find it.
              <Link
                href={`/order/supplies?vehicle=${encodeURIComponent(params.slug)}`}
                className="inline-flex items-center gap-2 rounded-full bg-amber-600 hover:bg-amber-500 text-white px-6 py-3 text-[15px] font-bold transition-colors"
                style={{ fontFamily: 'Archivo, sans-serif' }}
              >
                Reserve this {noun} →
              </Link>
            )}
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

          {/* Features — one bullet per stored line. */}
          {v.features.length > 0 && (
            <div className="mt-7">
              <div className="text-[12px] font-semibold tracking-[0.16em] uppercase text-[#8b857a] mb-3" style={{ fontFamily: 'Archivo, sans-serif' }}>
                Features
              </div>
              <ul className="rounded-[14px] border border-[#e4dfd4] bg-white px-5 py-4 space-y-2">
                {v.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-[15px] text-[#3a362f] leading-relaxed">
                    <span aria-hidden className="mt-[9px] w-1.5 h-1.5 rounded-full bg-[#4DB1C6] shrink-0" />
                    {f}
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

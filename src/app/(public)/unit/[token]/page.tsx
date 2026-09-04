import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getPublicUnitByToken } from '@/lib/sub-rentals/publicUnit'
import VehicleGallery from '@/components/site/VehicleGallery'

/**
 * UNLISTED unit page — /unit/[token].
 *
 * A client-facing page for a vehicle we don't publish in the catalog
 * (currently the subcontracted units). It is reachable only by its link:
 * nothing on the public site points here, sitemap.ts is an explicit
 * allow-list that omits it, and the metadata below re-asserts noindex
 * because the (public) layout turns indexing ON for the marketing pages
 * it normally wraps.
 *
 * NO RATES (Wes, 2026-08-28). The loader returns a type with no money on
 * it, so pricing cannot be rendered here even by accident — the numbers on
 * this model are the vendor's list price and our negotiated discount, and
 * neither belongs in front of a client. Pricing reaches them through the
 * estimate email instead, where a human sends it deliberately.
 */
export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: { token: string }
}): Promise<Metadata> {
  const unit = await getPublicUnitByToken(params.token)
  if (!unit) return { title: 'SirReel', robots: { index: false, follow: false } }
  return {
    title: `${unit.name} — SirReel Studio Services`,
    description: unit.description?.slice(0, 160) ?? `${unit.name} — available through SirReel.`,
    // Overrides the (public) layout's index:true. Shallow metadata merge
    // means this page's value wins; without it the link would be indexable
    // the moment a crawler found it anywhere.
    robots: { index: false, follow: false },
  }
}

export default async function PublicUnitPage({ params }: { params: { token: string } }) {
  const unit = await getPublicUnitByToken(params.token)
  if (!unit) notFound()

  const photos = unit.photos.map((p) => ({
    id: p.id,
    src: `/api/public/unit/${params.token}/photo/${p.id}`,
  }))

  return (
    <div className="max-w-[1480px] mx-auto px-5 py-8 sm:py-12">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] items-start">
        <VehicleGallery photos={photos} fallbackSrc={null} alt={unit.name} />

        <div>
          {unit.vehicleType && (
            <div
              className="text-[12px] font-semibold tracking-[0.16em] uppercase text-[#a37f2c] mb-2"
              style={{ fontFamily: 'Archivo, sans-serif' }}
            >
              {unit.vehicleType}
            </div>
          )}
          <h1
            className="font-black tracking-tight leading-[0.98] text-[36px] sm:text-[46px]"
            style={{ fontFamily: 'Archivo, sans-serif' }}
          >
            {unit.name}
          </h1>
          {unit.tagline && (
            <p className="mt-3 text-[17px] text-[#5a554c] leading-relaxed max-w-[46ch]">{unit.tagline}</p>
          )}

          <div className="mt-5">
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 rounded-full bg-amber-600 hover:bg-amber-500 text-white px-6 py-3 text-[15px] font-bold transition-colors"
              style={{ fontFamily: 'Archivo, sans-serif' }}
            >
              Request availability →
            </Link>
            <p className="mt-2.5 text-[13px] text-[#8b857a]">
              Your SirReel rep can send dates and a written estimate.
            </p>
          </div>

          {unit.description && (
            <p className="mt-7 text-[15px] text-[#3a362f] leading-relaxed max-w-[52ch] whitespace-pre-line">
              {unit.description}
            </p>
          )}

          {unit.specs.length > 0 && (
            <div className="mt-7">
              <div
                className="text-[12px] font-semibold tracking-[0.16em] uppercase text-[#8b857a] mb-3"
                style={{ fontFamily: 'Archivo, sans-serif' }}
              >
                Specifications
              </div>
              <ul className="rounded-[14px] border border-[#e4dfd4] bg-white px-5 py-4 space-y-2">
                {unit.specs.map((s) => (
                  <li
                    key={s}
                    className="flex items-start gap-2.5 text-[15px] text-[#3a362f] leading-relaxed"
                  >
                    <span aria-hidden className="mt-[9px] w-1.5 h-1.5 rounded-full bg-[#c39a3f] shrink-0" />
                    {s}
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

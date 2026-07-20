import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getStage, STUDIO_ADDRESS, STUDIO_AMENITIES } from '@/lib/site/stages'
import VehicleGallery from '@/components/site/VehicleGallery'

/**
 * Public stage detail — /stages/[slug]. Content from src/lib/site/stages.ts.
 * Areas with an external `href` (Standing Sets) 404 here — their card links
 * straight to the collection.
 */
export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const s = getStage(params.slug)
  if (!s || s.href) return { title: 'SirReel · Stages' }
  return {
    title: `SirReel · ${s.name}`,
    description: s.blurb.slice(0, 160),
  }
}

export default function StageDetailPage({ params }: { params: { slug: string } }) {
  const s = getStage(params.slug)
  if (!s || s.href) notFound()

  return (
    <div className="max-w-[1480px] mx-auto px-5 py-8 sm:py-12">
      <Link
        href="/stages"
        className="inline-flex items-center gap-2 rounded-full border border-[#e4dfd4] bg-white px-4 py-2 text-[13px] font-bold text-[#0c0c0d] shadow-sm hover:border-[#c39a3f] hover:bg-[#faf7f0] transition-colors"
        style={{ fontFamily: 'Archivo, sans-serif' }}
      >
        <span aria-hidden className="text-[15px] leading-none">←</span>
        Back to all stages
      </Link>

      <div className="mt-5 grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] items-start">
        {/* Gallery */}
        <VehicleGallery
          photos={(s.gallery ?? (s.photo ? [s.photo] : [])).map((src, i) => ({ id: String(i), src }))}
          fallbackSrc={s.photo ?? null}
          alt={s.name}
        />

        <div>
          <div className="text-[11px] font-semibold tracking-[0.18em] uppercase text-[#c39a3f]" style={{ fontFamily: 'Archivo, sans-serif' }}>
            {s.eyebrow}
          </div>
          <h1 className="mt-2 font-black tracking-tight leading-[0.98] text-[36px] sm:text-[46px]" style={{ fontFamily: 'Archivo, sans-serif' }}>
            {s.name}
          </h1>
          <p className="mt-2 text-[14.5px] text-[#8b857a]">Ideal for {s.idealFor.toLowerCase()}.</p>
          <p className="mt-1 text-[13px] text-[#a49b88]">{STUDIO_ADDRESS.line1} · {STUDIO_ADDRESS.line2}</p>

          {/* Specs */}
          {s.specs.length > 0 && (
            <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-[14px] border border-[#e4dfd4] bg-[#e4dfd4]">
              {s.specs.map((spec) => (
                <div key={spec.label} className="bg-white px-4 py-3">
                  <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#a49b88]">{spec.label}</dt>
                  <dd className="mt-0.5 text-[15px] font-bold text-[#0c0c0d]" style={{ fontFamily: 'Archivo, sans-serif' }}>
                    {spec.value}
                  </dd>
                </div>
              ))}
            </dl>
          )}

          <div className="mt-6">
            <Link
              href="/stages#availability"
              className="inline-flex items-center gap-2 rounded-full bg-amber-600 hover:bg-amber-500 text-white px-6 py-3 text-[15px] font-bold transition-colors"
              style={{ fontFamily: 'Archivo, sans-serif' }}
            >
              {s.cta ?? 'Check Availability →'}
            </Link>
          </div>

          {s.description && (
            <p className="mt-7 text-[15px] text-[#3a362f] leading-relaxed max-w-[52ch] whitespace-pre-line">
              {s.description}
            </p>
          )}
        </div>
      </div>

      {/* Facility-wide amenities */}
      <section className="mt-12 border-t border-[#e4dfd4] pt-8">
        <div className="text-[11px] font-semibold tracking-[0.18em] uppercase text-[#c39a3f] mb-5" style={{ fontFamily: 'Archivo, sans-serif' }}>
          On-site &amp; included
        </div>
        <div className="grid gap-8 sm:grid-cols-3">
          {STUDIO_AMENITIES.map((g) => (
            <div key={g.heading}>
              <div className="font-extrabold text-[15px] tracking-tight mb-2" style={{ fontFamily: 'Archivo, sans-serif' }}>
                {g.heading}
              </div>
              <ul className="space-y-1.5">
                {g.items.map((item) => (
                  <li key={item} className="flex gap-2 text-[14px] text-[#3a362f] leading-snug">
                    <span aria-hidden className="text-[#c39a3f] mt-px">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

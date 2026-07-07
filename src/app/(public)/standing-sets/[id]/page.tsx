import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getPublicSpaceById } from '@/lib/site/spaces'
import VehicleGallery from '@/components/site/VehicleGallery'

/**
 * Public standing-set detail — /standing-sets/[id]. Reads LIVE from Space
 * by id (client-visible rows only — unpublished/photo-less/wrong-type 404).
 * Photo gallery via the public proxy (reuses VehicleGallery), full
 * description, and a "Check Availability" button back to the list's
 * inquiry section.
 */
export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const s = await getPublicSpaceById(params.id)
  if (!s || s.type !== 'STANDING_SET') return { title: 'SirReel · Standing Set' }
  return {
    title: `SirReel · ${s.name}`,
    description: s.description?.slice(0, 160) || `${s.name} — a SirReel standing set.`,
  }
}

export default async function StandingSetDetailPage({ params }: { params: { id: string } }) {
  const s = await getPublicSpaceById(params.id)
  // Only standing sets render here — a Stage/LED-Wall id 404s on this route.
  if (!s || s.type !== 'STANDING_SET') notFound()

  return (
    <div className="max-w-[1480px] mx-auto px-5 py-8 sm:py-12">
      <Link
        href="/standing-sets"
        className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#8b857a] hover:text-[#0c0c0d] transition-colors"
        style={{ fontFamily: 'Archivo, sans-serif' }}
      >
        ← All standing sets
      </Link>

      <div className="mt-5 grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] items-start">
        <VehicleGallery
          photos={s.photos.map((p) => ({ id: p.id, src: p.src }))}
          fallbackSrc={s.photoUrl}
          alt={s.name}
        />

        <div>
          <h1 className="font-black tracking-tight leading-[0.98] text-[36px] sm:text-[46px]" style={{ fontFamily: 'Archivo, sans-serif' }}>
            {s.name}
          </h1>

          <div className="mt-6">
            <Link
              href="/standing-sets#availability"
              className="inline-flex items-center gap-2 rounded-full bg-amber-600 hover:bg-amber-500 text-white px-6 py-3 text-[15px] font-bold transition-colors"
              style={{ fontFamily: 'Archivo, sans-serif' }}
            >
              Check Availability →
            </Link>
          </div>

          {s.description && (
            <p className="mt-7 text-[15px] text-[#3a362f] leading-relaxed max-w-[52ch] whitespace-pre-line">
              {s.description}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

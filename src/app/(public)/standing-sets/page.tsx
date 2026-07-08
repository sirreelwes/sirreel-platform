import Link from 'next/link'
import type { Metadata } from 'next'
import { getPublicSpaces } from '@/lib/site/spaces'
import { getPageTitles } from '@/lib/site/siteSettings'
import { StandingSetAvailabilityForm } from '@/components/site/StandingSetAvailabilityForm'

/**
 * Public /standing-sets — gallery of PUBLISHED standing-set Spaces (each
 * with a photo) as cards linking to a detail page, plus a "Check
 * Availability" inquiry section whose set checkboxes are driven by the
 * same published rows. Reads LIVE from the Space table; photo-less /
 * unpublished sets are hidden (graceful, like /vehicles).
 */
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'SirReel · Standing Sets',
  description:
    'Turnkey standing sets — hospital, police station, jail, morgue and more — ready to shoot at SirReel.',
}

function SetPlaceholder() {
  return (
    <div className="w-full h-[190px] bg-gradient-to-br from-[#1a1a1c] to-[#0c0c0d] flex items-center justify-center">
      <svg width={54} height={54} viewBox="0 0 24 24" fill="none" stroke="#c39a3f" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="opacity-70">
        <path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h1M9 13h1M14 9h1M14 13h1M10 21v-4h4v4" />
      </svg>
    </div>
  )
}

/** First sentence / ~140 chars of the description for the card. */
function shortDesc(desc: string | null): string {
  if (!desc) return ''
  const flat = desc.replace(/\s+/g, ' ').trim()
  return flat.length > 150 ? `${flat.slice(0, 147).trimEnd()}…` : flat
}

export default async function StandingSetsPage() {
  const [sets, titles] = await Promise.all([getPublicSpaces('STANDING_SET'), getPageTitles()])

  return (
    <>
      {/* Hero */}
      <section className="bg-[#0c0c0d] text-white">
        <div className="max-w-[1480px] mx-auto px-5 py-12 sm:py-16">
          <div className="text-[12px] font-semibold tracking-[0.22em] uppercase text-[#c39a3f] mb-3.5" style={{ fontFamily: 'Archivo, sans-serif' }}>
            Standing Sets
          </div>
          <h1 className="font-black tracking-tight leading-[0.95] text-[40px] sm:text-[56px] md:text-[64px] max-w-[16ch]" style={{ fontFamily: 'Archivo, sans-serif' }}>
            {titles.standingSets}
          </h1>
          <p className="mt-4 max-w-[56ch] text-[#cfc9bd] text-base leading-relaxed">
            Purpose-built, ready-to-shoot environments. Browse the sets, then check availability for your dates.
          </p>
        </div>
      </section>

      {/* Grid */}
      <section className="max-w-[1480px] mx-auto px-5 py-10 sm:py-14">
        {sets.length === 0 ? (
          <p className="text-[#8b857a]">No standing sets are listed right now. Please check back soon.</p>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {sets.map((s) => (
              <Link
                key={s.id}
                href={`/standing-sets/${s.id}`}
                className="group bg-white rounded-[16px] overflow-hidden border border-[#e4dfd4] shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all flex flex-col"
              >
                {s.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.photoUrl} alt={s.name} className="w-full h-[190px] object-cover bg-[#f0eadb]" loading="lazy" />
                ) : (
                  <SetPlaceholder />
                )}
                <div className="p-4 flex flex-col gap-1.5 flex-1">
                  <div className="font-extrabold text-[18px] leading-tight tracking-tight" style={{ fontFamily: 'Archivo, sans-serif' }}>
                    {s.name}
                  </div>
                  {shortDesc(s.description) && (
                    <div className="text-[13.5px] text-[#8b857a] leading-snug">{shortDesc(s.description)}</div>
                  )}
                  <div className="mt-auto pt-2">
                    <span className="text-[13px] font-bold text-[#c39a3f] group-hover:translate-x-0.5 inline-block transition-transform" style={{ fontFamily: 'Archivo, sans-serif' }}>
                      View set →
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Check Availability */}
      <section id="availability" className="bg-[#0c0c0d] text-white scroll-mt-24">
        <div className="max-w-[1480px] mx-auto px-5 py-16 sm:py-20">
          <div className="grid gap-10 lg:grid-cols-[1fr_1.2fr] items-start">
            <div>
              <div className="text-[12px] font-semibold tracking-[0.22em] uppercase text-[#c39a3f] mb-4" style={{ fontFamily: 'Archivo, sans-serif' }}>
                Check Availability
              </div>
              <h2 className="font-black tracking-tight text-[30px] sm:text-[42px] leading-[1.05] max-w-[16ch]" style={{ fontFamily: 'Archivo, sans-serif' }}>
                Tell us your dates.
              </h2>
              <p className="text-[#a8a294] text-[15px] leading-relaxed mt-5 max-w-[44ch]">
                Pick the sets you need and your window — a SirReel team member will confirm availability. No bots, no auto-replies.
              </p>
            </div>
            <StandingSetAvailabilityForm sets={sets.map((s) => ({ id: s.id, name: s.name }))} />
          </div>
        </div>
      </section>
    </>
  )
}

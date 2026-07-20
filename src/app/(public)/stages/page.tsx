import Link from 'next/link'
import Image from 'next/image'
import type { Metadata } from 'next'
import { STAGES } from '@/lib/site/stages'
import { StandingSetAvailabilityForm } from '@/components/site/StandingSetAvailabilityForm'
import { SWatermark } from '@/components/site/SWatermark'

/**
 * Public /stages — overview of SirReel's stage offerings (Lankershim Sound
 * Stage, LED/Volume Stage, Standing Sets, Black Box) as cards, mirroring the
 * Standing Sets page. Content is curated in src/lib/site/stages.ts. The
 * Standing Sets card links out to the /standing-sets collection.
 */
export const metadata: Metadata = {
  title: 'SirReel · Stages',
  description:
    'Sound stage, LED/volume stage, turnkey standing sets, and a black box — production stages at SirReel’s Lankershim studios.',
}

function StagePlaceholder() {
  return (
    <div className="w-full h-[190px] bg-gradient-to-br from-[#1a1a1c] to-[#0c0c0d] flex items-center justify-center">
      <Image src="/s-logo-white.png" alt="" aria-hidden width={1118} height={1065} className="h-14 w-auto opacity-20" />
    </div>
  )
}

export default function StagesPage() {
  return (
    <>
      {/* Hero */}
      <section className="bg-[#0c0c0d] text-white relative overflow-hidden">
        <SWatermark />
        <div className="relative max-w-[1480px] mx-auto px-5 py-12 sm:py-16">
          <div className="text-[12px] font-semibold tracking-[0.22em] uppercase text-[#c39a3f] mb-3.5" style={{ fontFamily: 'Archivo, sans-serif' }}>
            Stages
          </div>
          <h1 className="font-black tracking-tight leading-[0.95] text-[40px] sm:text-[56px] md:text-[64px] max-w-[16ch]" style={{ fontFamily: 'Archivo, sans-serif' }}>
            SirReel Studio Complex
          </h1>
          <p className="mt-4 max-w-[58ch] text-[#cfc9bd] text-base leading-relaxed">
            A cyc sound stage, an LED volume for virtual production, turnkey standing sets, and a black box — all under one roof at our Lankershim studios. Explore each, then check availability for your dates.
          </p>
        </div>
      </section>

      {/* Grid */}
      <section className="max-w-[1480px] mx-auto px-5 py-10 sm:py-14">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {STAGES.map((s) => (
            <Link
              key={s.slug}
              href={s.href ?? `/stages/${s.slug}`}
              className="group bg-white rounded-[16px] overflow-hidden border border-[#e4dfd4] shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all flex flex-col"
            >
              {s.photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={s.photo} alt={s.name} className="w-full h-[190px] object-cover bg-[#f0eadb]" loading="lazy" />
              ) : (
                <StagePlaceholder />
              )}
              <div className="p-4 flex flex-col gap-1.5 flex-1">
                <div className="text-[10.5px] font-semibold tracking-[0.16em] uppercase text-[#c39a3f]" style={{ fontFamily: 'Archivo, sans-serif' }}>
                  {s.eyebrow}
                </div>
                <div className="font-extrabold text-[18px] leading-tight tracking-tight" style={{ fontFamily: 'Archivo, sans-serif' }}>
                  {s.name}
                </div>
                <div className="text-[13.5px] text-[#8b857a] leading-snug">{s.blurb}</div>
                <div className="mt-auto pt-2">
                  <span className="text-[13px] font-bold text-[#c39a3f] group-hover:translate-x-0.5 inline-block transition-transform" style={{ fontFamily: 'Archivo, sans-serif' }}>
                    {s.href ? 'Browse sets →' : 'View stage →'}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Check Availability */}
      <section id="availability" className="bg-[#0c0c0d] text-white scroll-mt-24 relative overflow-hidden">
        <SWatermark size={460} className="-right-24 -top-24 rotate-[6deg]" />
        <div className="relative max-w-[1480px] mx-auto px-5 py-16 sm:py-20">
          <div className="grid gap-10 lg:grid-cols-[1fr_1.2fr] items-start">
            <div>
              <div className="text-[12px] font-semibold tracking-[0.22em] uppercase text-[#c39a3f] mb-4" style={{ fontFamily: 'Archivo, sans-serif' }}>
                Check Availability
              </div>
              <h2 className="font-black tracking-tight text-[30px] sm:text-[42px] leading-[1.05] max-w-[16ch]" style={{ fontFamily: 'Archivo, sans-serif' }}>
                Tell us your dates.
              </h2>
              <p className="text-[#a8a294] text-[15px] leading-relaxed mt-5 max-w-[44ch]">
                Tell us which stage and your window — a SirReel team member will confirm availability. No bots, no auto-replies.
              </p>
            </div>
            <StandingSetAvailabilityForm sets={[]} />
          </div>
        </div>
      </section>
    </>
  )
}

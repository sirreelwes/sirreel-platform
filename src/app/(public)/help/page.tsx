import type { Metadata } from 'next'
import { SWatermark } from '@/components/site/SWatermark'
import { HelpAssistantPanel } from '@/components/site/HelpAssistantPanel'
import { HELP_VIDEOS } from '@/lib/site/helpVideos'
import { PUBLIC_CONTACT } from '@/lib/site/publicNav'

/**
 * Public /help — the SirReel help hub referenced on the after-hours line.
 * Hosts the after-hours assistant (inline, always open) plus how-to videos.
 * The assistant handles FAQs + server-verified access-code release; videos
 * are content-managed in src/lib/site/helpVideos.ts (admin-managed later).
 */

export const metadata: Metadata = {
  title: 'SirReel · Help',
  description:
    'Get help from SirReel — chat with our 24/7 after-hours assistant for access codes, directions and more, or watch how-to videos.',
}

export default function HelpPage() {
  const videos = HELP_VIDEOS

  return (
    <>
      {/* Hero + assistant */}
      <section className="bg-[#0c0c0d] text-white relative overflow-hidden">
        <SWatermark />
        <div className="relative max-w-[1200px] mx-auto px-5 py-12 sm:py-16">
          <div className="grid gap-10 lg:grid-cols-[1fr_1.15fr] lg:items-center">
            <div>
              <div className="text-[12px] font-semibold tracking-[0.22em] uppercase text-[#c39a3f] mb-3.5" style={{ fontFamily: 'Archivo, sans-serif' }}>
                Help
              </div>
              <h1 className="font-black tracking-tight leading-[0.95] text-[38px] sm:text-[52px] md:text-[60px] max-w-[14ch]" style={{ fontFamily: 'Archivo, sans-serif' }}>
                How can we help?
              </h1>
              <p className="mt-4 max-w-[52ch] text-[#cfc9bd] text-base leading-relaxed">
                Locked out after hours, lost a vehicle access code, or need directions? Our
                assistant is here 24/7 — right here, no waiting. For anything urgent, call{' '}
                <a href={PUBLIC_CONTACT.phoneHref} className="text-[#c39a3f] hover:text-[#d4a547] font-semibold whitespace-nowrap">
                  {PUBLIC_CONTACT.phone}
                </a>
                .
              </p>
              <div className="mt-6 flex flex-wrap gap-2.5 text-[12px]">
                {['Lost access code', 'Gate & lockbox', 'Directions', 'Reach my agent'].map((chip) => (
                  <span key={chip} className="rounded-full border border-white/15 bg-white/[0.04] px-3 py-1.5 text-[#cfc9bd]">
                    {chip}
                  </span>
                ))}
              </div>
            </div>
            <HelpAssistantPanel />
          </div>
        </div>
      </section>

      {/* How-to videos */}
      <section className="bg-[#f6f4ef] text-[#1b1a17]">
        <div className="max-w-[1200px] mx-auto px-5 py-12 sm:py-16">
          <div className="text-[12px] font-semibold tracking-[0.22em] uppercase text-[#c39a3f] mb-3" style={{ fontFamily: 'Archivo, sans-serif' }}>
            How-to videos
          </div>
          <h2 className="font-black tracking-tight text-[26px] sm:text-[34px] leading-tight max-w-[20ch]" style={{ fontFamily: 'Archivo, sans-serif' }}>
            Quick guides for the lot &amp; the gear
          </h2>

          {videos.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-dashed border-[#d8d2c4] bg-white/50 px-6 py-12 text-center">
              <div className="text-[15px] font-bold text-[#1b1a17]" style={{ fontFamily: 'Archivo, sans-serif' }}>
                Video guides are on the way.
              </div>
              <p className="mt-1.5 text-[13.5px] text-[#6d6759] max-w-[46ch] mx-auto">
                In the meantime, ask the assistant above — it can walk you through gate access, lockboxes,
                fuel and more, or connect you with your agent.
              </p>
            </div>
          ) : (
            <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {videos.map((v) => (
                <div key={v.id} className="rounded-2xl border border-[#e2ddd0] bg-white overflow-hidden shadow-sm">
                  <div className="relative aspect-video bg-black">
                    <iframe
                      src={v.embedUrl}
                      title={v.title}
                      loading="lazy"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                      className="absolute inset-0 h-full w-full"
                    />
                  </div>
                  <div className="p-4">
                    <div className="flex items-center gap-2">
                      {v.category && (
                        <span className="text-[10px] font-bold uppercase tracking-wider text-[#c39a3f]">{v.category}</span>
                      )}
                      {v.durationLabel && <span className="text-[11px] text-[#8a8272]">· {v.durationLabel}</span>}
                    </div>
                    <h3 className="mt-1 text-[15px] font-bold" style={{ fontFamily: 'Archivo, sans-serif' }}>{v.title}</h3>
                    <p className="mt-1 text-[13px] leading-relaxed text-[#3d392f]">{v.description}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Still need help */}
      <section className="bg-[#0c0c0d] text-white relative overflow-hidden">
        <SWatermark size={260} className="-right-12 -bottom-16 rotate-[-8deg]" />
        <div className="relative max-w-[1200px] mx-auto px-5 py-10 sm:py-12 flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
          <div>
            <div className="text-[18px] font-black" style={{ fontFamily: 'Archivo, sans-serif' }}>Still need a person?</div>
            <p className="text-[13.5px] text-[#cfc9bd] mt-1 max-w-[52ch]">
              Our 24/7 line is the fastest way to reach someone after hours.
            </p>
          </div>
          <a
            href={PUBLIC_CONTACT.phoneHref}
            className="inline-flex items-center gap-2 rounded-lg bg-[#c39a3f] hover:bg-[#d4ab50] text-[#0c0c0d] font-bold px-5 py-2.5 text-[14px] whitespace-nowrap transition-colors"
            style={{ fontFamily: 'Archivo, sans-serif' }}
          >
            Call {PUBLIC_CONTACT.phone}
          </a>
        </div>
      </section>
    </>
  )
}

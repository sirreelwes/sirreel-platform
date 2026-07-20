/**
 * Public /contact — the "Get in Touch" band, moved off Home when Home
 * became the diagonal service-nav (2026-07-06). The header nav's Contact
 * link and the mode-aware quote / payment-info deep-links route here
 * (?prefill=… seeds the message). Posts to /api/public/contact.
 *
 * A "Who we are" / team band is admin-managed (/admin/who-we-are) and
 * renders here only once enabled — off for now.
 */

import { ContactForm } from '@/components/site/ContactForm'
import { PUBLIC_CONTACT } from '@/lib/site/publicNav'
import { getPageTitles } from '@/lib/site/siteSettings'
import { SWatermark } from '@/components/site/SWatermark'
import { getTeamSection } from '@/lib/site/team'

export const dynamic = 'force-dynamic'

export default async function ContactPage({
  searchParams,
}: {
  searchParams?: { prefill?: string }
}) {
  const prefill = typeof searchParams?.prefill === 'string' ? searchParams.prefill.slice(0, 300) : ''
  const [titles, team] = await Promise.all([getPageTitles(), getTeamSection()])

  return (
    <>
    <section id="contact" className="bg-[#0c0c0d] text-white scroll-mt-24 relative overflow-hidden">
      <SWatermark size={460} className="-right-24 -top-24 rotate-[6deg]" />
      <div className="relative max-w-[1480px] mx-auto px-5 py-16 sm:py-24">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.2fr] items-start">
          <div>
            <div className="text-[12px] font-semibold tracking-[0.22em] uppercase text-[#c39a3f] mb-4" style={{ fontFamily: 'Archivo, sans-serif' }}>
              Get in Touch
            </div>
            <h1 className="font-black tracking-tight text-[32px] sm:text-[46px] leading-[1.05] max-w-[16ch]" style={{ fontFamily: 'Archivo, sans-serif' }}>
              {titles.contact}
            </h1>
            <p className="text-[#a8a294] text-[15px] leading-relaxed mt-5 max-w-[46ch]">
              Tell us what you need and when. A SirReel team member will follow up — no bots, no auto-replies.
            </p>
            <div className="mt-7 text-[14px] text-[#cfc9bd] leading-relaxed">
              <a href={PUBLIC_CONTACT.phoneHref} className="hover:text-white transition-colors">{PUBLIC_CONTACT.phone}</a>
              <br />
              <a href={PUBLIC_CONTACT.emailHref} className="hover:text-white transition-colors">{PUBLIC_CONTACT.email}</a>
              <br />
              <span className="text-[#8b857a]">{PUBLIC_CONTACT.address}</span>
            </div>
          </div>
          <ContactForm defaultMessage={prefill} />
        </div>
      </div>
    </section>

    {team.enabled && team.members.length > 0 && (
      <section className="bg-[#f6f2e8] text-[#1e2833]">
        <div className="max-w-[1480px] mx-auto px-5 py-16 sm:py-20">
          <div className="text-[12px] font-semibold tracking-[0.22em] uppercase text-[#b06d12] mb-4" style={{ fontFamily: 'Archivo, sans-serif' }}>
            Who we are
          </div>
          <h2 className="font-black tracking-tight text-[30px] sm:text-[42px] leading-[1.05] max-w-[18ch]" style={{ fontFamily: 'Archivo, sans-serif' }}>
            The crew behind your production.
          </h2>
          <div className="mt-10 grid gap-x-6 gap-y-9 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
            {team.members.map((m) => (
              <div key={m.id} className="text-center">
                <div className="aspect-square overflow-hidden rounded-2xl border border-[#e4dfd4] bg-white">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/public/catalog-image/team-photo/${m.id}`} alt={m.name} className="h-full w-full object-cover" loading="lazy" />
                </div>
                <div className="mt-3 font-extrabold text-[16px] tracking-tight" style={{ fontFamily: 'Archivo, sans-serif' }}>
                  {m.name}
                </div>
                <div className="text-[13px] text-[#8b857a] mt-0.5">{m.title}</div>
              </div>
            ))}
          </div>
        </div>
      </section>
    )}
    </>
  )
}

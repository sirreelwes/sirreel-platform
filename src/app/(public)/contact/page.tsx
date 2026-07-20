/**
 * Public /contact — the "Get in Touch" band, moved off Home when Home
 * became the diagonal service-nav (2026-07-06). The header nav's Contact
 * link and the mode-aware quote / payment-info deep-links route here
 * (?prefill=… seeds the message). Posts to /api/public/contact.
 *
 * Followed by a "Who we are" band (SirReel's own copy).
 */

import Link from 'next/link'
import { ContactForm } from '@/components/site/ContactForm'
import { PUBLIC_CONTACT } from '@/lib/site/publicNav'
import { getPageTitles } from '@/lib/site/siteSettings'
import { SWatermark } from '@/components/site/SWatermark'

export const dynamic = 'force-dynamic'

const OFFERINGS = [
  { label: 'Stages', href: '/stages', note: 'Sound stage, LED volume & black box' },
  { label: 'Standing Sets', href: '/standing-sets', note: 'Hospital, police, morgue & school' },
  { label: 'Vehicles', href: '/vehicles', note: 'Cube trucks, cargo & pop vans' },
  { label: 'Equipment', href: '/order/supplies', note: 'Grip, electric & on-set supplies' },
]

export default async function ContactPage({
  searchParams,
}: {
  searchParams?: { prefill?: string }
}) {
  const prefill = typeof searchParams?.prefill === 'string' ? searchParams.prefill.slice(0, 300) : ''
  const titles = await getPageTitles()

  return (
    <>
      {/* Get in touch */}
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

      {/* Who we are */}
      <section className="bg-[#f6f2e8] text-[#1e2833]">
        <div className="max-w-[1480px] mx-auto px-5 py-16 sm:py-20">
          <div className="grid gap-10 lg:grid-cols-[1fr_1.15fr] items-start">
            <div>
              <div className="text-[12px] font-semibold tracking-[0.22em] uppercase text-[#b06d12] mb-4" style={{ fontFamily: 'Archivo, sans-serif' }}>
                Who we are
              </div>
              <h2 className="font-black tracking-tight text-[30px] sm:text-[42px] leading-[1.05] max-w-[15ch]" style={{ fontFamily: 'Archivo, sans-serif' }}>
                One crew behind the whole production.
              </h2>
            </div>
            <div>
              <p className="text-[#3a362f] text-[17px] leading-relaxed max-w-[54ch]">
                We are a team that understands your concerns and works to solve challenges on your behalf.
              </p>
              <div className="mt-6 space-y-2.5">
                {['Always thinking ahead.', 'Always at the other end of the line.', 'Always on the job.'].map((line) => (
                  <div key={line} className="flex items-center gap-3">
                    <span aria-hidden className="h-[2px] w-6 bg-[#c39a3f] shrink-0" />
                    <span className="font-black text-[19px] sm:text-[21px] tracking-tight" style={{ fontFamily: 'Archivo, sans-serif' }}>
                      {line}
                    </span>
                  </div>
                ))}
              </div>

              <div className="grid sm:grid-cols-2 gap-3 mt-8">
                {OFFERINGS.map((o) => (
                  <Link
                    key={o.href}
                    href={o.href}
                    className="group flex items-center justify-between gap-3 rounded-[12px] border border-[#e4dfd4] bg-white px-4 py-3.5 hover:border-[#c39a3f] hover:shadow-sm transition-all"
                  >
                    <span>
                      <span className="block font-extrabold text-[15px] tracking-tight" style={{ fontFamily: 'Archivo, sans-serif' }}>
                        {o.label}
                      </span>
                      <span className="block text-[12.5px] text-[#8b857a] mt-0.5">{o.note}</span>
                    </span>
                    <span aria-hidden className="text-[#c39a3f] group-hover:translate-x-0.5 transition-transform" style={{ fontFamily: 'Archivo, sans-serif' }}>→</span>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}

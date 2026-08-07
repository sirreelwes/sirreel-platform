import Link from 'next/link'
import { SWatermark } from '@/components/site/SWatermark'
import { PUBLIC_CONTACT } from '@/lib/site/publicNav'

/**
 * Branded 404 for the public marketing surface.
 *
 * Two things route here:
 *  1. notFound() from a (public) page — an unknown vehicle slug, stage, or
 *     setup guide.
 *  2. The middleware's catch-all on the marketing and orders hosts, via the
 *     /site-404 trigger route. That previously returned literal
 *     `new NextResponse('Not found')` — unstyled text on a white page.
 *
 * This matters more after the Wix cutover than it looks: 15 legacy Wix URLs
 * are deliberately unmapped (dead pages, /minted*, the forms Wes chose to
 * drop), so this page IS the destination for anyone following an old
 * bookmark or a stale Google result. It should read as SirReel and offer a
 * way onward, not look like the site is broken.
 *
 * Deliberately NOT a search box — there is nothing to search. Links to the
 * places people actually want, plus the phone number, since a client who
 * hit a dead link is often mid-job and wants a person.
 */

const ARCHIVO = { fontFamily: 'Archivo, sans-serif' } as const

const DESTINATIONS = [
  { href: '/vehicles', label: 'Vehicles', hint: 'Cube trucks, cargo vans, trailers' },
  { href: '/stages', label: 'Stages & Studios', hint: 'Stages and standing sets' },
  { href: '/order/supplies', label: 'Order supplies', hint: 'Build an order online' },
  { href: '/help', label: 'Help', hint: 'Setup guides and the 24/7 assistant' },
]

export default function PublicNotFound() {
  return (
    <section className="bg-[#0c0c0d] text-white relative overflow-hidden">
      <SWatermark />
      <div className="relative max-w-[1200px] mx-auto px-5 py-16 sm:py-24">
        <div className="text-[12px] font-semibold tracking-[0.22em] uppercase text-[#c39a3f] mb-3" style={ARCHIVO}>
          404
        </div>
        <h1
          className="font-black tracking-tight leading-[0.95] text-[38px] sm:text-[52px] md:text-[60px] max-w-[16ch]"
          style={ARCHIVO}
        >
          That page isn&rsquo;t here anymore
        </h1>
        <p className="mt-4 max-w-[56ch] text-[#cfc9bd] text-base leading-relaxed">
          We rebuilt sirreel.com, and a few older pages didn&rsquo;t come across. Nothing is wrong on
          your end — the link you followed just points somewhere that no longer exists.
        </p>

        <div className="mt-9 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {DESTINATIONS.map((d) => (
            <Link
              key={d.href}
              href={d.href}
              className="group rounded-2xl border border-white/15 bg-white/[0.04] p-5 transition-colors hover:border-[#c39a3f] hover:bg-[#c39a3f]/[0.08]"
            >
              <div
                className="text-[16px] font-black group-hover:text-[#c39a3f] transition-colors"
                style={ARCHIVO}
              >
                {d.label}
              </div>
              <div className="mt-1 text-[13px] leading-relaxed text-[#a8a294]">{d.hint}</div>
            </Link>
          ))}
        </div>

        <div className="mt-10 pt-7 border-t border-white/12 flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
          <div>
            <div className="text-[16px] font-black" style={ARCHIVO}>
              Looking for something specific?
            </div>
            <p className="text-[13.5px] text-[#cfc9bd] mt-1 max-w-[52ch]">
              If you were sent this link by a SirReel agent, call us and we&rsquo;ll point you at the
              right place — we answer 24/7.
            </p>
          </div>
          <a
            href={PUBLIC_CONTACT.phoneHref}
            className="inline-flex items-center gap-2 rounded-lg bg-[#c39a3f] hover:bg-[#d4ab50] text-[#0c0c0d] font-bold px-5 py-2.5 text-[14px] whitespace-nowrap transition-colors"
            style={ARCHIVO}
          >
            Call {PUBLIC_CONTACT.phone}
          </a>
        </div>
      </div>
    </section>
  )
}

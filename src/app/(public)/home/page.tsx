/**
 * Public site Home — the sirreel.com landing, inside the (public) shell
 * (Cinelease-structure header/footer come from the group layout).
 *
 * Lives at /home because `/` is host-owned by the middleware (orders →
 * supply form, hq → dashboard, tsx → portal sign-in); the sirreel.com
 * host branch rewrites its root here.
 *
 * Content rules: Los Angeles only, no fabricated testimonials/stats.
 * Fleet grid reuses getPublicVehicles() — published + photo-gated +
 * standard rate resolver — no new catalog API surface.
 */

import Link from 'next/link'
import { getPublicVehicles } from '@/lib/site/vehicleCatalog'
import { ContactForm } from '@/components/site/ContactForm'
import { PUBLIC_CONTACT } from '@/lib/site/publicNav'

export const dynamic = 'force-dynamic'

function fmtRate(n: number | null): string {
  if (n == null || n === 0) return 'Price on quote'
  return `$${Number.isInteger(n) ? n : n.toFixed(2)}/day`
}

export default async function PublicHomePage() {
  const vehicles = await getPublicVehicles()

  return (
    <div>
      {/* ── 1. HERO — dark, roomy, no CTA buttons ────────────────── */}
      <section className="bg-[#0c0c0d] text-white relative overflow-hidden">
        {/* future: full-bleed <Image fill> + dark scrim slot here */}
        <div className="relative z-10 max-w-[1480px] mx-auto px-5 py-24 sm:py-32">
          <div className="text-[12px] font-semibold tracking-[0.22em] uppercase text-[#c39a3f] mb-5" style={{ fontFamily: 'Archivo, sans-serif' }}>
            Production Rentals — Los Angeles
          </div>
          <h1
            className="font-black tracking-tight leading-[0.95] text-[44px] sm:text-[64px] md:text-[80px] lg:text-[92px] max-w-[14ch]"
            style={{ fontFamily: 'Archivo, sans-serif' }}
          >
            Your gear is already on the truck.
          </h1>
          <div className="w-16 h-[3px] bg-[#c39a3f] mt-8 mb-7" />
          <p className="text-[#cfc9bd] text-[17px] sm:text-[20px] max-w-[52ch] leading-relaxed">
            Production vehicles, stages, and supplies — staged, strapped, and ready to roll.
          </p>
        </div>
      </section>

      {/* ── 2. THE FLEET — all published vehicles on cream ───────── */}
      <section className="max-w-[1480px] mx-auto px-5 py-16 sm:py-20">
        <div className="flex items-baseline gap-4 mb-8">
          <h2 className="font-black tracking-tight text-[30px] sm:text-[38px]" style={{ fontFamily: 'Archivo, sans-serif' }}>
            The Fleet
          </h2>
          <span className="flex-1 h-[2px] bg-[#c39a3f] opacity-40" />
          <Link
            href="/vehicles"
            className="text-[13px] font-bold uppercase tracking-[0.08em] text-[#a37f2c] hover:underline underline-offset-4 whitespace-nowrap"
            style={{ fontFamily: 'Archivo, sans-serif' }}
          >
            See all →
          </Link>
        </div>

        {vehicles.length === 0 ? (
          <p className="text-[#8b857a]">Our fleet listing is coming online — check back soon.</p>
        ) : (
          <div className="grid gap-6 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
            {vehicles.map((v) => (
              <Link
                key={v.id}
                href={`/vehicles/${v.slug}`}
                className="group bg-white rounded-[16px] overflow-hidden border border-[#e4dfd4] shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all"
              >
                {v.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={v.photoUrl}
                    alt={v.name}
                    loading="lazy"
                    className="w-full aspect-[16/10] object-cover bg-[#f0eadb]"
                  />
                ) : (
                  // Intentional dark placeholder — the SirReel S mark,
                  // not a broken-image state.
                  <div className="w-full aspect-[16/10] bg-[#0c0c0d] flex items-center justify-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/s-logo-white.png" alt="" className="w-14 h-14 opacity-70" />
                  </div>
                )}
                <div className="p-5">
                  <div className="font-extrabold text-[18px] leading-tight tracking-tight" style={{ fontFamily: 'Archivo, sans-serif' }}>
                    {v.name}
                  </div>
                  {v.subtitle && (
                    <div className="text-[13px] text-[#8b857a] mt-0.5">{v.subtitle}</div>
                  )}
                  <div className="text-[14px] font-bold text-[#a37f2c] mt-2" style={{ fontFamily: 'Archivo, sans-serif' }}>
                    {fmtRate(v.dailyRate)}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* ── 3. CONTACT BAND — dark, anchored #contact ────────────── */}
      <section id="contact" className="bg-[#0c0c0d] text-white scroll-mt-24">
        <div className="max-w-[1480px] mx-auto px-5 py-16 sm:py-20">
          <div className="grid gap-10 lg:grid-cols-[1fr_1.2fr] items-start">
            <div>
              <div className="text-[12px] font-semibold tracking-[0.22em] uppercase text-[#c39a3f] mb-4" style={{ fontFamily: 'Archivo, sans-serif' }}>
                Get in Touch
              </div>
              <h2 className="font-black tracking-tight text-[32px] sm:text-[42px] leading-[1.05] max-w-[16ch]" style={{ fontFamily: 'Archivo, sans-serif' }}>
                Let&rsquo;s get your production rolling.
              </h2>
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
            <ContactForm />
          </div>
        </div>
      </section>
    </div>
  )
}

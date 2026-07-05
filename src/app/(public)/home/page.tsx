/**
 * Public site Home — the sirreel.com landing page, inside the (public)
 * shell (nav + footer + Archivo/Hanken come from the group layout).
 *
 * Lives at /home because `/` is host-owned by the middleware
 * (orders → supply form, hq → dashboard, tsx → portal sign-in); the
 * future sirreel.com host branch rewrites its root here.
 *
 * Content rules (2026-07-05 brief): Los Angeles only, no fabricated
 * testimonials/stats, contact info comes from the shared footer.
 * Fleet strip reuses getPublicVehicles() — published + photo-gated +
 * standard rate resolver — no new API surface.
 */

import Link from 'next/link'
import Image from 'next/image'
import { getPublicVehicles } from '@/lib/site/vehicleCatalog'

export const dynamic = 'force-dynamic'

const ORDER_FORM_HREF = '/order/supplies'

function fmtRate(n: number | null): string {
  if (n == null || n === 0) return 'Price on quote'
  return `$${Number.isInteger(n) ? n : n.toFixed(2)}/day`
}

export default async function PublicHomePage() {
  const vehicles = (await getPublicVehicles()).slice(0, 6)

  return (
    <div>
      {/* ── 1. HERO ──────────────────────────────────────────────
          Full-viewport dark band. The inner wrapper is position:
          relative with an isolated z-stack so a future full-bleed
          <Image fill> + dark scrim drops in behind `.relative z-10`
          content with zero restructuring. */}
      <section className="bg-[#0c0c0d] text-white relative overflow-hidden">
        {/* future: <Image fill> + <div className="absolute inset-0 bg-black/60" /> here */}
        <div className="relative z-10 max-w-[1480px] mx-auto px-5 min-h-[88vh] flex flex-col justify-center py-20">
          <Image
            src="/s-logo-white.png"
            alt="SirReel"
            width={64}
            height={64}
            className="w-12 h-12 sm:w-16 sm:h-16 mb-8"
            priority
          />
          <h1
            className="font-black tracking-tight leading-[0.95] text-[44px] sm:text-[64px] md:text-[80px] lg:text-[92px] max-w-[13ch]"
            style={{ fontFamily: 'Archivo, sans-serif' }}
          >
            Your gear is already on the truck.
          </h1>
          <div className="w-16 h-[3px] bg-[#c39a3f] mt-7 mb-6" />
          <p className="text-[#cfc9bd] text-[17px] sm:text-[19px] max-w-[44ch] leading-relaxed">
            Production vehicles, stages, and supplies — ready to roll, Los Angeles.
          </p>
          <div className="flex flex-wrap gap-3 mt-9">
            <Link
              href="/vehicles"
              className="bg-white text-[#0c0c0d] rounded-xl px-7 py-4 text-[15px] font-extrabold tracking-wide hover:bg-[#c39a3f] transition-colors"
              style={{ fontFamily: 'Archivo, sans-serif' }}
            >
              Browse the fleet
            </Link>
            <Link
              href={ORDER_FORM_HREF}
              className="border-[1.5px] border-white/30 text-white rounded-xl px-7 py-4 text-[15px] font-extrabold tracking-wide hover:border-[#c39a3f] hover:text-[#c39a3f] transition-colors"
              style={{ fontFamily: 'Archivo, sans-serif' }}
            >
              Start an order
            </Link>
          </div>
        </div>
      </section>

      {/* ── 2. WHAT WE DO ──────────────────────────────────────── */}
      <section className="max-w-[1480px] mx-auto px-5 py-16 sm:py-20">
        <div className="grid gap-5 sm:grid-cols-3">
          <Link
            href="/vehicles"
            className="group bg-white rounded-[16px] border border-[#e4dfd4] p-7 hover:-translate-y-0.5 hover:shadow-md transition-all"
          >
            <h2 className="font-extrabold text-[22px] tracking-tight" style={{ fontFamily: 'Archivo, sans-serif' }}>
              Vehicles
            </h2>
            <p className="text-[#5b554b] text-[14.5px] leading-relaxed mt-2">
              Preloaded production trucks, vans, and trailers — picked up or delivered to set.
            </p>
            <span className="inline-block mt-4 text-[13px] font-bold text-[#a37f2c] group-hover:underline underline-offset-4" style={{ fontFamily: 'Archivo, sans-serif' }}>
              Browse the fleet →
            </span>
          </Link>
          {/* Studios — coming soon, non-clickable (mirrors the nav's
              inactive placeholder treatment). */}
          <div className="bg-white rounded-[16px] border border-[#e4dfd4] p-7 cursor-not-allowed select-none" title="Coming soon">
            <h2 className="font-extrabold text-[22px] tracking-tight text-[#8b857a]" style={{ fontFamily: 'Archivo, sans-serif' }}>
              Studios
            </h2>
            <p className="text-[#8b857a] text-[14.5px] leading-relaxed mt-2">
              Stage space, standing sets, and studio services in Sun Valley.
            </p>
            <span className="inline-block mt-4 text-[11px] font-bold uppercase tracking-[0.1em] text-[#a8a294]" style={{ fontFamily: 'Archivo, sans-serif' }}>
              Coming soon
            </span>
          </div>
          <Link
            href={ORDER_FORM_HREF}
            className="group bg-white rounded-[16px] border border-[#e4dfd4] p-7 hover:-translate-y-0.5 hover:shadow-md transition-all"
          >
            <h2 className="font-extrabold text-[22px] tracking-tight" style={{ fontFamily: 'Archivo, sans-serif' }}>
              Supplies &amp; Equipment
            </h2>
            <p className="text-[#5b554b] text-[14.5px] leading-relaxed mt-2">
              Basecamp basics, power, safety, and expendables — order online, on the truck when you need it.
            </p>
            <span className="inline-block mt-4 text-[13px] font-bold text-[#a37f2c] group-hover:underline underline-offset-4" style={{ fontFamily: 'Archivo, sans-serif' }}>
              Start an order →
            </span>
          </Link>
        </div>
      </section>

      {/* ── 3. FLEET STRIP ─────────────────────────────────────── */}
      {vehicles.length > 0 && (
        <section className="max-w-[1480px] mx-auto px-5 pb-16 sm:pb-20">
          <div className="flex items-baseline gap-4 mb-6">
            <h2 className="font-extrabold tracking-tight text-[26px] sm:text-[30px]" style={{ fontFamily: 'Archivo, sans-serif' }}>
              The fleet
            </h2>
            <span className="flex-1 h-[2px] bg-[#c39a3f] opacity-40" />
            <Link
              href="/vehicles"
              className="text-[13.5px] font-bold text-[#a37f2c] hover:underline underline-offset-4 whitespace-nowrap"
              style={{ fontFamily: 'Archivo, sans-serif' }}
            >
              See the full fleet →
            </Link>
          </div>
          <div className="grid gap-5 grid-cols-2 lg:grid-cols-3">
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
                  <div className="w-full aspect-[16/10] bg-[#0c0c0d] flex items-center justify-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/s-logo-white.png" alt="" className="w-12 h-12 opacity-70" />
                  </div>
                )}
                <div className="p-4">
                  <div className="font-extrabold text-[16px] leading-tight tracking-tight" style={{ fontFamily: 'Archivo, sans-serif' }}>
                    {v.name}
                  </div>
                  <div className="text-[13px] font-semibold text-[#a37f2c] mt-1" style={{ fontFamily: 'Archivo, sans-serif' }}>
                    {fmtRate(v.dailyRate)}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ── 4. THE SIRREEL WAY ─────────────────────────────────── */}
      <section className="bg-[#0c0c0d] text-white">
        <div className="max-w-[1480px] mx-auto px-5 py-16 sm:py-20">
          <div className="max-w-[62ch]">
            <div className="text-[12px] font-semibold tracking-[0.22em] uppercase text-[#c39a3f] mb-4" style={{ fontFamily: 'Archivo, sans-serif' }}>
              The SirReel Way
            </div>
            <p className="font-extrabold tracking-tight text-[24px] sm:text-[30px] leading-[1.25]" style={{ fontFamily: 'Archivo, sans-serif' }}>
              SirReel pioneered the preloaded production vehicle — gear staged, strapped, and ready before you arrive.
            </p>
            <p className="text-[#a8a294] text-[15.5px] leading-relaxed mt-5">
              No load-in, no checklist scramble. You pick up a truck that&rsquo;s already a working department,
              built on about three decades of serving Los Angeles production.
            </p>
          </div>
        </div>
      </section>
    </div>
  )
}

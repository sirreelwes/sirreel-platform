/**
 * vermardesign.com — the basic site for HQ (Wes 2026-09-05: "drop a basic
 * website for hq at vermardesign.com"). One page: what it is, what it
 * does, the plans, how to get in. Copy comes from product.ts so this,
 * the partner landing and the workspace never disagree about the product.
 *
 * No form here yet — the way in today is a SirReel partner page (the
 * "See what HQ can do for you" link) or an email to VerMar. A direct
 * sign-up for companies that aren't SirReel partners is the next step.
 */
import { CalendarDays, ClipboardList, FileSignature, Truck, UserRound, Users } from 'lucide-react'
import { HQ_PITCH, HQ_PLANS, HQ_PRODUCT } from '@/lib/hq-white-label/product'

export const dynamic = 'force-static'

const ICONS = [CalendarDays, ClipboardList, Truck, Users, UserRound, FileSignature]
const ACCENT = '#f5b544'

export default function VerMarSitePage() {
  const mail = `mailto:${HQ_PRODUCT.supportEmail}?subject=${encodeURIComponent(`${HQ_PRODUCT.name} for my fleet`)}`
  return (
    <div>
      <header className="max-w-[1040px] mx-auto px-5 sm:px-8 py-6 flex items-center justify-between gap-4">
        <div className="flex items-baseline gap-2">
          <span className="text-[20px] font-black tracking-tight">{HQ_PRODUCT.name}</span>
          <span className="text-[11px] font-semibold uppercase tracking-[2px] text-white/55">by {HQ_PRODUCT.maker}</span>
        </div>
        <a href={mail} className="rounded-lg px-4 py-2 text-[14px] font-bold text-[#0f1523] no-underline" style={{ background: ACCENT }}>Talk to us</a>
      </header>

      <section className="max-w-[1040px] mx-auto px-5 sm:px-8 pt-10 pb-16 sm:pt-20 sm:pb-24">
        <div className="text-[12px] font-bold uppercase tracking-[2.5px]" style={{ color: ACCENT }}>Fleet operations for production-vehicle companies</div>
        <h1 className="mt-4 text-[38px] sm:text-[60px] font-black leading-[1.02] tracking-tight max-w-[18ch]">{HQ_PRODUCT.tagline}</h1>
        <p className="mt-6 text-[17px] sm:text-[20px] leading-relaxed text-white/75 max-w-[58ch]">
          Every trailer, truck and honeywagon you own on one calendar. Your own productions booked beside the ones that come through your
          partners. Your brand on all of it. Built by the studio that runs a working Los Angeles fleet on the same system every day.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <a href={mail} className="rounded-lg px-5 py-3 text-[15px] font-bold text-[#0f1523] no-underline" style={{ background: ACCENT }}>Start a free {HQ_PRODUCT.trialDays}-day trial</a>
          <a href="#what" className="rounded-lg px-5 py-3 text-[15px] font-bold text-white border border-white/25 no-underline hover:bg-white/5">What it does</a>
        </div>
      </section>

      <section id="what" className="bg-[#f5f6f8] text-[#111827]">
        <div className="max-w-[1040px] mx-auto px-5 sm:px-8 py-16 sm:py-20">
          <h2 className="text-[28px] sm:text-[36px] font-black tracking-tight">What it does</h2>
          <p className="mt-2 text-[16px] text-[#4b5563] max-w-[60ch]">The things a fleet office does by phone, text and spreadsheet, written down once and visible to everyone.</p>
          <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {HQ_PITCH.map((p, i) => {
              const Icon = ICONS[i] ?? Truck
              return (
                <div key={p.title} className="bg-white border border-[#e3e6ea] rounded-2xl p-6">
                  <Icon className="w-6 h-6 text-[#1f3a5f]" />
                  <div className="mt-4 text-[17px] font-bold">{p.title}</div>
                  <p className="mt-2 text-[14px] leading-relaxed text-[#4b5563]">{p.body}</p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      <section className="bg-white text-[#111827]">
        <div className="max-w-[1040px] mx-auto px-5 sm:px-8 py-16 sm:py-20">
          <h2 className="text-[28px] sm:text-[36px] font-black tracking-tight">Plans</h2>
          <p className="mt-2 text-[16px] text-[#4b5563] max-w-[60ch]">Every trial starts on Starter, free for {HQ_PRODUCT.trialDays} days, no card. Nobody is charged without saying yes first.</p>
          <div className="mt-10 grid sm:grid-cols-2 gap-5 max-w-[820px]">
            {HQ_PLANS.map((p) => (
              <div key={p.key} className="border border-[#e3e6ea] rounded-2xl p-6">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="text-[22px] font-black">{p.name}</div>
                  <div className="text-[14px] font-semibold text-[#4b5563]">{p.monthlyUsd == null ? 'Pricing soon' : `$${p.monthlyUsd}/mo`}</div>
                </div>
                <p className="mt-1 text-[14px] text-[#4b5563]">{p.blurb}</p>
                <ul className="mt-4 space-y-2 text-[14px]">
                  {p.includes.map((f) => <li key={f} className="flex gap-2"><span className="text-[#1f3a5f] font-bold">✓</span>{f}</li>)}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="max-w-[1040px] mx-auto px-5 sm:px-8 py-16 sm:py-24">
        <h2 className="text-[28px] sm:text-[36px] font-black tracking-tight">Getting in</h2>
        <div className="mt-6 grid sm:grid-cols-2 gap-5 max-w-[820px]">
          <div className="rounded-2xl border border-white/15 p-6">
            <div className="text-[16px] font-bold">Already a SirReel partner?</div>
            <p className="mt-2 text-[14px] leading-relaxed text-white/70">Open your partner page and press &ldquo;See what HQ can do for you&rdquo; at the bottom. Your units and bookings are on your calendar from the first minute.</p>
          </div>
          <div className="rounded-2xl border border-white/15 p-6">
            <div className="text-[16px] font-bold">Everyone else</div>
            <p className="mt-2 text-[14px] leading-relaxed text-white/70">Write to us with your company name and roughly how many units you run, and we&rsquo;ll set your workspace up by hand.</p>
            <a href={mail} className="inline-block mt-4 text-[14px] font-bold no-underline" style={{ color: ACCENT }}>{HQ_PRODUCT.supportEmail} →</a>
          </div>
        </div>
      </section>

      <footer className="max-w-[1040px] mx-auto px-5 sm:px-8 py-10 text-[12px] text-white/50 flex flex-wrap items-center justify-between gap-3 border-t border-white/10">
        <span>© 2026 {HQ_PRODUCT.maker}. {HQ_PRODUCT.name} is a {HQ_PRODUCT.maker} product.</span>
        <a href={mail} className="hover:text-white">{HQ_PRODUCT.supportEmail}</a>
      </footer>
    </div>
  )
}

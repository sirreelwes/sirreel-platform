/**
 * utliiz.com — the site. One page: what it is, what it does, the plans,
 * and a request form (no mailto — Wes 2026-09-06). Copy comes from
 * product.ts so this, the partner landing and the workspace never
 * disagree about the product.
 *
 * NEVER name SirReel here. Wes 2026-09-06: "we cannot reference SirReel as
 * a partner of Utliiz. To everyone but myself they should look like
 * distinct entities with no ties except SirReel uses them." SirReel is a
 * customer of Utliiz, and that is the only sentence about it that may ever
 * appear on this domain.
 */
import { CalendarDays, ClipboardList, FileSignature, Truck, UserRound, Users } from 'lucide-react'
import { HQ_PITCH, HQ_PLANS, HQ_PRODUCT } from '@/lib/hq-white-label/product'
import { RequestForm } from '@/components/hq-white-label/RequestForm'
import { UtliizIcon, UtliizWordmark } from '@/components/hq-white-label/UtliizMark'

export const dynamic = 'force-static'

const ICONS = [CalendarDays, ClipboardList, Truck, Users, UserRound, FileSignature]
const DISPLAY: React.CSSProperties = { fontFamily: 'var(--font-utliiz-display), system-ui, sans-serif' }

function Wordmark() {
  return (
    <span className="inline-flex items-center gap-3">
      <UtliizIcon size={34} />
      <UtliizWordmark height={30} />
      <span className="hidden sm:inline text-[11px] font-semibold uppercase tracking-[2px] text-[#0F7A93]/70 self-end pb-1">by {HQ_PRODUCT.maker}</span>
    </span>
  )
}

export default function UtliizSitePage() {
  return (
    <div>
      <header className="max-w-[1080px] mx-auto px-5 sm:px-8 py-6 flex items-center justify-between gap-4">
        <Wordmark />
        <a href="#request" className="rounded-full bg-[#0F7A93] hover:bg-[#0B5C70] px-5 py-2.5 text-[14px] font-bold text-white no-underline transition-colors">Request a workspace</a>
      </header>

      {/* Hero: pale aqua ground, a turquoise band of type, no dark block. */}
      <section className="max-w-[1080px] mx-auto px-5 sm:px-8 pt-8 pb-14 sm:pt-16 sm:pb-24 grid lg:grid-cols-[1.15fr_1fr] gap-10 items-center">
        <div>
          <div className="inline-block rounded-full bg-[#E4F1F4] text-[#0B5C70] text-[12px] font-bold uppercase tracking-[2px] px-3.5 py-1.5">Fleet operations for rental companies</div>
          <h1 className="mt-5 text-[44px] sm:text-[68px] font-extrabold leading-[0.98] tracking-[-0.02em] text-[#0f2a30]" style={DISPLAY}>
            {HQ_PRODUCT.tagline}
          </h1>
          <p className="mt-6 text-[17px] sm:text-[19px] leading-relaxed text-[#0f2a30]/75 max-w-[54ch]">
            Every unit you own on one calendar. Your own customers booked beside the jobs your partners send you. Your brand on all of it.
            Proven every day on a working production fleet in Los Angeles.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href="#request" className="rounded-full bg-[#0F7A93] hover:bg-[#0B5C70] px-6 py-3.5 text-[16px] font-bold text-white no-underline transition-colors">Start a free {HQ_PRODUCT.trialDays}-day trial</a>
            <a href="#what" className="rounded-full border-2 border-[#8FC2CE] px-6 py-3.5 text-[16px] font-bold text-[#0B5C70] no-underline hover:border-[#0F7A93] transition-colors">What it does</a>
          </div>
        </div>
        {/* A calendar glyph built from the palette — the product's one idea, drawn. */}
        <div className="rounded-[28px] bg-white border border-[#8FC2CE]/50 p-5 shadow-[0_20px_60px_rgba(15,122,147,0.12)]">
          <div className="flex items-center justify-between text-[12px] font-bold uppercase tracking-[1.6px] text-[#0F7A93]"><span>This week</span><span>4 of 6 out</span></div>
          <div className="mt-4 space-y-2.5">
            {[
              ['2-Room Star Wagon', 1, 4, 'out'],
              ['Honeywagon 12', 2, 5, 'confirmed'],
              ['Fuel truck', 0, 2, 'out'],
              ['EcoFlux', 3, 7, 'hold'],
              ['Cube truck', 5, 7, 'confirmed'],
              ['Makeup trailer', 0, 0, ''],
            ].map(([name, s, e, kind]) => (
              <div key={name as string} className="grid grid-cols-[120px_1fr] items-center gap-3">
                <div className="text-[13px] font-semibold text-[#0f2a30] truncate">{name}</div>
                <div className="relative h-7 rounded-lg bg-[#F1F8F9]">
                  {kind && (
                    <div
                      className={`absolute top-1 bottom-1 rounded-md ${kind === 'out' ? 'bg-[#0F7A93]' : kind === 'confirmed' ? 'bg-[#8FC2CE]' : 'bg-white border-2 border-dashed border-[#8FC2CE]'}`}
                      style={{ left: `${((s as number) / 7) * 100}%`, width: `${(((e as number) - (s as number) + 1) / 7) * 100}%` }}
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex gap-4 text-[11px] font-semibold text-[#0B5C70]">
            <span className="inline-flex items-center gap-1.5"><i className="w-3 h-3 rounded-sm bg-[#0F7A93]" />Out</span>
            <span className="inline-flex items-center gap-1.5"><i className="w-3 h-3 rounded-sm bg-[#8FC2CE]" />Confirmed</span>
            <span className="inline-flex items-center gap-1.5"><i className="w-3 h-3 rounded-sm border-2 border-dashed border-[#8FC2CE]" />Hold</span>
          </div>
        </div>
      </section>

      <section id="what" className="bg-white border-y border-[#8FC2CE]/40">
        <div className="max-w-[1080px] mx-auto px-5 sm:px-8 py-16 sm:py-20">
          <h2 className="text-[30px] sm:text-[40px] font-extrabold tracking-[-0.02em]" style={DISPLAY}>What it does</h2>
          <p className="mt-3 text-[17px] text-[#0f2a30]/70 max-w-[60ch]">The things a fleet office does by phone, text and spreadsheet, written down once and visible to everyone.</p>
          <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {HQ_PITCH.map((p, i) => {
              const Icon = ICONS[i] ?? Truck
              return (
                <div key={p.title} className="rounded-[22px] bg-[#F1F8F9] p-6">
                  <span className="inline-grid place-items-center w-11 h-11 rounded-2xl bg-[#E4F1F4] text-[#0F7A93]"><Icon className="w-5 h-5" /></span>
                  <div className="mt-4 text-[18px] font-bold" style={DISPLAY}>{p.title}</div>
                  <p className="mt-2 text-[14.5px] leading-relaxed text-[#0f2a30]/70">{p.body}</p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      <section className="max-w-[1080px] mx-auto px-5 sm:px-8 py-16 sm:py-20">
        <h2 className="text-[30px] sm:text-[40px] font-extrabold tracking-[-0.02em]" style={DISPLAY}>Plans</h2>
        <p className="mt-3 text-[17px] text-[#0f2a30]/70 max-w-[60ch]">Every trial starts on Starter, free for {HQ_PRODUCT.trialDays} days, no card. Nobody is charged without saying yes first.</p>
        <div className="mt-10 grid sm:grid-cols-2 gap-5 max-w-[860px]">
          {HQ_PLANS.map((p, i) => (
            <div key={p.key} className={`rounded-[22px] p-7 ${i === 1 ? 'bg-[#0B5C70] text-white' : 'bg-white border border-[#8FC2CE]/50'}`}>
              <div className="flex items-baseline justify-between gap-3">
                <div className="text-[24px] font-extrabold" style={DISPLAY}>{p.name}</div>
                <div className={`text-[13px] font-bold ${i === 1 ? 'text-[#8FC2CE]' : 'text-[#0F7A93]'}`}>{p.monthlyUsd == null ? 'Pricing soon' : `$${p.monthlyUsd}/mo`}</div>
              </div>
              <p className={`mt-1 text-[15px] ${i === 1 ? 'text-white/80' : 'text-[#0f2a30]/70'}`}>{p.blurb}</p>
              <ul className="mt-5 space-y-2.5 text-[15px]">
                {p.includes.map((f) => (
                  <li key={f} className="flex gap-2.5"><span className={`mt-[3px] inline-block w-4 h-4 rounded-full shrink-0 ${i === 1 ? 'bg-[#8FC2CE]' : 'bg-[#0F7A93]'}`} />{f}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section id="request" className="bg-white border-t border-[#8FC2CE]/40">
        <div className="max-w-[1080px] mx-auto px-5 sm:px-8 py-16 sm:py-20 grid lg:grid-cols-[1fr_1.2fr] gap-10">
          <div>
            <h2 className="text-[30px] sm:text-[40px] font-extrabold tracking-[-0.02em]" style={DISPLAY}>Request a workspace</h2>
            <p className="mt-3 text-[17px] text-[#0f2a30]/70 max-w-[44ch]">
              Tell us who you are and roughly what you run. We set every workspace up by hand so it starts with your fleet already in it, then email you the link.
            </p>
            <div className="mt-6 rounded-[22px] bg-[#F1F8F9] p-5 text-[14.5px] text-[#0f2a30]/75">
              <div className="font-bold text-[#0B5C70]">Rent units to other companies?</div>
              When a rental partner of yours runs {HQ_PRODUCT.name} too, their bookings of your units land on your calendar automatically, driver and call time included. Say who they are and we&rsquo;ll connect you.
            </div>
          </div>
          <div className="rounded-[28px] bg-white border border-[#8FC2CE]/50 p-6 sm:p-8 shadow-[0_20px_60px_rgba(15,122,147,0.10)]">
            <RequestForm />
          </div>
        </div>
      </section>

      <footer className="max-w-[1080px] mx-auto px-5 sm:px-8 py-10 text-[13px] text-[#0f2a30]/60 flex flex-wrap items-center justify-between gap-3">
        <span className="inline-flex items-center gap-3"><UtliizWordmark height={18} ink="#4b6b72" accent="#8FC2CE" /> © 2026 {HQ_PRODUCT.maker}.</span>
        <a href="#request" className="font-bold text-[#0F7A93] no-underline">Request a workspace →</a>
      </footer>
    </div>
  )
}

import type { Metadata } from 'next'
import {
  CANONICAL_CLAUSES,
  RENTAL_POLICIES,
  FLEET_AGREEMENT,
  LCDW_ADDENDUM,
} from '@/lib/contracts/contractClauses'

/**
 * Public /rental-agreement — interactive review page for the approved rental
 * agreement (FORMS → Rental Agreement). LEGAL-SENSITIVE: render-only. Every
 * word of agreement text comes from contractClauses.ts (RENTAL_POLICIES →
 * the numbered CANONICAL_CLAUSES → FLEET_AGREEMENT → LCDW_ADDENDUM — the same
 * order ContractDocument prints), so this page, the portal's document-to-sign,
 * and the "Download PDF" button (which regenerates from the same source via
 * /api/public/rental-agreement/pdf) can never drift. No signing here — signing
 * stays in the client portal flow.
 */

export const metadata: Metadata = {
  title: 'SirReel · Rental Agreement',
  description:
    'The SirReel Studio Rentals rental agreement — policies, terms & conditions, fleet agreement and LCDW addendum. Review online or download the PDF.',
}

// Mirrors ContractDocument's Terms & Conditions lede verbatim (presentation
// copy printed on the PDF, kept in lockstep by eye — clause text itself is
// imported, never re-typed).
const TERMS_LEDE =
  'Please read carefully. You are liable for our equipment and vehicles from the time they leave our premises until the time they are returned to us and we sign for them.'

const PDF_HREF = '/api/public/rental-agreement/pdf'

function DownloadButton({ compact = false }: { compact?: boolean }) {
  return (
    <a
      href={PDF_HREF}
      className={`inline-flex items-center gap-2 rounded-lg bg-[#c39a3f] hover:bg-[#d4ab50] text-[#0c0c0d] font-bold transition-colors ${
        compact ? 'px-3 py-1.5 text-[12px]' : 'px-5 py-2.5 text-[14px]'
      }`}
      style={{ fontFamily: 'Archivo, sans-serif' }}
    >
      <svg width={compact ? 13 : 15} height={compact ? 13 : 15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
      </svg>
      Download PDF
    </a>
  )
}

export default function RentalAgreementPage() {
  const toc: Array<{ id: string; label: string }> = [
    { id: 'policies', label: 'Rental Policies' },
    { id: 'terms', label: 'Terms & Conditions' },
    ...CANONICAL_CLAUSES.map((c) => ({ id: `clause-${c.ref}`, label: `${c.ref}. ${c.title}` })),
    { id: 'fleet', label: FLEET_AGREEMENT.title },
    { id: 'lcdw', label: LCDW_ADDENDUM.title },
  ]

  return (
    <>
      {/* Hero band — matches the public site's dark editorial band. */}
      <section className="bg-[#0c0c0d] text-white">
        <div className="max-w-[1200px] mx-auto px-5 py-12 sm:py-16">
          <div className="text-[12px] font-semibold tracking-[0.22em] uppercase text-[#c39a3f] mb-3.5" style={{ fontFamily: 'Archivo, sans-serif' }}>
            Forms
          </div>
          <h1 className="font-black tracking-tight leading-[0.95] text-[38px] sm:text-[52px] md:text-[60px] max-w-[16ch]" style={{ fontFamily: 'Archivo, sans-serif' }}>
            Rental Agreement
          </h1>
          <p className="mt-4 max-w-[58ch] text-[#cfc9bd] text-base leading-relaxed">
            The full SirReel Studio Rentals agreement — rental policies, the numbered terms &amp;
            conditions, the fleet agreement, and the Limited Collision Damage Waiver addendum.
            Review it below, or take a copy with you.
          </p>
          <div className="mt-6">
            <DownloadButton />
          </div>
        </div>
      </section>

      {/* Body — sticky section index on desktop, content sections anchored. */}
      <section className="bg-[#f6f4ef] text-[#1b1a17]">
        <div className="max-w-[1200px] mx-auto px-5 py-10 sm:py-14 lg:grid lg:grid-cols-[260px_1fr] lg:gap-10">
          {/* Section index (desktop) */}
          <nav aria-label="Agreement sections" className="hidden lg:block">
            <div className="sticky top-6 max-h-[calc(100vh-3rem)] overflow-y-auto pr-2">
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#8a8272] mb-2" style={{ fontFamily: 'Archivo, sans-serif' }}>
                On this page
              </div>
              <ul className="space-y-0.5 border-l border-[#e2ddd0]">
                {toc.map((t) => (
                  <li key={t.id}>
                    <a
                      href={`#${t.id}`}
                      className="block pl-3 py-1 text-[12px] leading-snug text-[#6d6759] hover:text-[#1b1a17] hover:border-l-2 hover:border-[#c39a3f] hover:-ml-[1px] transition-colors"
                    >
                      {t.label}
                    </a>
                  </li>
                ))}
              </ul>
              <div className="mt-4">
                <DownloadButton compact />
              </div>
            </div>
          </nav>

          {/* Agreement content — same section order as the printed PDF. */}
          <div className="min-w-0">
            {/* Rental Policies */}
            <section id="policies" className="scroll-mt-6">
              <h2 className="text-[22px] sm:text-[26px] font-black tracking-tight" style={{ fontFamily: 'Archivo, sans-serif' }}>
                Rental Policies
              </h2>
              <div className="mt-4 space-y-3">
                {RENTAL_POLICIES.map((p) => (
                  <div key={p.title} className="bg-white rounded-xl border border-[#e2ddd0] p-4 sm:p-5">
                    <h3 className="text-[14px] font-bold" style={{ fontFamily: 'Archivo, sans-serif' }}>{p.title}</h3>
                    <p className="mt-1.5 text-[13.5px] leading-relaxed text-[#3d392f]">{p.body}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* Terms & Conditions — the 29 numbered clauses */}
            <section id="terms" className="scroll-mt-6 mt-10">
              <h2 className="text-[22px] sm:text-[26px] font-black tracking-tight" style={{ fontFamily: 'Archivo, sans-serif' }}>
                Equipment and/or Vehicle Terms &amp; Conditions
              </h2>
              <p className="mt-2 text-[13.5px] leading-relaxed text-[#6d6759] italic max-w-[70ch]">{TERMS_LEDE}</p>
              <div className="mt-4 space-y-3">
                {CANONICAL_CLAUSES.map((cc) => (
                  <div key={cc.ref} id={`clause-${cc.ref}`} className="scroll-mt-6 bg-white rounded-xl border border-[#e2ddd0] p-4 sm:p-5">
                    <div className="flex items-baseline gap-2.5">
                      <span className="text-[13px] font-black text-[#c39a3f] tabular-nums" style={{ fontFamily: 'Archivo, sans-serif' }}>{cc.ref}.</span>
                      <h3 className="text-[14px] font-bold" style={{ fontFamily: 'Archivo, sans-serif' }}>{cc.title}</h3>
                    </div>
                    <p className="mt-1.5 text-[13.5px] leading-relaxed text-[#3d392f] whitespace-pre-line">{cc.body}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* Fleet Agreement */}
            <section id="fleet" className="scroll-mt-6 mt-10">
              <h2 className="text-[22px] sm:text-[26px] font-black tracking-tight" style={{ fontFamily: 'Archivo, sans-serif' }}>
                {FLEET_AGREEMENT.title}
              </h2>
              <p className="mt-2 text-[13.5px] leading-relaxed text-[#6d6759] italic max-w-[70ch]">{FLEET_AGREEMENT.intro}</p>
              <div className="mt-4 bg-white rounded-xl border border-[#e2ddd0] p-4 sm:p-5">
                <p className="text-[13.5px] leading-relaxed text-[#3d392f]">{FLEET_AGREEMENT.fuelPolicy}</p>
              </div>
            </section>

            {/* LCDW Addendum */}
            <section id="lcdw" className="scroll-mt-6 mt-10">
              <h2 className="text-[22px] sm:text-[26px] font-black tracking-tight" style={{ fontFamily: 'Archivo, sans-serif' }}>
                {LCDW_ADDENDUM.title}
              </h2>
              <div className="mt-4 bg-white rounded-xl border border-[#e2ddd0] p-4 sm:p-5 space-y-2">
                <p className="text-[13.5px] leading-relaxed font-bold text-[#1b1a17]">{LCDW_ADDENDUM.rate}</p>
                <p className="text-[13.5px] leading-relaxed text-[#3d392f]">{LCDW_ADDENDUM.scope}</p>
                <p className="text-[13.5px] leading-relaxed text-[#3d392f]">{LCDW_ADDENDUM.note}</p>
              </div>
            </section>

            {/* Tail CTA — review-only page; signing happens in the client portal. */}
            <div className="mt-12 bg-[#0c0c0d] text-white rounded-2xl p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
              <div>
                <div className="text-[16px] font-black" style={{ fontFamily: 'Archivo, sans-serif' }}>Need a copy for production?</div>
                <p className="text-[13px] text-[#cfc9bd] mt-1">
                  Download the agreement as a PDF — the same document your SirReel rep sends for signature.
                </p>
              </div>
              <DownloadButton />
            </div>
          </div>
        </div>
      </section>
    </>
  )
}

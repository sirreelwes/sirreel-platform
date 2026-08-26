import type { Metadata } from 'next'
import { RentalAgreementBody, agreementToc } from '@/components/contracts/RentalAgreementBody'
import { SWatermark } from '@/components/site/SWatermark'
import { AgreementEmailGate } from '@/components/site/AgreementEmailGate'

/**
 * Public /rental-agreement — interactive review page for the approved rental
 * agreement (FORMS → Rental Agreement). LEGAL-SENSITIVE: render-only. Every
 * word of agreement text comes from contractClauses.ts, rendered by the shared
 * RentalAgreementBody — the SAME component the client's signing page uses, so
 * this page, the document a client reviews before signing, and the "Download
 * PDF" button (which regenerates from the same source via
 * /api/public/rental-agreement/pdf) can never drift. No signing here — signing
 * stays in the client portal flow.
 */

export const metadata: Metadata = {
  title: 'SirReel · Rental Agreement',
  description:
    'The SirReel Studio Rentals rental agreement — policies, terms & conditions, fleet agreement and LCDW addendum. Review online or download the PDF.',
  alternates: { canonical: '/rental-agreement' },
}

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
  const toc = agreementToc()

  return (
    <>
      {/* Hero band — matches the public site's dark editorial band. */}
      <section className="bg-[#0c0c0d] text-white relative overflow-hidden">
        <SWatermark />
        <div className="relative max-w-[1200px] mx-auto px-5 py-12 sm:py-16 md:flex md:items-start md:justify-between md:gap-10">
          <div>
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
          {/* Email gate — upper-right. The response is a constant neutral
              message; all branching happens inside the emailed link. */}
          <div className="mt-8 md:mt-1 md:flex-none">
            <AgreementEmailGate />
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
            {/* Agreement content — same section order as the printed PDF. */}
            <RentalAgreementBody />

            {/* Tail CTA — review-only page; signing happens in the client portal. */}
            <div className="mt-12 bg-[#0c0c0d] text-white rounded-2xl p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center gap-4 justify-between relative overflow-hidden">
              <SWatermark size={220} className="-right-10 -bottom-12 rotate-[-8deg]" />
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

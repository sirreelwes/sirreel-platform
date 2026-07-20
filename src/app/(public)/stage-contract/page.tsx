import type { Metadata } from 'next'
import {
  STAGE_CONTRACT_OPENING,
  STAGE_CONTRACT_NO_EXTERIOR_FILMING_NOTICE,
  STAGE_CONTRACT_CLAUSES,
} from '@/lib/contracts/stageContractClauses'
import { SWatermark } from '@/components/site/SWatermark'

/**
 * Public /stage-contract — interactive review page for the SirReel Studio
 * Services stage booking contract (FORMS → Studio Contract). LEGAL-SENSITIVE:
 * render-only. Every word of contract text comes from stageContractClauses.ts
 * (the same source StageContractDocument prints), so this page and the
 * "Download PDF" button (which regenerates from the same source via
 * /api/public/stage-contract/pdf) can never drift. No signing here — signing
 * stays in the client portal flow.
 */

export const metadata: Metadata = {
  title: 'SirReel · Stage Contract',
  description:
    'The SirReel Studio Services stage booking contract — grant of use, fees, insurance requirements, products release and terms. Review online or download the PDF.',
}

const PDF_HREF = '/api/public/stage-contract/pdf'

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

export default function StageContractPage() {
  const toc: Array<{ id: string; label: string }> = [
    { id: 'parties', label: 'Parties & Grant' },
    ...STAGE_CONTRACT_CLAUSES.map((c) => ({ id: `clause-${c.ref}`, label: `${c.ref}. ${c.title}` })),
  ]

  return (
    <>
      {/* Hero band — matches the public site's dark editorial band. */}
      <section className="bg-[#0c0c0d] text-white relative overflow-hidden">
        <SWatermark />
        <div className="relative max-w-[1200px] mx-auto px-5 py-12 sm:py-16">
          <div className="text-[12px] font-semibold tracking-[0.22em] uppercase text-[#c39a3f] mb-3.5" style={{ fontFamily: 'Archivo, sans-serif' }}>
            Forms
          </div>
          <h1 className="font-black tracking-tight leading-[0.95] text-[38px] sm:text-[52px] md:text-[60px] max-w-[16ch]" style={{ fontFamily: 'Archivo, sans-serif' }}>
            Stage Contract
          </h1>
          <p className="mt-4 max-w-[58ch] text-[#cfc9bd] text-base leading-relaxed">
            The SirReel Studio Services stage booking contract — grant of use, fees and term,
            insurance requirements, the products release, and the full terms. Review it below, or
            take a copy with you.
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
          <nav aria-label="Contract sections" className="hidden lg:block">
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

          {/* Contract content — same section order as the printed PDF. */}
          <div className="min-w-0">
            {/* Parties / opening recital */}
            <section id="parties" className="scroll-mt-6">
              <h2 className="text-[22px] sm:text-[26px] font-black tracking-tight" style={{ fontFamily: 'Archivo, sans-serif' }}>
                Parties &amp; Grant
              </h2>
              <div className="mt-4 bg-white rounded-xl border border-[#e2ddd0] p-4 sm:p-5">
                <p className="text-[13.5px] leading-relaxed text-[#3d392f]">{STAGE_CONTRACT_OPENING}</p>
              </div>
            </section>

            {/* Numbered clauses — the no-exterior-filming notice sits between 4 and 5. */}
            <section className="mt-8">
              <div className="space-y-3">
                {STAGE_CONTRACT_CLAUSES.map((cc) => (
                  <div key={cc.ref}>
                    <div id={`clause-${cc.ref}`} className="scroll-mt-6 bg-white rounded-xl border border-[#e2ddd0] p-4 sm:p-5">
                      <div className="flex items-baseline gap-2.5">
                        <span className="text-[13px] font-black text-[#c39a3f] tabular-nums" style={{ fontFamily: 'Archivo, sans-serif' }}>{cc.ref}.</span>
                        <h3 className="text-[14px] font-bold" style={{ fontFamily: 'Archivo, sans-serif' }}>{cc.title}</h3>
                      </div>
                      <p className="mt-1.5 text-[13.5px] leading-relaxed text-[#3d392f] whitespace-pre-line">{cc.body}</p>
                    </div>
                    {cc.ref === '4' && (
                      <div className="mt-3 rounded-xl border border-[#d8cfb4] bg-[#efe9d8] px-4 py-3 text-center">
                        <p className="text-[13px] font-black tracking-wide text-[#1b1a17]" style={{ fontFamily: 'Archivo, sans-serif' }}>
                          {STAGE_CONTRACT_NO_EXTERIOR_FILMING_NOTICE}
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>

            {/* Tail CTA — review-only page; signing happens in the client portal. */}
            <div className="mt-12 bg-[#0c0c0d] text-white rounded-2xl p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center gap-4 justify-between relative overflow-hidden">
              <SWatermark size={220} className="-right-10 -bottom-12 rotate-[-8deg]" />
              <div>
                <div className="text-[16px] font-black" style={{ fontFamily: 'Archivo, sans-serif' }}>Booking a stage?</div>
                <p className="text-[13px] text-[#cfc9bd] mt-1">
                  Download the contract as a PDF — the same document your SirReel rep sends for signature.
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

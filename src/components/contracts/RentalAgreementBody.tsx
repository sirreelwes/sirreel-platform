/**
 * The rental agreement, rendered as text.
 *
 * LEGAL-SENSITIVE: render-only. Every word comes from contractClauses.ts, in
 * the same order ContractDocument prints (RENTAL_POLICIES → the numbered
 * CANONICAL_CLAUSES → FLEET_AGREEMENT → LCDW_ADDENDUM). Nothing here rewords,
 * reorders, abridges or summarises a clause. Change the agreement in
 * contractClauses.ts and every surface follows.
 *
 * Extracted from /rental-agreement (2026-08-25) so the client's SIGNING page
 * can show the same text. It previously embedded the generated PDF in an
 * iframe, which on a phone renders one clipped page with no scroll — Wes sent
 * a screenshot of the sign form sitting under an agreement the client could
 * not actually read. A PDF viewer is not a reading surface on mobile; flowing
 * text is.
 *
 * The public page and the portal share this component precisely so the
 * document a client reviews and the document they sign cannot drift apart.
 */

import {
  CANONICAL_CLAUSES,
  RENTAL_POLICIES,
  FLEET_AGREEMENT,
  LCDW_ADDENDUM,
} from '@/lib/contracts/contractClauses'

// Mirrors ContractDocument's Terms & Conditions lede verbatim (presentation
// copy printed on the PDF, kept in lockstep by eye — clause text itself is
// imported, never re-typed).
export const TERMS_LEDE =
  'Please read carefully. You are liable for our equipment and vehicles from the time they leave our premises until the time they are returned to us and we sign for them.'

/** Section anchors, for a table of contents beside the body. */
export function agreementToc(): Array<{ id: string; label: string }> {
  return [
    { id: 'policies', label: 'Rental Policies' },
    { id: 'terms', label: 'Terms & Conditions' },
    ...CANONICAL_CLAUSES.map((c) => ({ id: `clause-${c.ref}`, label: `${c.ref}. ${c.title}` })),
    { id: 'fleet', label: FLEET_AGREEMENT.title },
    { id: 'lcdw', label: LCDW_ADDENDUM.title },
  ]
}

export function RentalAgreementBody() {
  return (
    <>
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
    </>
  )
}

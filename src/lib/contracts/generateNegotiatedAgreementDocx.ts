/**
 * A client's negotiated agreement as a WORD file, composed from the clause
 * data — not converted from the PDF.
 *
 * Wes, 2026-09-18: "Marell will probably want to see the entire agreement
 * again. I'll need to send my finished one to him. Ideally, I can just send
 * it in HQ to him, and he can review it there with a button that allows him
 * to download a DOCX file."
 *
 * ── Why composed and not converted ────────────────────────────────────
 * The file Marell sent BACK on 2026-09-17 was a PDF→Word conversion of our
 * own generated PDF, and it arrived damaged in two ways worth never
 * repeating: ten words carried literal ASCII hyphens the converter inserted
 * at line breaks (compen-sation, inde-pendent, cover-age, compre-hensive,
 * insur-ance, re-duced, Agree-ment, con-strued, arbitra-tion,
 * circum-stances) while "non-payment" in their §21 is a REAL hyphen that
 * must survive; and every piece of front matter was lost — no Lessee block,
 * no lede, no version line, the company name surviving only in a running
 * header.
 *
 * Composing from `NegotiatedAgreement` cannot do either. The text is the
 * same TypeScript the PDF renders, so a hyphen appears only where the
 * contract has one, and the front matter is there because this file writes
 * it.
 *
 * ── Why hand-written OOXML and not a library ──────────────────────────
 * `docxtemplater` (already a dependency) FILLS a template; it does not
 * compose. A template would mean a binary .docx in the repo carrying clause
 * text that has to stay in lockstep with contractClauses.ts — the exact
 * drift the digest test exists to prevent. A .docx is a zip of XML and
 * `pizzip` is already here, so the document is built from the same data
 * every other rendering reads. No new dependency, nothing binary to
 * maintain.
 *
 * Styling is deliberately plain: bold headings, justified body, page break
 * before the appendix. Counsel wants text they can turn track-changes on
 * over, not typography.
 */

import PizZip from 'pizzip'
import { APPENDED_SECTIONS, type NegotiatedAgreement } from './negotiatedAgreement'

/** XML-escape. `&` first or it double-escapes the entities it just wrote. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

type ParaOpts = {
  bold?: boolean
  size?: number // half-points, per OOXML
  align?: 'left' | 'center' | 'both'
  spaceAfter?: number // twentieths of a point
  pageBreakBefore?: boolean
  caps?: boolean
}

function para(text: string, o: ParaOpts = {}): string {
  const rPr =
    [o.bold ? '<w:b/>' : '', o.caps ? '<w:caps/>' : '', o.size ? `<w:sz w:val="${o.size}"/>` : '']
      .filter(Boolean)
      .join('') || ''
  const pPr = [
    o.pageBreakBefore ? '<w:pageBreakBefore/>' : '',
    o.align ? `<w:jc w:val="${o.align}"/>` : '',
    `<w:spacing w:after="${o.spaceAfter ?? 120}"/>`,
  ]
    .filter(Boolean)
    .join('')
  return (
    `<w:p><w:pPr>${pPr}</w:pPr>` +
    `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>` +
    `</w:p>`
  )
}

/** A numbered clause: "12. Title" bold, then the body. Never auto-numbered —
 *  the client's own numbering carries a deliberate GAP at 15 (their counsel
 *  deleted Subrogation), and Word would silently renumber it away. */
function clause(ref: string, title: string, body: string): string {
  return para(`${ref}. ${title}`, { bold: true, spaceAfter: 40 }) + para(body, { align: 'both' })
}

export interface NegotiatedDocxProps {
  agreement: NegotiatedAgreement
  /** The company this copy is for — printed in the front matter. */
  companyName: string
  generatedAt?: Date
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export function negotiatedDocxFilename(
  agreement: Pick<NegotiatedAgreement, 'title'>,
  companyName: string,
): string {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9 ._-]+/g, '').trim().replace(/\s+/g, '-')
  return `${safe(agreement.title)}-${safe(companyName)}.docx`
}

export { DOCX_MIME as NEGOTIATED_DOCX_MIME }

/** The document body, as WordprocessingML. Exported for the test, which
 *  asserts against the XML rather than unzipping a buffer. */
export function negotiatedDocumentXml({ agreement, companyName, generatedAt }: NegotiatedDocxProps): string {
  const when = (generatedAt ?? new Date()).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'America/Los_Angeles',
  })
  const { FLEET_AGREEMENT, LCDW_ADDENDUM } = APPENDED_SECTIONS

  const parts: string[] = []

  // ── Front matter: the half the converted file lost ──────────────────
  parts.push(para('SirReel Studio Services', { bold: true, size: 28, align: 'center', spaceAfter: 40 }))
  parts.push(
    para('SirReel Production Vehicles, Inc. dba SirReel Studio Services · 8500 Lankershim Blvd, Sun Valley, CA 91352 · (818) 515-2389 · info@sirreel.com', {
      size: 16,
      align: 'center',
      spaceAfter: 240,
    }),
  )
  parts.push(para(agreement.title, { bold: true, size: 26, align: 'center', caps: true, spaceAfter: 40 }))
  parts.push(para(agreement.version, { size: 16, align: 'center', spaceAfter: 240 }))
  parts.push(para(`Lessee: ${companyName}`, { bold: true, spaceAfter: 40 }))
  parts.push(para('Lessor: SirReel Production Vehicles, Inc. dba SirReel Studio Services', { spaceAfter: 40 }))
  parts.push(para(`Prepared: ${when}`, { size: 18, spaceAfter: 240 }))

  // ── Their terms, verbatim, in their numbering ──────────────────────
  parts.push(para('Terms and Conditions', { bold: true, size: 24, caps: true, spaceAfter: 80 }))
  parts.push(para(agreement.lede, { align: 'both', spaceAfter: 200 }))
  for (const c of agreement.clauses) parts.push(clause(c.ref, c.title, c.body))

  // ── What SirReel added, under a heading that SAYS so ───────────────
  // The PDF carries this distinction and so must the Word file: a reader
  // must be able to tell their counsel's text from ours without a diff.
  parts.push(
    para('Additional Terms', {
      bold: true,
      size: 24,
      caps: true,
      pageBreakBefore: true,
      spaceAfter: 40,
    }),
  )
  parts.push(
    para('The following sections are added by SirReel. They were not part of the document marked up by Lessee’s counsel, which carries no equivalent.', {
      size: 18,
      align: 'both',
      spaceAfter: 200,
    }),
  )
  for (const c of agreement.appendedClauses) parts.push(clause(c.ref, c.title, c.body))

  parts.push(para(FLEET_AGREEMENT.title, { bold: true, size: 22, spaceAfter: 40 }))
  parts.push(para(FLEET_AGREEMENT.intro, { align: 'both' }))
  parts.push(para(FLEET_AGREEMENT.fuelPolicy, { align: 'both', spaceAfter: 200 }))

  parts.push(para(LCDW_ADDENDUM.title, { bold: true, size: 22, spaceAfter: 40 }))
  parts.push(para(LCDW_ADDENDUM.rate, { bold: true }))
  for (const line of [LCDW_ADDENDUM.coverage, LCDW_ADDENDUM.exclusions, LCDW_ADDENDUM.scope, LCDW_ADDENDUM.note]) {
    parts.push(para(line, { align: 'both' }))
  }

  // ── Signature block, unsigned: this copy is for REVIEW ─────────────
  parts.push(para('Agreement & Signature', { bold: true, size: 24, caps: true, spaceAfter: 40 }))
  parts.push(
    para('I have read, understood, and agree to the terms and conditions above. I am an Authorized Representative of the Lessee and I understand and accept the terms and conditions in this contract.', {
      align: 'both',
      spaceAfter: 240,
    }),
  )
  parts.push(para('Signature of Authorized Representative: ______________________________    Date: ____________', { spaceAfter: 120 }))
  parts.push(para('Printed Name: ______________________________    Title: ____________________', { spaceAfter: 120 }))
  parts.push(para('SirReel Representative: ______________________________    Date: ____________', { spaceAfter: 0 }))

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>${parts.join('')}` +
    // Letter portrait, 1" margins. Without a sectPr Word applies its own.
    `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>` +
    `<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>` +
    `</w:sectPr></w:body></w:document>`
  )
}

/** The .docx, as a buffer. */
export function generateNegotiatedAgreementDocx(props: NegotiatedDocxProps): Buffer {
  const zip = new PizZip()
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/word/document.xml" ContentType="${DOCX_MIME}.main+xml"/>` +
      `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
      `</Types>`,
  )
  zip.folder('_rels')!.file(
    '.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
      `</Relationships>`,
  )
  const word = zip.folder('word')!
  word.file('document.xml', negotiatedDocumentXml(props))
  // One default style so the body is a serif at 11pt rather than Word's
  // Calibri — this has to read as the same document as the PDF.
  word.file(
    'styles.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:docDefaults><w:rPrDefault><w:rPr>` +
      `<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>` +
      `<w:sz w:val="22"/><w:szCs w:val="22"/>` +
      `</w:rPr></w:rPrDefault></w:docDefaults></w:styles>`,
  )
  word.folder('_rels')!.file(
    'document.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      `</Relationships>`,
  )
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer
}

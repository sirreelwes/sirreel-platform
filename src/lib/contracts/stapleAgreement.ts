/**
 * Staple a company's master agreement and a job's addendum into one PDF.
 *
 * Wes, 2026-09-02: "staple them into one PDF per job." The job file otherwise
 * holds two documents, and "send me the agreement for this job" is a question
 * with one answer — a client's accounting department should not be handed two
 * attachments and told which halves to read together.
 *
 * ── What this is and is not ────────────────────────────────────────
 *
 * DERIVED. The master is the contract, the addendum is the amendment, and
 * both keep their own stored copies. This is the two of them printed
 * together, regenerated from scratch on every election change. Nothing reads
 * it to decide anything — it exists to be handed to a person.
 *
 * So it is also allowed to FAIL. A master that pdf-lib cannot parse (a scan
 * wrapped oddly, an encrypted export, a file that is a PDF only by
 * extension) must not take the addendum down with it: the caller keeps the
 * addendum and leaves the combined columns null. Losing the convenience copy
 * costs a second attachment; losing the addendum costs the record of what the
 * client elected.
 *
 * Order is master-then-addendum, always. The addendum amends a document the
 * reader has to have read first, and a signature page appearing before the
 * terms it signs reads as a different document.
 */
import { PDFDocument } from 'pdf-lib'

export interface StapleResult {
  bytes: Buffer
  pageCount: number
}

/**
 * Merge `masterBytes` (the executed master) with `addendumBytes` (this job's
 * addendum page). Throws on unusable input — callers wrap best-effort.
 */
export async function stapleAgreementPdfs(
  masterBytes: Buffer | Uint8Array,
  addendumBytes: Buffer | Uint8Array,
): Promise<StapleResult> {
  const out = await PDFDocument.create()

  for (const src of [masterBytes, addendumBytes]) {
    // `ignoreEncryption` covers the common case of a PDF exported with an
    // owner password and no user password — readable by every viewer, but
    // refused by a strict parser. A file we can already open in Preview
    // should not fail to staple.
    const doc = await PDFDocument.load(src, { ignoreEncryption: true })
    const pages = await out.copyPages(doc, doc.getPageIndices())
    pages.forEach((pg) => out.addPage(pg))
  }

  out.setProducer('SirReel HQ')
  out.setCreator('SirReel HQ')
  // A fixed timestamp would make every re-staple look unchanged to a viewer
  // caching by date; the real one is the moment this copy was assembled.
  const now = new Date()
  out.setCreationDate(now)
  out.setModificationDate(now)

  const bytes = Buffer.from(await out.save())
  return { bytes, pageCount: out.getPageCount() }
}


import { PDFCheckBox, PDFDocument, PDFDropdown, PDFOptionList, PDFRadioGroup, PDFTextField } from 'pdf-lib'

/**
 * Read the filled-in values out of a fillable (AcroForm) PDF.
 *
 * WHY THIS EXISTS — High Horses, 2026-09-18. A broker reissued their
 * certificate as an ACORD *form* PDF: the page content stream is the BLANK
 * ACORD 25 template, and every value the broker typed — the limits, the ADDL
 * INSD and SUBR WVD checkmarks, the Hired/Non-Owned Auto boxes, the whole
 * Description of Operations paragraph — lives in form-field annotations
 * layered over it.
 *
 * A vision model reading that file sees a page image in which the checkbox
 * marks are a few pixels and the Description of Operations box is ~6pt type.
 * It read the big fields fine (carrier, named insured, policy dates, limits)
 * and missed the small ones, so it reported Additional Insured, Loss Payee,
 * Hired Auto Physical Damage, Non-Owned Autos, Primary & Non-Contributory and
 * Waiver of Subrogation as ABSENT — on a certificate that carries all six, in
 * writing. Worse, that was the broker's CORRECTED cert: the flat-text version
 * it replaced genuinely lacked P&NC and the waiver, and scored better.
 *
 * Four of the 148 certificates on file are this kind of PDF, and all four
 * graded "high risk" against a 29% base rate.
 *
 * So the field values are pulled out deterministically here and handed to the
 * model as text. This is not ACORD-specific — it is whatever the form holds.
 */

/** One filled field, in document order. */
export interface PdfFormFieldValue {
  name: string
  value: string
}

/** Drop the issuer's field-name scaffolding: "Master.COI_FOO(Numeric #,##0)". */
function cleanFieldName(raw: string): string {
  return raw
    .replace(/^.*\./, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim()
}

/**
 * Every field the form actually carries a value for. Empty text fields and
 * unchecked boxes are OMITTED — their absence is itself evidence, and 98
 * mostly-blank field names would bury the 65 that matter.
 *
 * Best-effort: a PDF with no AcroForm, an encrypted one, or one pdf-lib
 * cannot parse returns [] rather than throwing. The review must still run.
 */
export async function extractPdfFormFields(buffer: Buffer): Promise<PdfFormFieldValue[]> {
  let doc: PDFDocument
  try {
    doc = await PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false })
  } catch {
    return []
  }

  let fields: ReturnType<ReturnType<typeof doc.getForm>['getFields']>
  try {
    fields = doc.getForm().getFields()
  } catch {
    return []
  }

  const out: PdfFormFieldValue[] = []
  for (const field of fields) {
    let value = ''
    try {
      if (field instanceof PDFTextField) {
        value = (field.getText() || '').trim()
      } else if (field instanceof PDFCheckBox) {
        value = field.isChecked() ? 'CHECKED' : ''
      } else if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
        value = (field.getSelected() || []).join(', ').trim()
      } else if (field instanceof PDFRadioGroup) {
        value = (field.getSelected() || '').trim()
      }
    } catch {
      continue
    }
    if (!value) continue
    const name = cleanFieldName(field.getName())
    if (!name) continue
    out.push({ name, value: value.replace(/\r/g, '').replace(/\n+/g, ' · ') })
  }
  return out
}

/**
 * The extracted fields as a block to sit alongside the document in the review
 * call, or null when there is nothing to add.
 *
 * The framing is deliberately two-sided. It tells the model to trust this list
 * over what it can see — but it also says that what is NOT listed is not
 * present, so a genuinely missing endorsement still fails. Curing false
 * "missing" verdicts by teaching the model to assume coverage would be a far
 * worse bug than the one it fixes.
 */
export function formatPdfFormFieldsForReview(fields: PdfFormFieldValue[]): string | null {
  if (fields.length < 5) return null
  const lines = fields.map((f) => `${f.name}: ${f.value}`).join('\n')
  return `MACHINE-READ FORM FIELD VALUES (${fields.length} fields)

The attached PDF is a FILLABLE FORM. Its printed page is a blank template and
every value on the certificate is carried in form fields layered over it. The
list below was read directly out of those fields by the software, character for
character. It is exactly what a person sees on the printed certificate.

The page image you are shown renders these same values, but at a size where
checkbox marks (ADDL INSD, SUBR WVD, the Hired / Non-Owned Auto boxes) and the
small print in the Description of Operations box are easy to misread or miss
entirely. Where this list and the image disagree, THIS LIST IS CORRECT.

Only fields that carry a value are listed. An empty text field or an UNCHECKED
box is omitted, so a requirement that appears nowhere in this list and nowhere
in the image is genuinely absent and must still FAIL. Do not treat this list as
a reason to assume any coverage is present.

${lines}`
}

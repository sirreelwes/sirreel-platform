/**
 * Fillable-PDF field extraction — the High Horses misread.
 *
 *   npx tsx tests/coi/pdf-form-fields.test.ts
 *   npm run test:coi-form-fields
 *
 * Pure + offline: the fixture PDF is built with pdf-lib in-process, so there
 * is no blob fetch, no AI call and no env.
 *
 * WHY: on 2026-09-18 a broker reissued High Horses' certificate as an ACORD
 * *form* PDF — blank printed template, every value in form-field annotations.
 * The vision review read the big fields and missed the checkmarks and the 6pt
 * Description of Operations box, then reported Additional Insured, Loss Payee,
 * Hired Auto Physical Damage, Non-Owned Autos, Primary & Non-Contributory and
 * Waiver of Subrogation as MISSING from a certificate that carries all six.
 *
 * The two directions that matter:
 *  - a filled field or checked box MUST come out, or the misread returns;
 *  - an empty field or unchecked box must NOT come out, and the block must say
 *    so — otherwise the fix trades false alarms for false all-clears, which on
 *    a COI is the far worse failure.
 */

import { PDFDocument } from 'pdf-lib'
import { extractPdfFormFields, formatPdfFormFieldsForReview } from '../../src/lib/coi/pdfFormFields'
import { normalizeCoiReview } from '../../src/lib/coi/reviewCoi'
import { pacificYmd } from '../../src/lib/dates/pacificDay'

const failures: string[] = []

function ok(cond: boolean, why: string): void {
  if (cond) console.log(`  ok — ${why}`)
  else {
    console.log(`  FAIL — ${why}`)
    failures.push(why)
  }
}

/** The shape of the real certificate, field names and all. */
const DESCRIPTION =
  'SirReel Production Vehicles, Inc., is included as an Additional Insured and Loss Payee ' +
  'as their interest may appear. With respect to Automobile Rentals, Non-Owned & Hired Auto ' +
  'Physical Damage, limit $1,000,000 any one accident. coverage is primary and ' +
  'non-contributory as respects SirReel. Waiver of Subrogation in favor of SirReel.'

async function acordishFixture(): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([612, 792])
  const form = doc.getForm()

  const text = (name: string, value: string, y: number) => {
    const f = form.createTextField(name)
    f.setText(value)
    f.addToPage(page, { x: 20, y, width: 560, height: 12 })
  }
  const box = (name: string, checked: boolean, y: number) => {
    const f = form.createCheckBox(name)
    if (checked) f.check()
    f.addToPage(page, { x: 20, y, width: 10, height: 10 })
  }

  text('Master.COI_INSUREDADDRESS', 'High Horses\n5301 Southwest Parkway, Suite 400\nAustin, TX 78735', 740)
  text('Master.COI_CERTIFICATEHOLDER', 'SirReel Production Vehicles, Inc.,\n8500 Lankershim Blvd\nSun Valley, CA 91352', 720)
  text('Master.COI_EACHOCCURRENCEGL(Numeric #,##0)', '1,000,000', 700)
  text('Master.COI_GENERALAGGREGATE(Numeric #,##0)', '2,000,000', 680)
  text('Master.COI_FULLDESCRIPTION', DESCRIPTION, 660)
  box('Master.COI_ADDLINSRGENERALLIABILITY', true, 640)
  box('Master.COI_SUBRWVDGENERALLIABILITY', true, 620)
  box('Master.COI_CONGA_HA', true, 600)
  box('Master.COI_CONGA_NOA', true, 580)
  // The two that are genuinely NOT on this certificate.
  box('Master.COI_CONGA_ANYAUTO', false, 560)
  text('Master.COI_POLICYNUMBERWORKERSCOMP', '', 540)

  return Buffer.from(await doc.save())
}

async function main(): Promise<void> {
  console.log('\nFillable ACORD certificate')
  const pdf = await acordishFixture()
  const fields = await extractPdfFormFields(pdf)
  const byName = new Map(fields.map((f) => [f.name, f.value]))

  ok(byName.get('COI_ADDLINSRGENERALLIABILITY') === 'CHECKED', 'ADDL INSD checkmark is read, not eyeballed')
  ok(byName.get('COI_SUBRWVDGENERALLIABILITY') === 'CHECKED', 'SUBR WVD checkmark is read')
  ok(byName.get('COI_CONGA_HA') === 'CHECKED' && byName.get('COI_CONGA_NOA') === 'CHECKED', 'Hired AND Non-Owned Auto boxes both read')
  ok(byName.get('COI_EACHOCCURRENCEGL') === '1,000,000', 'issuer format scaffolding stripped from the field name')

  const desc = byName.get('COI_FULLDESCRIPTION') || ''
  ok(desc.includes('Loss Payee'), 'Description of Operations carries Loss Payee')
  ok(desc.includes('Hired Auto Physical Damage'), 'Description of Operations carries HAPD')
  ok(desc.includes('primary and non-contributory'), 'Description of Operations carries P&NC')
  ok(desc.includes('Waiver of Subrogation'), 'Description of Operations carries the waiver')

  ok(!byName.has('COI_CONGA_ANYAUTO'), 'an UNCHECKED box is omitted — absence stays evidence')
  ok(!byName.has('COI_POLICYNUMBERWORKERSCOMP'), 'an EMPTY text field is omitted')

  ok((byName.get('COI_INSUREDADDRESS') || '').includes('High Horses'), 'multi-line insured survives flattening')

  console.log('\nThe block handed to the model')
  const block = formatPdfFormFieldsForReview(fields)
  ok(block !== null, 'a filled form produces a block')
  ok(!!block && block.includes(DESCRIPTION.slice(0, 40)), 'the description text reaches the model verbatim')
  ok(!!block && /THIS LIST IS CORRECT/.test(block), 'the block tells the model to prefer it over the page image')
  ok(
    !!block && /must still FAIL/.test(block),
    'the block still fails a genuinely absent requirement — no blanket all-clear',
  )

  console.log('\nNot a form at all')
  const plain = await PDFDocument.create()
  plain.addPage([612, 792])
  const plainFields = await extractPdfFormFields(Buffer.from(await plain.save()))
  ok(plainFields.length === 0, 'a flat PDF yields no fields')
  ok(formatPdfFormFieldsForReview(plainFields) === null, 'and no block — flat certs review exactly as before')

  const junk = await extractPdfFormFields(Buffer.from('not a pdf at all', 'utf8'))
  ok(junk.length === 0, 'an unparseable file returns [] rather than throwing — the review must still run')

  console.log('\nExpiry is arithmetic, not a model opinion')
  // Pop Up Mob, 2026-09-18: GL and Auto ran 06/15/2025-06/15/2026 and the WC
  // row ran to 02/06/2027. The model quoted both correctly and still returned
  // pass:true three months after the liability cover lapsed.
  // certificateHolder is re-judged by evaluateHolderMatch, so it needs a real
  // SirReel holder or the fixture fails for the wrong reason.
  const allPass = () => ({
    certificateHolder: {
      pass: true,
      found: 'SirReel Production Vehicles, Inc.\n8500 Lankershim Blvd\nSun Valley, CA 91352',
    },
    ...Object.fromEntries(
      ['generalLiability','autoLiability','autoPhysicalDamage','additionalInsured','lossPayee','coverageDates']
        .map((k) => [k, { pass: true, found: 'x' }]),
    ),
  })

  const lapsed = normalizeCoiReview({
    ...allPass(),
    policyExpiry: { pass: true, date: pacificYmd(-1), expired: false },
    criticalIssues: [],
  } as never)
  ok((lapsed.policyExpiry as { pass?: boolean }).pass === false, 'a date in the past FAILS even when the model said pass')
  ok((lapsed.policyExpiry as { expired?: boolean }).expired === true, 'and is marked expired')
  ok(lapsed.criticalPass === false, 'criticalPass goes false, so the desk cannot read it as green')
  ok((lapsed.criticalIssues || []).some((i) => /policyExpiry/.test(i)), 'criticalIssues names it — the list must agree with the booleans')
  ok(lapsed.riskLevel === 'high', 'and it grades high risk')

  const current = normalizeCoiReview({
    ...allPass(),
    policyExpiry: { pass: true, date: pacificYmd(30), expired: false },
    primaryNonContributory: { pass: true }, waiverOfSubrogation: { pass: true }, umbrella: { pass: true },
    entertainmentPackage: { pass: true }, workersComp: { pass: true }, cancellationNotice: { pass: true },
    contractorCoverage: { pass: true },
    criticalIssues: [],
  } as never)
  ok((current.policyExpiry as { pass?: boolean }).pass === true, 'a live policy is left alone')
  ok(current.criticalPass === true, 'and still passes')

  const today = normalizeCoiReview({
    ...allPass(),
    policyExpiry: { pass: true, date: pacificYmd(0), expired: false },
    criticalIssues: [],
  } as never)
  ok((today.policyExpiry as { pass?: boolean }).pass === true, 'a policy expiring TODAY is still in force — no off-by-one')

  console.log('\nThe earliest REQUIRED row decides, not the longest-running one')
  // The exact Pop Up Mob shape: GL and Auto lapsed 06/15/2026, Workers Comp
  // runs to 02/06/2027, and the model reported the WC date as the summary.
  const mixed = normalizeCoiReview({
    ...allPass(),
    policyExpiryDate: '2027-02-06',
    generalLiabilityExpiry: '2026-06-15',
    autoLiabilityExpiry: '2026-06-15',
    policyExpiry: { pass: true, date: '2027-02-06', expired: false },
    criticalIssues: [],
  } as never)
  ok(mixed.policyExpiryDate === '2026-06-15', 'the GL/Auto row date wins over the model summary date')
  ok((mixed.policyExpiry as { pass?: boolean }).pass === false, 'and the lapsed liability cover fails the check')

  const autoLapsedOnly = normalizeCoiReview({
    ...allPass(),
    generalLiabilityExpiry: pacificYmd(200),
    autoLiabilityExpiry: pacificYmd(-5),
    criticalIssues: [],
  } as never)
  ok(autoLapsedOnly.policyExpiryDate === pacificYmd(-5), 'the EARLIER of the two required rows is the effective expiry')
  ok((autoLapsedOnly.policyExpiry as { pass?: boolean }).pass === false, 'a live GL row does not rescue a lapsed auto row')

  const noRows = normalizeCoiReview({
    ...allPass(),
    policyExpiryDate: pacificYmd(60),
    policyExpiry: { pass: true, date: pacificYmd(60), expired: false },
    primaryNonContributory: { pass: true }, waiverOfSubrogation: { pass: true }, umbrella: { pass: true },
    entertainmentPackage: { pass: true }, workersComp: { pass: true }, cancellationNotice: { pass: true },
    contractorCoverage: { pass: true },
    criticalIssues: [],
  } as never)
  ok(noRows.policyExpiryDate === pacificYmd(60), 'with no row dates it falls back to the summary date')
  ok(noRows.criticalPass === true, 'and a current certificate still passes')

  if (failures.length) {
    console.error(`\n${failures.length} failure(s)`)
    process.exit(1)
  }
  console.log('\nAll checks passed.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

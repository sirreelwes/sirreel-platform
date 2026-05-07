# Contract Review — Phase 4a.5 Build Brief
## Swap Puppeteer Counter-PDF Generator for @react-pdf/renderer

**Status:** Spec ready. Ship before Phase 4b.
**Owner:** Wes
**Estimated effort:** ~4-6 hours of focused Claude Code work
**Prerequisites:** Phases 1-4a shipped (per-clause decisions work, decisions API works, counter-PDF generation endpoint exists but failing in production)
**Blocking:** Counter-PDF generation does not work in production. Frontend UI is in place and gated correctly. Per-clause decisions persist correctly. The only broken piece is the actual PDF rendering.

---

## Why this brief exists

Phase 4a built counter-PDF generation using Puppeteer + `@sparticuz/chromium` on Vercel. After three fix attempts the system still fails with `Failed to launch the browser process`. Puppeteer-on-Vercel-serverless is fundamentally fragile — it works for some configurations and not others, and even when working has 10-15 second cold starts. The decision is to abandon Puppeteer entirely and switch to `@react-pdf/renderer`, which is built specifically for Node serverless environments.

This is a focused replacement of one component (`generateCounterPdf.ts` and its template) — not a re-do of Phase 4a.

## What stays unchanged

- ✅ `ReviewChangeDecision` Prisma model
- ✅ `POST /api/tools/contract-review/[id]/decisions` endpoint
- ✅ Modified `GET /api/tools/contract-review/[id]` (hydrates `changeDecisions`)
- ✅ `POST /api/tools/contract-review/[id]/generate-counter-pdf` endpoint shell (just swap the rendering function it calls)
- ✅ `GET /api/tools/contract-review/[id]/counter-pdf` endpoint
- ✅ Per-clause decision UI on `ReviewResultPanel.tsx`
- ✅ Two-tab layout on detail page (Original / Counter Proposal)
- ✅ `CounterPdfPreview.tsx` component
- ✅ Vercel Blob storage of generated PDFs (`contracts/{YYYY}/{MM}/{uuid}-counter.pdf`)
- ✅ Replace semantics on regenerate
- ✅ Regression fixture concept (will need to update expected output)
- ✅ Decision logic that determines which clauses use accept vs counter vs reject text

## What gets replaced

- ❌ `puppeteer-core` and `@sparticuz/chromium` dependencies — REMOVE
- ❌ `src/lib/contracts/generateCounterPdf.ts` — REWRITE using `@react-pdf/renderer`
- ❌ `src/lib/contracts/contractTemplate.ts` (the HTML template) — REWRITE as React components
- ❌ `next.config.js` `serverComponentsExternalPackages` entry for chromium — REMOVE
- ❌ `vercel.json` per-function `maxDuration: 60` for generate-counter-pdf — keep but reduce to 15 (no longer need the long timeout)
- ❌ Any chromium externalization config

## Why @react-pdf/renderer

- **Built for serverless.** No browser process. No binary dependencies. No system libraries needed.
- **Fast.** Rendering takes ~200-500ms, not 10-15s. No cold start penalty.
- **Reliable.** Works on any Node version Vercel supports. Won't break on runtime updates.
- **React-component model.** Familiar paradigm; Claude Code can work with it directly. Components define layout and content; the renderer turns them into PDF bytes.
- **Active maintenance.** Maintained by Diego Muracciole and team; widely used in production for legal/financial documents.
- **No third-party services.** All rendering happens in your Vercel function. No PII leaves your infrastructure.

## What to install

```bash
npm install @react-pdf/renderer
npm uninstall puppeteer-core @sparticuz/chromium
```

## Key API of @react-pdf/renderer

```typescript
import { Document, Page, Text, View, StyleSheet, pdf } from '@react-pdf/renderer'

// Define the contract as React components
const styles = StyleSheet.create({
  page: { padding: 40, fontFamily: 'Helvetica', fontSize: 10 },
  header: { fontSize: 16, fontWeight: 'bold', marginBottom: 20 },
  section: { marginBottom: 12 },
  clauseNumber: { fontWeight: 'bold', marginRight: 4 },
})

const ContractDocument = ({ company, job, decisions, aiChanges }) => (
  <Document>
    <Page size="LETTER" style={styles.page}>
      <Text style={styles.header}>Rental Agreement</Text>
      {/* Company info, job info, clauses, all rendered here */}
    </Page>
  </Document>
)

// Server-side: render to buffer
const pdfBuffer = await pdf(<ContractDocument {...props} />).toBuffer()
```

That's it. No browser. No chromium. No launch options.

---

## Implementation chunks

### Chunk A — Remove Puppeteer (~30 min)

1. `npm uninstall puppeteer-core @sparticuz/chromium`
2. Remove the `serverComponentsExternalPackages` entry for chromium from `next.config.js`
3. Reduce `maxDuration` to 15 in `vercel.json` for the generate-counter-pdf route
4. Delete `src/lib/contracts/generateCounterPdf.ts` (will be replaced in Chunk C)
5. Delete `src/lib/contracts/contractTemplate.ts` (will be replaced in Chunk B)
6. Verify `npx tsc --noEmit` passes (should fail because route.ts still imports the deleted files — that's expected, will be fixed in Chunk C)

Don't commit yet. This chunk leaves the build broken intentionally.

### Chunk B — Build the React PDF template (~2-3 hours, the bulk of the work)

1. Install `@react-pdf/renderer`
2. Create `src/lib/contracts/ContractDocument.tsx` — the React component for the contract
3. Build the document component to match the structure of `public/contracts/sirreel-rental-agreement.pdf`:
   - Page 1: header, company info block, job info block, contact info block
   - Pages 2-7: 29 numbered clauses + Fleet Vehicle Rental Agreement section + LCDW addendum
   - Use the existing clause text from `src/lib/contracts/contractClauses.ts` (which Phase 4a built — keep it)
4. Layout requirements:
   - Letter size (8.5" x 11"), portrait orientation
   - Helvetica font (built into @react-pdf/renderer, no font registration needed)
   - 40pt margins
   - Clause numbering visible (1., 2., etc.)
   - Section headers for "Fleet Vehicle Rental Agreement" and "Limited Collision Damage Waiver"
5. Field substitution logic:
   - Company name, address, type, office email, phone — from `company` prop
   - Job name, type, rental dates, schedule, PO # — from `job` prop
   - Contact name, position, email, phone — from `job` prop's primary contact
6. Per-clause rendering logic:
   - For each AI-flagged change in `aiChanges`, look up the corresponding decision in `decisions`
   - If decision = ACCEPT → render the modified clause text from `aiChanges[i].proposed`
   - If decision = COUNTER → render the counter-language from `decisions[i].counterLanguage`
   - If decision = REJECT → render the original baseline clause text from `contractClauses.ts`
   - All other clauses (not flagged by AI) → render baseline text unchanged
7. NO signature block (per design decision in Phase 4a brief — counter-PDF is a negotiation document, not a contract-to-sign)

Test as you go: run a local script that imports the component and renders to a file:

```bash
# Inside the project
node --experimental-vm-modules -e "
import('@react-pdf/renderer').then(async ({pdf}) => {
  const { default: ContractDocument } = await import('./src/lib/contracts/ContractDocument.tsx')
  const buffer = await pdf(ContractDocument({ company: {...}, job: {...}, decisions: [], aiChanges: [] })).toBuffer()
  require('fs').writeFileSync('/tmp/test.pdf', buffer)
})
"
```

Iterate until the test PDF looks correct.

### Chunk C — Wire it back into the route (~30 min)

1. Create new `src/lib/contracts/generateCounterPdf.ts` that uses `@react-pdf/renderer`:

```typescript
import { pdf } from '@react-pdf/renderer'
import { ContractDocument } from './ContractDocument'

export async function generateCounterPdf(args: {
  review: ContractReview & {
    company: Company | null
    job: Job | null
    changeDecisions: ReviewChangeDecision[]
  }
}): Promise<Buffer> {
  const aiChanges = args.review.aiResponse.changes ?? []
  return await pdf(
    <ContractDocument
      company={args.review.company}
      job={args.review.job}
      decisions={args.review.changeDecisions}
      aiChanges={aiChanges}
    />
  ).toBuffer()
}
```

2. Verify `src/app/api/tools/contract-review/[id]/generate-counter-pdf/route.ts` still imports correctly (signature unchanged from Phase 4a)
3. `npx tsc --noEmit` should pass cleanly now
4. Commit: "Phase 4a.5: Replace Puppeteer with @react-pdf/renderer for counter-PDF generation"

### Chunk D — Update regression fixture (~30 min)

1. The existing fixture in `tests/contract-review/fixtures/fixture-known-redline.json` defines test inputs (review + decisions)
2. Run the new generator on the fixture inputs
3. Save the resulting PDF as the new expected output (the layout will differ from the Puppeteer version)
4. Update the test in `tests/contract-review/counter-pdf.test.ts` to compare against the new expected PDF (probably by hash or by extracting text and comparing)
5. Verify the test passes

### Chunk E — Production test (~15 min)

1. Push Chunk C commit to main
2. Wait for Vercel deploy
3. Test on the existing review with all decisions resolved
4. Verify the counter PDF generates within 2-3 seconds
5. Open the PDF and visually verify:
   - Header, company info, job info correct
   - Per-clause decisions reflected correctly (Accept = client's proposed, Counter = our counter-language, Reject = baseline)
   - No signature block
   - Layout is clean (no overlapping text, no weird spacing)

---

## Layout fidelity expectations

`@react-pdf/renderer` is not pixel-identical to HTML/CSS. The contract will look slightly different from the canonical PDF baseline. That's acceptable because:

- The legal substance is what matters, not the visual layout
- Clients receive a clean, professional PDF — they don't compare it visually to your standard agreement
- This is a negotiation document, not a contract-to-sign

Style choices to make it look polished:
- Use `Helvetica` family (built-in, no registration needed)
- 10-11pt body text
- 14-16pt headers
- 1.4 line height
- Consistent 40pt page margins
- Bold clause numbers, regular clause body text
- Subtle horizontal rules between sections

If the output later needs to look exactly like the canonical PDF, that's a future Phase 4a.6 (custom font registration, exact layout matching). Not in scope here.

---

## Open questions to resolve before starting

1. **Font:** Use built-in Helvetica, or register a custom font? Built-in is simpler. Custom requires font file management and can complicate serverless deployment. **Recommendation: Helvetica.**

2. **Logo/branding:** Does the counter-PDF need the SirReel logo at the top? If yes, embed an image. `@react-pdf/renderer` supports PNG/JPG via `<Image>` component. The logo image needs to be bundled into the deployment (place in `public/`). **Recommendation: yes, simple text "SirReel" header in bold for v1, image logo in v1.1.**

3. **Page numbers:** Footer with "Page X of Y"? **Recommendation: yes, easy to add with `render` callback in Page component.**

4. **What about the existing Phase 4a generated PDFs (if any)?** None exist in production because Puppeteer never succeeded. No data migration needed.

5. **Schedule field formatting:** The Job model probably has multiple schedule rows (date + type). How are they rendered? **Recommendation: simple two-column table with date on left, type on right.**

---

## Files this brief will create or modify

**New:**
- `src/lib/contracts/ContractDocument.tsx` — the React PDF component

**Modified:**
- `src/lib/contracts/generateCounterPdf.ts` — rewrite to use @react-pdf/renderer
- `tests/contract-review/counter-pdf.test.ts` — update to match new output format
- `tests/contract-review/__snapshots__/fixture-known-redline.html` — replace with PDF snapshot or text-extracted comparison
- `next.config.js` — remove chromium externalization
- `vercel.json` — reduce maxDuration from 60 to 15
- `package.json` — add @react-pdf/renderer, remove puppeteer-core and @sparticuz/chromium

**Deleted:**
- `src/lib/contracts/contractTemplate.ts` — replaced by ContractDocument.tsx

**Unchanged:**
- `prisma/schema.prisma` — no schema changes
- All API routes (signatures unchanged)
- All UI components (work the same)
- `src/lib/contracts/contractClauses.ts` — keep, contains baseline clause text reused by ContractDocument

---

## Done definition

Phase 4a.5 is complete when:

- [ ] @react-pdf/renderer is installed; puppeteer-core and @sparticuz/chromium are removed
- [ ] `ContractDocument.tsx` exists and renders the full contract
- [ ] `generateCounterPdf.ts` uses @react-pdf/renderer
- [ ] Counter-PDF generation works in production (test on a real review)
- [ ] Generation completes in under 3 seconds (no cold start penalty)
- [ ] Generated PDF correctly reflects per-clause decisions:
  - ACCEPT clauses show client's proposed text
  - COUNTER clauses show counter-language
  - REJECT clauses show original baseline text
  - Unchanged clauses show baseline text
- [ ] Company info (name, address, type, email, phone) renders correctly
- [ ] Job info (name, type, dates, schedule, PO #) renders correctly
- [ ] No signature block included
- [ ] Regression test passes against updated expected output
- [ ] Vercel function logs show no errors over 24 hours of usage

---

## Risk assessment

**Low risk:**
- @react-pdf/renderer is mature and widely used. The basic rendering will work.
- Existing API routes and UI need no changes — only the rendering function is swapped.
- Per-clause decision logic is unchanged.

**Medium risk:**
- Layout may need iteration to look polished. First pass will likely have spacing/typography issues that need refinement.
- 29-clause contract is long; pagination and section breaks need careful handling so clauses don't get split awkwardly across pages.

**Avoid:**
- Don't try to make it pixel-identical to the canonical PDF in this phase. That's later work.
- Don't add custom fonts in this phase. Use Helvetica.
- Don't add complex visual elements (shading, borders, complex tables). Keep it clean and readable.

---

## What success looks like

A user clicks "Generate Counter PDF" → spinner runs for 1-2 seconds → counter PDF appears in the Counter Proposal tab → opens cleanly inline → looks like a professional rental agreement reflecting the per-clause decisions made → can be downloaded and attached to an email to the client.

That's it. That's the bar.

---

## After Phase 4a.5

When this ships, Phase 4a is genuinely complete: per-clause decisions + reliable counter-PDF generation. Then Phase 4b (in-app email composition + send) can begin with confidence that the PDF generation foundation is solid.

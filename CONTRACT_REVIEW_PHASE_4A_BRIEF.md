# Contract Review — Phase 4a Build Brief
## Per-Change Decisions + Counter-PDF Generation

**Status:** Spec ready. Not yet built.
**Owner:** Wes
**Estimated effort:** ~1 week of focused Claude Code sessions
**Prerequisite:** Phases 1-3 of contract review shipped (✓ as of May 7 2026)
**Companion document:** `CONTRACT_REVIEW_PERSISTENCE_BRIEF.md` covers Phases 1-5 of the original persistence work; this brief is the follow-on negotiation feature.

---

## What this builds

Today, the contract review tool analyzes a client's redlined contract and lets the human mark the WHOLE review as Approve/Counter/Reject. That's not granular enough for actual negotiation. In a real back-and-forth, you accept some changes, modify others, and reject the rest — per clause.

This brief builds:

1. **Per-clause decisions** — for each change the AI flags, the human picks Accept / Counter / Reject and writes the counter-language if Counter.
2. **Counter-PDF generation** — once decisions are made, the system generates a clean, fresh rental agreement PDF reflecting the deal we're proposing back. Not a redline of their PDF — our own clean document with the accepted changes incorporated and the rejected ones reverted to original.
3. **Stored counter-PDF** — alongside the original in Blob, viewable on the review detail page, downloadable.

Output is then handed off to Phase 4b (email composition + send), which is a separate brief.

## Why "Option C" (clean updated PDF) instead of redlining their PDF

Decided in design discussion May 7 2026. Three options were considered:
- **A. Redline PDF** (track-changes-style markup of their PDF) — what lawyers expect, but programmatic PDF redlining is genuinely hard to do well.
- **B. Cover letter PDF** (no PDF markup, just a written response) — easier, but feels less professional to sophisticated clients.
- **C. Clean updated PDF** (a fresh contract incorporating accepted changes, reverting rejected ones) — clearest for the client because they see one final document; cuts through the redlining ceremony; forces the conversation to "is this acceptable" rather than "do you accept these markups."

Option C chosen. Output is *our document*, formatted *our way*.

## Goals

1. Every AI-flagged change in a contract review can be individually marked Accept / Counter / Reject by the human
2. Counter decisions support free-form counter-language per clause
3. System generates a clean updated rental agreement PDF based on the accepted changes
4. Generated PDFs are stored in Blob alongside the original, viewable in-app
5. Negotiation history is preserved on the ContractReview record (decisions, counter-language, generated PDFs)

## Non-goals (deferred)

- ❌ Standing positions library / counter-language library (Phase 5a)
- ❌ Multi-round negotiation tracking (`ContractNegotiation` model) (Phase 5b)
- ❌ Email composition + send (Phase 4b)
- ❌ Real-time collaboration on per-change decisions (one user at a time is fine)
- ❌ Audit log of decision changes (just store latest)
- ❌ Conditional logic on counter-language (e.g., "if rejecting clause X, also auto-reject clause Y")

These are valid future features. Each warrants its own brief.

---

## Schema changes

Add to `prisma/schema.prisma`:

```prisma
enum ChangeDecision {
  PENDING
  ACCEPT
  COUNTER
  REJECT
}

model ReviewChangeDecision {
  id              String          @id @default(uuid())
  reviewId        String          @map("review_id")
  review          ContractReview  @relation(fields: [reviewId], references: [id], onDelete: Cascade)

  // Identity of the change — must match what the AI flagged
  clauseRef       String          @map("clause_ref")        // e.g., "1", "14", "Fleet 5(b)"
  changeType      String          @map("change_type")       // "auto_approved" | "needs_review" | "not_acceptable" — denormalized from AI for display
  changeIndex     Int             @map("change_index")      // position in aiResponse.changes[] for stable referencing

  // Human decision
  decision        ChangeDecision  @default(PENDING)
  counterLanguage String?         @map("counter_language") @db.Text  // required when decision = COUNTER
  note            String?         @db.Text                            // optional rationale

  decidedById     String?         @map("decided_by_id")
  decidedBy       User?           @relation("ChangeDecisionDecider", fields: [decidedById], references: [id])
  decidedAt       DateTime?       @map("decided_at")

  createdAt       DateTime        @default(now()) @map("created_at")
  updatedAt       DateTime        @updatedAt @map("updated_at")

  @@unique([reviewId, clauseRef], name: "review_clause_unique")
  @@index([reviewId])
  @@index([decision])
  @@map("sr_review_change_decisions")
}
```

Add reverse relations:

```prisma
model ContractReview {
  // ... existing fields ...
  changeDecisions  ReviewChangeDecision[]

  // New fields for counter-PDF tracking:
  counterPdfKey    String?  @map("counter_pdf_key")     // Blob key of generated counter-PDF
  counterPdfUrl    String?  @map("counter_pdf_url")     // Blob URL (private, served via auth-gated endpoint)
  counterGeneratedAt DateTime? @map("counter_generated_at")
  counterGeneratedById String? @map("counter_generated_by_id")
  counterGeneratedBy User?  @relation("CounterPdfGenerator", fields: [counterGeneratedById], references: [id])
}

model User {
  // ... existing fields ...
  changeDecisionsDecided  ReviewChangeDecision[] @relation("ChangeDecisionDecider")
  counterPdfsGenerated    ContractReview[]       @relation("CounterPdfGenerator")
}
```

Use `prisma db push` (never `migrate dev`). Verify additive-only with `prisma migrate diff` before pushing.

---

## API routes

### New: `POST /api/tools/contract-review/[id]/decisions`

Bulk upsert per-change decisions for a review.

**Request body:**
```json
{
  "decisions": [
    { "clauseRef": "1", "changeType": "not_acceptable", "changeIndex": 0, "decision": "REJECT", "note": "Mutual indemnity not acceptable" },
    { "clauseRef": "14", "changeType": "not_acceptable", "changeIndex": 1, "decision": "REJECT" },
    { "clauseRef": "19", "changeType": "auto_approved", "changeIndex": 2, "decision": "ACCEPT" },
    { "clauseRef": "6", "changeType": "needs_review", "changeIndex": 3, "decision": "COUNTER", "counterLanguage": "Substitution of comparable equipment within 4 hours of pickup, with cancellation as fallback if substitution is not possible." }
  ]
}
```

**Behavior:**
- Auth-gated (existing pattern: `getServerSession()` + email→user lookup)
- For each decision, upsert by unique `(reviewId, clauseRef)`
- Set `decidedById` and `decidedAt` on each upsert
- Validate: if `decision = COUNTER`, `counterLanguage` must be non-empty
- Validate: review must not be soft-deleted
- Return `{ ok: true, decisions: [...] }` with all current decisions for the review

### New: `POST /api/tools/contract-review/[id]/generate-counter-pdf`

Generate the counter-PDF based on current decisions.

**Behavior:**
- Auth-gated
- Load review + all `ReviewChangeDecision` records for this review
- Validate: every change in `aiResponse.changes` has a corresponding decision (no PENDING)
- Render the counter-PDF (see "PDF generation" below)
- Upload to Blob at `contracts/{YYYY}/{MM}/{uuid}-counter.pdf` with private access
- Update `ContractReview` record: `counterPdfKey`, `counterPdfUrl`, `counterGeneratedAt`, `counterGeneratedById`
- Return `{ ok: true, counterPdfId: review.id }` (file accessed via separate endpoint)

**Error if any change is still PENDING:**
```json
{ "error": "Cannot generate counter-PDF: 2 changes still pending decision (clauses 1, 14)" }
```

### New: `GET /api/tools/contract-review/[id]/counter-pdf`

Serve the generated counter-PDF (mirror of existing `/file` endpoint).

**Behavior:**
- Auth-gated
- 404 if `counterPdfKey` is null
- Stream the PDF from Blob with `Content-Type: application/pdf`, `Content-Disposition: inline`

### Modified: `GET /api/tools/contract-review/[id]`

Hydrate the response with `changeDecisions` and counter-PDF fields:

```json
{
  "id": "...",
  "aiResponse": { ... },
  "changeDecisions": [
    { "clauseRef": "1", "decision": "REJECT", ... },
    ...
  ],
  "counterPdfKey": "contracts/2026/05/abc-counter.pdf",
  "counterGeneratedAt": "2026-05-08T14:23:00Z",
  ...
}
```

---

## PDF generation — the hard part

This is the most novel piece of Phase 4a. Two approaches considered:

### Approach 1: HTML template → PDF via Puppeteer

Build the rental agreement as an HTML template (Tailwind-styled to match the SirReel brand). Use Puppeteer (or `@react-pdf/renderer`) to render it as a PDF.

Pros:
- Familiar tech stack (HTML/CSS)
- Easy to iterate on layout
- Looks professional

Cons:
- Puppeteer is heavy on Vercel serverless (large dependency, cold-start slow)
- Maintaining a separate HTML template that must match the legal substance of the canonical baseline PDF
- If the canonical PDF changes, the HTML template must change too — risk of drift

### Approach 2: PDF-lib programmatic editing of the canonical baseline

Take the existing `public/contracts/sirreel-rental-agreement.pdf`, use `pdf-lib` to programmatically:
- Fill in deal-specific fields (Company name, Job name, dates) in the form-fillable areas at top
- For accepted changes, modify the relevant clause text
- For counter changes, replace clause text with our counter-language
- Leave rejected changes as the original baseline text
- Generate signature block with company name pre-populated

Pros:
- Single source of truth (the canonical PDF stays authoritative)
- Lightweight on Vercel (`pdf-lib` is already used in the project)
- No template drift risk

Cons:
- Programmatically editing PDF text is fiddly — depends on the PDF being structured for it
- Some clauses may span multiple paragraphs/pages
- Layout may shift when text length changes

### Recommendation: start with Approach 1

Approach 2 is "ideal" but high-risk for v1. Approach 1 ships faster and the template-drift risk is manageable if we:
- Keep the HTML template's clause numbering and substance in lockstep with the canonical PDF
- Document in code: "if you change this template, also update sirreel-rental-agreement.pdf and vice versa"
- Add a Phase 4a.1 followup to write a regression test that compares the generated counter-PDF against an expected output for known fixtures

Eventual migration to Approach 2 is possible once the system is in real use and we know what the actual edit patterns look like.

### What the HTML template needs to support

- Header with SirReel branding (matches existing baseline visual style)
- Company info block (Company Name, Address, Type, etc.) — pre-filled from `companyId`
- Job info block (Job Name, Type, Rental Start/End, Schedule) — pre-filled from `jobId` if present
- All 29 numbered clauses + Fleet Vehicle Rental Agreement section + LCDW addendum
- For each clause: render canonical text by default; if a `ReviewChangeDecision` for that clauseRef has decision `ACCEPT`, render the modified text from `aiResponse.changes[i].proposed`; if `COUNTER`, render `counterLanguage`; if `REJECT`, render canonical text (no change).
- Signature block at the end

### Implementation sketch

```typescript
// New file: src/lib/contracts/generateCounterPdf.ts

import puppeteer from 'puppeteer-core'
import chromium from '@sparticuz/chromium'

export async function generateCounterPdf(args: {
  review: ContractReview & {
    company: Company | null
    job: Job | null
    changeDecisions: ReviewChangeDecision[]
  }
}): Promise<Buffer> {
  const html = renderContractHtml({
    company: args.review.company,
    job: args.review.job,
    decisions: args.review.changeDecisions,
    aiChanges: args.review.aiResponse.changes,
  })

  const browser = await puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  })
  const page = await browser.newPage()
  await page.setContent(html, { waitUntil: 'networkidle0' })
  const pdf = await page.pdf({ format: 'Letter', printBackground: true })
  await browser.close()
  return pdf
}

function renderContractHtml({ company, job, decisions, aiChanges }) {
  // Returns full HTML string
  // For each clause, look up decision and render appropriate text
}
```

Vercel-specific: Puppeteer on serverless requires `@sparticuz/chromium` (pre-built Chromium binary). Adds ~50MB to the deployment but is the standard pattern.

---

## UI changes

### Modified: `/tools/contract-review/[id]` (detail page)

Currently shows:
- Header
- PDF iframe of original
- ReviewResultPanel (changes accordion)
- Single decision section (Approve/Counter/Reject buttons + note)

New layout:

- Header (unchanged)
- Two-tab layout:
  - **Tab 1: "Original" — original PDF iframe (existing behavior)**
  - **Tab 2: "Counter Proposal" — counter-PDF iframe if generated, otherwise empty state with "Generate Counter PDF" button**
- ReviewResultPanel modified: each change accordion now has per-clause decision controls
  - Three buttons: Accept / Counter / Reject (one selected at a time)
  - If Counter: textarea appears with `counterLanguage` (pre-filled from AI's `suggestedCounter` if present, editable)
  - Optional note textarea (smaller)
  - Save button per change OR "Save all decisions" button at the bottom
- Decision summary at bottom: "X accepted, Y countered, Z rejected. W still pending."
- "Generate Counter PDF" button — only enabled when 0 pending. Click → calls generate endpoint → switches to Tab 2 → shows generated PDF.
- "Regenerate" button on Tab 2 — for when decisions change after a counter-PDF was already generated (warns: "This will replace the previous counter-PDF").

### Modified: `ReviewResultPanel.tsx`

- Add per-clause decision controls inside each change accordion
- Accept new prop: `decisions: Record<clauseRef, ChangeDecision>`
- Accept new prop: `onDecisionChange: (clauseRef, decision, counterLanguage?, note?) => void`
- Backward compatible: if `decisions` and `onDecisionChange` are not passed, render in read-only mode (used on history dashboard, list views)

### New component: `CounterPdfPreview.tsx`

- iframe pointing at `/api/tools/contract-review/[id]/counter-pdf`
- Header: "Counter Proposal — generated [date] by [user]"
- Action: Download button + "Regenerate" button

---

## Build phases (incremental shipping)

### Chunk A — Schema + decisions API (~1 day)
1. Add `ReviewChangeDecision` model + `ContractReview` field additions to schema
2. `prisma db push` (verified additive only)
3. Build `POST /api/tools/contract-review/[id]/decisions` endpoint
4. Modify `GET /api/tools/contract-review/[id]` to hydrate `changeDecisions`
5. No UI changes yet

After Chunk A: per-change decisions can be saved via API. Detail page still shows the old single-decision UI.

### Chunk B — Per-clause decision UI (~2 days)
6. Modify `ReviewResultPanel.tsx` to render per-clause decision controls
7. Modify detail page to wire up decisions to the new endpoint
8. Add decision summary at bottom
9. Add "Save all decisions" or per-row save behavior

After Chunk B: humans can mark per-clause decisions in the UI. Saved to DB. No counter-PDF yet.

### Chunk C — Counter-PDF generation (~2 days, the hard one)
10. Build HTML template for the counter contract (matching canonical baseline substance)
11. Set up Puppeteer + `@sparticuz/chromium` on Vercel
12. Build `POST /api/tools/contract-review/[id]/generate-counter-pdf` endpoint
13. Build `GET /api/tools/contract-review/[id]/counter-pdf` endpoint (serve from Blob)
14. Test extensively against all decision combinations

After Chunk C: humans can generate the counter-PDF after making all decisions. PDF is saved to Blob.

### Chunk D — Counter-PDF UI (~1 day)
15. Add two-tab layout to detail page (Original / Counter Proposal)
16. Build `CounterPdfPreview` component
17. Add "Generate Counter PDF" button (gated on no PENDING decisions)
18. Add "Regenerate" flow with confirmation modal

After Chunk D: full Phase 4a flow shipped. Humans can review, decide per-clause, generate counter, download.

---

## Open questions to resolve before starting

1. **Puppeteer vs alternative?** `@react-pdf/renderer` is React-native and lighter weight than Puppeteer-on-Vercel, but the layout fidelity is lower. If the counter-PDF needs to look like a polished legal document, Puppeteer is probably right. Confirm before Chunk C.

2. **How are deal-specific fields (Company, Job) populated?** Counter-PDF should fill in the company name, addresses, job name, dates, etc. — from the `Company` and `Job` records linked to the review. Need to confirm the data exists in those records (some fields like job dates might still be in RentalWorks).

3. **Signature block:** does the counter-PDF include a pre-filled signature block, or just a clean form for the client to fill in?

4. **Versioning:** if Ana generates a counter, then changes a decision and regenerates, do we keep the old counter-PDF as history? For Phase 4a, replacing is fine (just one current counter-PDF per review). Multi-version is a future feature.

5. **Regression fixture:** save a known review with known decisions and a known expected counter-PDF output. Run after every change to PDF generation logic.

---

## Files this brief will create or modify

**New:**
- `src/app/api/tools/contract-review/[id]/decisions/route.ts`
- `src/app/api/tools/contract-review/[id]/generate-counter-pdf/route.ts`
- `src/app/api/tools/contract-review/[id]/counter-pdf/route.ts`
- `src/lib/contracts/generateCounterPdf.ts`
- `src/lib/contracts/contractTemplate.tsx` (or .html.ts) — the HTML template for the contract
- `src/components/reviews/CounterPdfPreview.tsx`

**Modified:**
- `prisma/schema.prisma` (add `ReviewChangeDecision` + 4 new fields on `ContractReview`)
- `src/app/api/tools/contract-review/[id]/route.ts` (hydrate `changeDecisions`)
- `src/app/(dashboard)/tools/contract-review/[id]/page.tsx` (two-tab layout, per-clause decision UI)
- `src/components/reviews/ReviewResultPanel.tsx` (per-clause decision controls)
- `package.json` (add `puppeteer-core`, `@sparticuz/chromium`)

---

## Done definition

Phase 4a is complete when:

- [ ] Per-clause decisions can be made on the detail page (Accept / Counter / Reject + counter-language for Counter)
- [ ] All decisions are persisted to `sr_review_change_decisions`
- [ ] "Generate Counter PDF" button works when all decisions are non-PENDING
- [ ] Generated PDF appears in Tab 2, viewable inline, downloadable
- [ ] Generated PDF is stored in Vercel Blob with private access
- [ ] Counter-PDF correctly reflects: accepted clauses with new language, countered clauses with our counter-language, rejected clauses with original baseline text
- [ ] Regenerate button replaces the existing counter-PDF (with confirmation)
- [ ] At least one regression fixture exists: known review + known decisions = expected counter-PDF
- [ ] CLAUDE.md updated with the new model + PDF generation pattern
- [ ] Decision: was Approach 1 (Puppeteer/HTML) or Approach 2 (pdf-lib edit) chosen, and why

---

## What's NOT in Phase 4a (deferred)

| Feature | Phase | Notes |
|---------|-------|-------|
| Email composition + send to client | 4b | Resend integration; cover email drafted by AI; human clicks Send |
| Standing positions library | 5a | Reusable counter-language across deals |
| Multi-round negotiation tracking | 5b | `ContractNegotiation` model groups multiple reviews; AI compares against last position not original baseline |
| AI auto-draft of decisions | TBD | Long-term: AI proposes a default decision per clause based on past patterns |
| Decision audit log | TBD | Currently only latest decision stored; no history of changes to decisions |
| Approval workflow | TBD | Multi-person sign-off before generating counter-PDF |

---

## Interaction with the AI agent learning vision

Wes raised in the May 7 session that the long-term vision is for AI agents to handle email negotiations. Phase 4a contributes to this in two ways:

1. **Per-clause decisions are structured training data.** Six months of "we accepted §19 wear-and-tear, rejected §16 cap removal" creates a labeled dataset of standing positions. The Phase 5a standing positions library institutionalizes those patterns.

2. **Counter-language is voice training data.** The exact wording Ana/Jose use when countering becomes the corpus for an AI that learns the SirReel house voice for legal pushback.

Capture decision rationale in the `note` field consistently. Even one-sentence notes ("rejecting because broker hasn't approved mutual indemnity yet") compound into useful training data over time.

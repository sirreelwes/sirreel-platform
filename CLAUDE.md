# SirReel HQ — Claude Code Context

## Project
Internal operations platform for SirReel Production Vehicles, Inc.
Next.js 14 (app router, src/ directory) + Prisma + Neon PostgreSQL + Vercel.
Repo: github.com/sirreelwes/sirreel-platform
Live: hq.sirreel.com

## People
- **Wes Bailey** (CEO/owner, primary user) — wes@sirreel.com
- **Dani** — operations/co-owner
- **Hugo** — GM
- **Ana** — collections/billing
- **Jose Pacheco, Oliver Carlson** — sales
- **Julian** — dispatch/fleet
- **Chris Valencia** — fleet associate

## Critical Workflow Rules

### Before Prisma migrations
```bash
export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
```

### Before every git push
Run the REAL production build — this is what Vercel runs and what fails the deploy.
`tsc --noEmit` alone is NOT enough: it skips ESLint and Next's route-type
validation (e.g. a stray `export const FOO` from a route file passes tsc but
FAILS `next build`). A red build blocks ALL subsequent commits from deploying.
```bash
npm run build
```
Must exit 0 (ends with `✓ Generating static pages` + the route table, no
`Failed to compile`). Do NOT disable lint/build checks to force it green — fix
the code. (`npx tsc --noEmit 2>&1 | grep -v node_modules` is a fast inner-loop
check, but the build is the gate.)

### Schema changes — DO NOT use `prisma migrate dev`
Migration history has known drift from live DB. Use `prisma db push` instead.
Always preview first:
```bash
npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script
```
Confirm output is purely additive (no DROP TABLE / DROP COLUMN) before pushing.

### Python file edits
Use `python3 - << 'EOF'` heredoc syntax to avoid zsh parsing issues.

### Verification fixtures & cleanup (live DB safety)
The dev server and ad-hoc Prisma scripts hit the SAME Neon DB as production — there is no separate test DB, so "test-looking" rows may be real user activity.
- Fixtures must be **self-owned**: a dedicated prefix (e.g. `ZZTEST_` / `zz-*`) OR rows created in the same run whose IDs you capture in a variable.
- Cleanup deletes **by captured ID only**. NEVER `deleteMany` by pattern, shape, name match, or entity scope (e.g. "all RateChangeLog rows for category X").
- If you can't prove by captured ID that you created a row, leave it and report it. (See SHIPLOG.md "Hard Rules" — origin: a cleanup once destroyed a real rate-change audit row.)

## Architecture

### Data Sources of Truth
- **Scheduling — import executed 2026-08-18 (Wes authorized):** the one-time Planyo import ran clean — 47 bookings / 65 items / 61 assignments, every PLANYO booking linked to a Job, in-progress rentals included (window reaches back 60 days), and the 4 stale prior-backfill carts with drifted units superseded from current Planyo truth. HQ's native scheduler now holds the live book as of that run.
  - **CUTOVER DONE 2026-09-14 (Wes): reservations are made in HQ ONLY and Planyo mirroring is OFF.** HQ is the book — full stop. Planyo (Site ID 36171) is history, not a working surface, and NOT a source to reconcile against: a cart that exists there and not here is not automatically a gap, because the team stopped maintaining it.
  - The kill switch is `planyoMirrorEnabled()` in `src/lib/sync/planyo/mirrorSwitch.ts`, read by the `planyo-sync` cron and the two `/api/planyo/*` routes. It is **default OFF with no env var set**, so the state is the deployed default. Rolling back is `PLANYO_MIRROR=1` in Vercel Production — one env var, no deploy — and any run under that override posts a loud daily Slack line so a forgotten flag can't resume imports in the dark. The cron entry stays in vercel.json on purpose (a no-op tick beats needing a deploy to resurrect).
  - `scripts/scheduling-planyo-migration.ts` is deliberately NOT gated — a human running the importer is a deliberate act and it is the recovery path. Do NOT run it to "catch up drift" as routine; that re-imports carts against a native book and mints duplicates. Historical rows keep `source=PLANYO_BACKFILL` + `planyoCartId`, and the `PlanyoSyncRun`/`PlanyoSyncEvent` audit tables are untouched.
  - Post-import manual list (report): 3 Lankershim room assignments, 1 backup-hold linkage, agent reattribution (imports default to Wes as agent).
- **RentalWorks** = billing source of truth (being deprecated long-term — design new features for SirReel HQ-native workflow, not RW alignment)
- **CardPointe** = card processing. **LIVE in production since 2026-08-18** —
  Fiserv signed off, `CARDPOINTE_ENV=PROD` and the four `CARDPOINTE_PROD_*`
  values are set in Vercel Production, and `/api/cardpointe/config` reports
  `env: PROD, live: true` on `boltgw.cardconnect.com`. Client card capture and
  payment are open; staff collections charges real cards.
  - **Never put production credentials in `.env.local`.** Local dev and every
    ad-hoc script read it, so a prod value there charges real cards from a
    laptop. Local stays UAT (MID 810000003214) — which is also why this file
    can no longer name "the" MID: prod and local are deliberately different.
    Read the env for whichever one you mean.
  - The `live` gate (`env === 'PROD'`) still guards every client-facing card
    surface, so an accidental revert to UAT closes them rather than quietly
    sending real cards to the sandbox — which is what happened on 2026-08-13.

### Key Database Concepts
- **Order** (`sr_orders`) — invoiceable rental, ties to a Job
- **Job** (`sr_jobs`) — production/show that owns one or more orders. `Job.status` is NOT a lifecycle the app advances — nothing ever wrote ACTIVE/WRAPPED/HOLD on its own (only NEW on create, NEW→QUOTED on portal welcome, LOST via mark-lost). As of 2026-08-25 it's demoted to three human OFF-RAMPS (HOLD / WRAPPED / LOST) that override the orders; "where is this job" is DERIVED from the orders by `src/lib/jobs/cadence.ts` and rendered identically on the /jobs board and the job detail header. Legacy ACTIVE rows are harmless — the rollup ignores the value whenever live orders exist
- **JobContact** (`sr_job_contacts`) — person + role (PRODUCER/PM/PC/TRANSPO/ACCOUNTING/OTHER) on a job. Primary contact computed: PM → PC → first marked primary → first contact
- **Person** (`people`) — contacts, NOT scoped to a single company (works with multiple via JobContact)
- **Company** (`companies`) — clients
- **Booking** — Planyo-driven; lifecycle: REQUEST → AI_REVIEW → PENDING_APPROVAL → CONFIRMED → ACTIVE → RETURNED → CANCELLED → ARCHIVED

### Key API patterns
- All API routes use singleton `import { prisma } from '@/lib/prisma'` (NOT `new PrismaClient()`)
- Most API routes use `export const dynamic = 'force-dynamic'`
- Person search is typeahead-only via `/api/persons?q=` (min 1 char, max 8 results)
- Order numbers: `S{YYMMDD}-{NNN}` format with a daily-reset counter in Pacific time (e.g. `S260604-001`). Generated by `nextOrderNumber(tx)` in `src/lib/orders.ts` — must be called INSIDE the order-create transaction so the counter rolls back with a failed insert. The 11 pre-cutover orders kept their legacy `SR-ORD-NNNN` numbers (forward-only switch); `sr_order_number_seq` remains in the DB but is no longer called. Job codes: `SR-JOB-0001` format
- RentalWorks API: agent field is `Agent` (NOT `CustomerServiceRepresentative`), formatted `Lastname, Firstname` — reverse and trim to match UI display names. Outstanding balance = `Total - InvoicedAmount`

### UI Conventions
- **The staff shell's content area is LIGHT** — `<main>` in
  `src/app/(dashboard)/layout.tsx` is `bg-[#F7F6F3]` and `globals.css`
  `:root` is a light palette. Only the left nav is dark. A page written
  to the old "dark theme" note renders white text on cream — present,
  selectable, unreadable (2026-09-04: the whole check in/out report
  screen shipped that way).
- **Use the `lt-*` / `chip-*` tokens, not raw zinc.** tailwind.config.ts
  defines the light palette: `bg-lt-page` / `bg-lt-card` / `bg-lt-inner`,
  `border-lt-hairline`, and the measured text ramp `text-lt-fg` (primary)
  → `text-lt-fg2` (secondary) → `text-lt-fg3` (muted). The muted steps
  were chosen against the LIGHTEST surface in the system so they clear AA
  everywhere — eyeballing a `zinc-500` does not. Notices use the `chip-*`
  pairs (`bg-chip-warn-bg text-chip-warn-fg`, `-good-`, `-bad-`,
  `-neutral-`). `text-white` belongs on filled buttons only.
  `src/app/(dashboard)/guides/*/page.tsx` is the cleanest reference.
- Dark styling is legal ONLY inside a card that paints its own opaque
  dark background (`bg-zinc-800` / `bg-zinc-900`, no alpha) — see
  `src/components/yard/YardBoard.tsx`. `bg-zinc-900/40` is not that; over
  cream it is a washed mid-grey.
- Accent: `bg-amber-600 hover:bg-amber-500` for primary CTAs — and `amber-*` IS
  the Utliiz turquoise (#0F7A93) since 2026-09-06, remapped in tailwind.config.ts;
  gold is gone everywhere (Wes). Inline hexes: `#0F7A93` on light, `#4DB1C6` on
  black, `#0C657A` for dark text. Never reintroduce `#c39a3f` / `#D4A547`.
- Yard/warehouse surfaces are read standing at a terminal — keep item
  names ~16px and detail ~13px, not the desktop 14/12.
- Reference existing components in `src/components/orders/` for styling

## Git
- Identity set globally as Wes Bailey / wes@sirreel.com
- Main branch: `main`. **Pushes to `main` auto-deploy to production** via the Vercel GitHub integration (project `sirreel-fleet` → `hq.sirreel.com`); other branches get preview deploys. Confirmed working — a `git push origin main` triggers the production build on its own. **Do NOT run `vercel deploy --prod`** (or any Vercel CLI deploy) — it's redundant and races the auto-deploy. Just push.
- Don't commit `.bak.*` files (in .gitignore) or pulled schema reference files

## Things to Avoid
- Do NOT run `prisma migrate reset` — would wipe production data
- Do NOT run `prisma migrate dev` — schema drift causes false destructive proposals
- Do NOT use `localStorage` / `sessionStorage` in components
- Do NOT assume RentalWorks alignment for new features — it's being phased out

## Recently Shipped (April 18, 2026)
- Job + JobContact models with full UI integration in `/orders/new`
- Schema drift recovery (added back 6 missing models: Alert, ClientSession, DismissedEmail, EodReport, JobMessage, PaymentLog)
- Orders now require jobId
- new-quote page has temporary auto-create-job fallback (production name → job name); proper UX redesign deferred

## Recently Shipped (May 7, 2026)
- Contract review Phase 4a: per-clause decisions + counter-PDF generation
  - New model `ReviewChangeDecision` (`sr_review_change_decisions`) — one row per AI-flagged change with decision (PENDING/ACCEPT/COUNTER/REJECT), counter-language, and audit fields. Unique key is `(reviewId, changeIndex)` since `clauseRef` can be a grouping (e.g. "1-3") and isn't always unique within a review
  - Counter-PDF tracking on `ContractReview`: `counterPdfKey`, `counterPdfUrl`, `counterGeneratedAt`, `counterGeneratedById` — replace semantics (one current counter-PDF per review)
  - PDF generation pattern: HTML template (`src/lib/contracts/contractTemplate.ts`) + Puppeteer (`puppeteer-core` + `@sparticuz/chromium` on Vercel, falls back to local Chrome in dev). Canonical clause text in `src/lib/contracts/contractClauses.ts` — must stay in lockstep with `public/contracts/sirreel-rental-agreement.pdf`
  - Regression fixture: `npm run test:counter-pdf` snapshots the rendered HTML; bump with `UPDATE_SNAPSHOTS=1`
  - Counter-PDF is a *negotiation document*, not a contract-to-sign — no signature block. Signing happens through the existing portal flow when client agrees

## Client paperwork (2026-08-25)
- **The rental agreement is signable in the portal.** `/portal/job/[slug]/sign/rental`
  had existed since the stage flow shipped but NOTHING linked to it — the
  paperwork row sent clients to the Cognito form, or read "your rep will send
  the agreement shortly" while the badge said Ready to sign. The row now
  mirrors the Stage Contract row (read the PDF + sign in-portal). Separately,
  the job page's "Send for signature" only sent a portal INVITE; it now also
  POSTs `/agreement/release`, so the button matches its label. Not-yet-released
  copy names the real blocker (approve the quote).
- **COI named insured vs production company.** `CoiCheck.namedInsured` stores
  the raw fact off the certificate; the verdict is COMPUTED on read
  (`src/lib/coi/insuredMatch.ts`) so fixing a wrong production company clears
  the flag without re-reviewing. Flagged on the job page, the paperwork feed,
  the client portal, the COI-drop confirmation, and the team email.
  `npm run test:insured-match` guards both failure directions.
- **COI review desk** (`CoiReviewModal` + `/api/coi/review/[id]`) — a COI could
  previously only be signed off at upload time, so client-drop certificates sat
  PENDING forever. Approve/reject/re-run AI, plus the fixes: change the
  production company (`PATCH /api/jobs/[id]/company`, job + orders + bookings + job-scoped COIs/contract
  reviews move together — bookings and COIs were left behind until
  2026-09-10, so the client paperwork chain, PaperworkRequest → Booking →
  Company, kept showing the old company) and re-issue an agreement signed under the wrong one
  (`POST /api/orders/[id]/agreement/reissue`). The superseded signature is
  snapshotted to `sr_agreement_reissues` — SignedAgreement is unique on
  (orderId, contractType), so re-releasing overwrites it.
- The client COI drop link now runs the AI review on arrival (it used to store
  the PDF with no analysis at all).

## A negotiated agreement becomes the client's annual (2026-09-18 — Wes)
- Wes: "for party giraffe and graduation day, I need to make those negotiated
  agreements standard for each job as an annual agreement." Their counsel's
  redline was already transcribed (`negotiated/graduationDay2026.ts`, verbatim
  — read `negotiatedAgreement.ts` before touching a word of it) and had a
  filing script since 2026-09-15. Nothing had run it: the write needs the
  production DB **and** `BLOB_READ_WRITE_TOKEN`, which is deliberately not in
  `.env.local`, so the only thing in the way was a laptop.
- **`src/lib/contracts/fileNegotiatedAgreement.ts` is the work**, with the
  two entry points: `scripts/file-negotiated-agreement.ts` (argv + journal +
  exit code, nothing else) and /admin/maintenance →
  `file-negotiated-agreement`. The web path is the one place the blob token
  simply IS — a phone run needs no `vercel env run`. Add behaviour to the
  lib or the phone loses it.
- **It files the document TWICE, for two different questions**, because
  Wes's sentence names both mechanisms: `CompanyAgreement.autoCoverJobs` (the
  ANNUAL master — every job inside the window is papered by it and the portal
  asks only for the LCDW election, `annualCoverage.ts`) and
  `Company.negotiatedTermsUrl` (the STANDING document — what goes out
  whenever an agreement IS released for signature,
  `ensureSignedAgreementForOrder`). Coverage outranks standing terms, so only
  the first is felt while it holds; the second is what stops the day the
  window lapses (2026-12-31 here) from handing that client our baseline
  template after their lawyer redlined it. One PDF, both pointers.
- `standingLcdwDecision` stays NULL on purpose — their counsel settled the
  terms, nobody elected the damage waiver, and a null standing answer is
  exactly what makes the portal ask per job.
- **What it refuses, rather than guessing:** companies are matched on EXACT
  name (0 or 2+ → skipped, near-misses printed as pasteable aliases); a
  company already carrying a CURRENT auto-covering master is skipped for a
  person to supersede by hand; standing terms already on file are never
  overwritten (the annual is still filed and the log says so); no expiry date
  is a refusal, because a master that never lapses never hands the signing
  ask back. Dry run is the default on both paths and still renders the PDF.
- `Party Giraffes` → **`Party Giraffes, LLC`** is a confirmed
  `companyAliases` entry on the agreement, so nothing is typed on a phone.
  Matching stays exact anyway: "Party Giraffes" also near-matches "Giraffe
  Air LLC DBA Studio Sands", which is somebody else. An `alias` param
  overrides it when the dry run says a name did not match — one per LINE or
  semicolon, never comma-separated, because the values carry commas.
- Coverage is read live, so jobs already open for these companies are covered
  on their next read; no backfill. **RAN 2026-09-18 (Wes, from the phone):
  both masters filed, standing terms set on both companies.**
  `npm run test:negotiated-agreement`, `npm run test:maintenance-tasks`.

### They sign THEIR document, not ours (2026-09-18 — Wes: "build the proper door")
- The filed masters cover with **no signature on them** — a third state the
  two-state model in `companyAnnual.ts` did not have (covering, unsigned,
  never offered). The door to fix that existed but pointed at the wrong
  document: `offerAnnualForSignature` built EVERY offer from
  `CANONICAL_CLAUSES` via `generateCounterPdf`, so offering an annual to
  Graduation Day would have put our standard terms in front of the one
  client whose lawyer spent five months not agreeing to them — and
  `signAnnual` would then have countersigned OUR clauses under their
  signature. Both paths now render the negotiated document.
- **Which document a row IS lives in `CompanyAgreement.source`**
  (`NEGOTIATED:<key>`, read by `negotiatedKeyFromSource`). Written at OFFER
  time, read at SIGN time — so an offer signs as the document the client
  actually read, even if next year's agreement lands in the registry in
  between. No column: `source` is the existing free-text provenance field
  and nothing else reads it (an ALTER is a laptop job).
  `negotiatedAgreementForCompany()` is the registry lookup by the company's
  own CRM name, aliases included, EXACT — a near-match would put one
  client's negotiated terms in front of another.
- **The countersigned copy is one renderer, two states.**
  `NegotiatedAgreementDocument` takes an optional `signature` and swaps the
  blank Lessee column for the executed block + E-SIGN audit trail (same
  evidence and the same bundled handwriting face as the per-order signed
  copy). SirReel's own line stays blank — countersigning our side is a
  separate act nobody performed.
- **Signing supersedes the unsigned master.** `signAnnual` switches
  `autoCoverJobs` off on every OTHER covering RENTAL_AGREEMENT master for
  that company **that nobody signed** (`signedAt: null`), appends why to its
  note, audits `company_agreement.superseded`, and — only where the
  company's standing terms point at the very file just superseded — moves
  `negotiatedTermsUrl` to the executed copy. A master someone DID sign is
  never quietly disabled by another signature. Nothing is deleted.
- The portal's affirmation now names the document by its own title
  (`acknowledgementFor(title)`); it used to say "the Annual Rental
  Agreement" over a document titled "2026 Negotiated Rental Agreement" — the
  one sentence in the flow that has to match what they read.
- **Signing also fills the LCDW gap**: `standingLcdwDecision` is stamped from
  the signer's election, which is what lets `fileJobAddendum` cut a job's
  addendum from the master alone. Until then each job's addendum waits on a
  per-job election, and its "Executed" row does not print (it renders only
  with `masterSignerName` / `masterSignedAt`).

### §32 is AGREED — 2026-09-18 (Wes: "A as proposed")
- Graduation Day's counsel (Nicholas Marell) redlined the filed document on
  2026-09-17 — three edits, ALL in **§32 Third-Party Equipment**, the clause
  SirReel appended on 9/15. Clauses 1–31, the Fleet Agreement and the whole
  LCDW Addendum came back unmarked, and their numbering is unchanged so
  `crossReferencesHold()` still passes (it now also checks 14, which the
  agreed §32 cites). Wes sent back three qualifiers on 9/18 and **Marell
  accepted them**, so the clause is settled: their three edits (we answer for
  a §4 failure; the clause runs both ways; "in any event we remain liable for
  the acts and omissions of such third parties") plus ours — **", subject to
  Section 14,"** (their liability sits inside the limitation both sides
  agreed to, not outside it), **the scope limiter** ("in connection with the
  Equipment supplied under this Agreement during the rental period"), a
  grammar fix on their §4 proviso, and **the LCDW sentence placed in §32
  rather than in the addendum they had already accepted** — their "all of our
  obligations" would otherwise drag our damage waiver onto a partner's unit.
- The agreed body is the override in `GRADUATION_DAY_2026.appendedClauses`,
  each side's edits attributed in the comment above it; version line reads
  `· §32 agreed 2026-09-18`. `APPENDED_CLAUSE_DIGEST` was re-verified against
  that exchange and bumped, and the test now NAMES the three qualifiers, so
  losing the cap qualifier fails saying which protection went rather than
  "something changed".
- **An agreed §32 goes in `GRADUATION_DAY_2026.appendedClauses` as a body
  override — NEVER in `contractClauses.ts`.** `canonical('30')` is the
  baseline Third-Party Equipment clause, and the same body is rendered by
  `RentalAgreementBody` (the portal's readable agreement),
  `SignedAgreementDocument` (every signed copy) and the review tooling's
  baseline map. Editing it there renegotiates that clause for every client
  at once, silently, on the strength of one client's counsel.
- `APPENDED_CLAUSE_DIGEST` in the test pins the appended clauses. Nothing
  did before 2026-09-18: a change to our baseline clause 30 altered a FILED
  client contract with no test failure. The client-verified digest stays over
  THEIR 31 clauses alone.
- **Do not rebuild from the DOCX** Wes was sent (a PDF→Word conversion):
  ten words carry literal ASCII hyphens from the conversion
  (compen-sation, inde-pendent, cover-age, compre-hensive, insur-ance,
  re-duced, Agree-ment, con-strued, arbitra-tion, circum-stances) while
  "non-payment" in §21 is a REAL hyphen, and the file lost all front matter
  (no Lessee block, no lede, no version line — the company name appears only
  in the running header). Edit the clause text in the repo and re-render.
- The coverage filed on 9/18 stays ON throughout — an OFFER does not disturb
  it (`offerAnnualForSignature` files `autoCoverJobs: false`), and the
  signature supersedes it. **The PDF is rendered from the registry at OFFER
  time**, so §32 must be deployed before anyone presses "Offer annual
  agreement" or the client is asked to sign the pre-redline clause.
- **Next: offer and signature, per company.** /crm/[id] → Account portal
  access → "Offer annual agreement" for Graduation Day Productions AND for
  Party Giraffes, LLC (separate masters — one signature does not paper the
  other), then "Review & send invite" to an executive on each. They sign at
  `/portal/company/[companyId]/sign/annual`, which is also where the LCDW
  election is made. Marell reviews; he does not sign.

### Covering is not signed — the third state, on every surface (2026-09-18 — Wes)
- Wes: "An executive at the company wants to sign these agreements … I need
  it to be on the Production company portal and I need a way to send it to
  Haylea." The document was right and the portal was wrong: **three surfaces
  read `autoCoverJobs` coverage as proof of a signature**, and the masters
  filed on 9/18 cover with nobody's name on them.
  - the account portal's terms card (`terms.annual ? … : terms.pendingAnnual ? …`)
    showed "Annual agreement active · Read the agreement" and **no Sign
    button** — to the executive who opened the portal to sign;
  - `composeCompanyPortalInvite` gated the sign link on `!annual && pending`,
    so the invite to that executive **named no document and carried no
    link** — the one thing the mail existed to deliver;
  - `/portal/company/[id]/sign/annual` answered a direct link with "Your
    account already has a signed annual agreement … Nothing to sign."
- **`annualSigningState()` in `src/lib/portal/annualSigningRules.ts` is the
  one rule** — its own pure module because two of the three readers are
  CLIENT components and cannot import prisma. `companyAnnual.ts` re-exports
  it. **A PENDING offer is always signable**: somebody pressed "Offer annual
  agreement" for it, `signAnnual` only ever supersedes masters nobody signed,
  and next year's agreement offered while this year's executed copy holds is
  a real case. `executed` (coverage WITH `signedAt`) is the only thing that
  means nothing to sign, and only with no offer waiting. `coveringUnsigned`
  is the third state named out loud, and both client surfaces say it in
  words: the terms are already applying, the signature is still owed.
  Dates are `Date | string` — the sign page reads JSON, the composer reads
  rows, and only the presence of `signedAt` decides anything.
- **The offer wins the portal card** (`terms.annual && !terms.pendingAnnual`),
  with the coverage stated inside it rather than dropped.
- **Sending it to a named person is the portal INVITE, and there is no second
  sender.** The offer sits in the portal and nobody sees a portal they were
  never invited to, so /crm/[id] → Account portal access now carries a
  "<title> is waiting for a signature" strip that says so and points at Add
  people → **Review & send invite**. The invite's annual callout is rendered
  by the TEMPLATE, not the editable note — a rep trimming the prose cannot
  delete the sign link (the partner-welcome rule).
- `npm run test:annual-signing`. The expensive direction is a false "nothing
  to sign": it is unfalsifiable from the client's side — they see a tidy,
  confident screen — and it leaves the terms in force with no signature
  behind them.

## Their counsel reviews the agreement in HQ (2026-09-18 — Wes)
- Wes: "Marell will probably want to see the entire agreement again. I'll
  need to send my finished one to him. Ideally, I can just send it in HQ to
  him, and he can review it there with a button that allows him to download
  a DOCX file."
- **The Word file is COMPOSED from the clause data, never converted.**
  `src/lib/contracts/generateNegotiatedAgreementDocx.ts` writes
  WordprocessingML and zips it with `pizzip` (already a dependency). Why not
  `docxtemplater`, which is also here: it FILLS a template, and a template
  means a binary .docx in the repo carrying clause text that has to stay in
  lockstep with contractClauses.ts — the exact drift the digest test exists
  to stop. Why not a conversion: the file Marell returned on 9/17 was a
  PDF→Word conversion with ten invented hyphens and no front matter at all.
  Composing cannot reproduce either defect, and the test asserts both
  directions (no artifact words, "non-payment" intact).
- Headings are LITERAL text, never Word auto-numbering — their numbering
  carries a deliberate GAP at 15 (counsel deleted Subrogation) and Word
  would silently close it. The test pins the gap.
- **`/agreement/review/[token]`** is read-only in the strong sense: no form,
  no POST, no session, two download buttons. `signCounselReviewToken`
  (`counselReviewToken.ts`) reuses the COI HMAC envelope with a THIRD domain
  separator (`counsel-review.v1`); `npm run test:counsel-review` asserts a
  COI broker token does not verify as a counsel token or the reverse —
  three schemes now sign JSON with one secret. Payload is ONE
  `companyAgreementId`, 45-day TTL, so a forwarded link never widens.
- **`buildCounselReviewPacket()` IS the disclosure envelope** and the page
  renders nothing it does not return. OUT: every rate and dollar figure that
  is not contract text, the orders and jobs the master papers, other
  paperwork, any other client's terms, HQ's notes, who filed it, and the
  partner arrangements behind §32.
- **Rendered LIVE from the registry, not from the filed blob** — the same
  "recomputed on every view" rule as the broker desk, because §32 is still
  moving. So the page SAYS it is the current copy for review rather than the
  executed agreement (`isCurrentDraft`), and a later correction needs no
  re-send. Once signed it flips to "Executed — this copy is for your file".
- **There is a REVIEW step, and it is the mail** (Wes 2026-09-18: "Where is
  the review of the email to Marell?"). The first cut composed the body
  inside the POST, so the only thing on screen was the note box — for the
  one message in HQ most worth reading twice. `renderCounselReviewEmail`
  (`counselReviewEmail.ts`) is now the ONE renderer and the route's **GET**
  returns exactly what its POST will send: subject, rendered html, Reply-To,
  and "no Cc" stated. Two taps in the panel — **Review the email** then
  **Send it** — and any edit to the address, the name or the note clears the
  preview, the way the job composer's armed strip disarms. The GET mints its
  own display token and the POST mints the one it sends; both are valid for
  the same agreement. The test pins that a note cannot remove the LINK
  (blank, one-word, or one carrying a rival URL) and that a note is escaped
  before it reaches HTML.
- **Sent from /crm/companies → Annual agreement → "Send to their counsel ↗"**
  (`POST …/agreements/[agreementId]/counsel-review`). Posture copied from
  the COI broker desk: the EMAIL IS THE ACT (a send failure stamps nothing),
  the **LINK is appended by the ROUTE and never by the editable note** (the
  partner-welcome rule), Reply-To is the sender exact, audited
  `company_agreement.counsel_review_sent` with who it went to and never the
  body. **NO Cc (Wes: "no cc")** — the COI rule copies the coordinator
  because nobody's broker should be approached behind their back; counsel is
  Wes writing to the lawyer he is negotiating with, and the box is free for
  a human to add one.
- Refuses (409) for a company with no registry agreement: the Word copy is
  composed from clause text, so there has to be clause text.
- NOT built: counsel cannot upload a redline BACK — they email it and it is
  transcribed into `appendedClauses` by hand (`ContractReview` already has a
  redline-upload path if that changes). Nothing nudges when a link has been
  open for days with no reply.

## No partner's gear on a job without their signature (2026-09-18 — Wes)
- Wes, reading his counsel's §32 redline: "go ahead with the unsigned-partner
  gate." §32 supplies a partner's unit to the client **on SirReel's own
  terms**, and Graduation Day's negotiated version pushes further — we answer
  for a failure (theirs or ours) to meet §4 and for "the acts and omissions of
  such third parties". All of that is survivable ONLY because the partner
  carries it back to back: partner agreement **§6** (condition, maintenance,
  load-testing, certifications, repair-or-replace at their cost) and **§11**
  (they indemnify "SirReel, its officers, employees, agents AND CLIENTS" for a
  Unit's condition, their breach, and their personnel's acts in delivery,
  setup and collection — expressly carved OUT of their own consequential
  exclusion). No signature, nothing behind the promise.
- **The hole:** the signature gate existed — `PARTNER_APPROVED_VENDOR_WHERE`
  in site/vehicleCatalog.ts — and guards the PUBLIC LISTING only.
  `/api/catalog/search` matches a partner unit on `isActive` +
  `offeredToSirReel` + `vendor.isActive`, so a rep could quote AND book an
  unsigned partner's unit. VSM Planet is the live example: quotable today,
  agreement unsigned.
- **`src/lib/sub-rentals/partnerPaperGate.ts`** is the rule.
  `partnerPaperStatus()` is pure: none / unsigned / signed / expired /
  not-yet-effective, best row wins (a lapsed copy or an unsigned re-file
  beside a signed one is still covered), both date ends inclusive of the
  calendar day like `isCoverageCurrent`. **Only "nothing signed" blocks** —
  a lapsed agreement is named loudly and lets the booking through.
- **Scope is a live SubRental with a ROSTER unit**, and deliberately NOT
  `PARTNER_SUB_RENTAL_WHERE` from orders/partnerLines.ts: that predicate
  excludes DELIVER_TO_SIRREEL because it answers "does this come through our
  warehouse". This one answers "whose gear is it", and a partner's generator
  dropped at Sun Valley is still theirs. **Ad-hoc sub-leases are out of
  scope** — §32 covers them, but the backstop there is that house's own
  rental terms under which we are the renter. There is paper; it isn't ours.
- **THREE doors reach BOOKED and two of them needed it.** `/mark-booked`
  (the job page + the order page's "Record client approval") and **`/book`**
  (the order page's APPROVED action, which had no floor gate either — still
  doesn't, flagged not fixed). A gate on one is bypassed by the other button.
- **Confirmable, not a wall** — unlike `partnerFloorGate`, which refuses
  outright. A rep cannot produce a partner's countersignature, and a client
  waiting on a Friday is not a reason to leave a booking unrecorded. So the
  server refuses ONCE with the partner and units NAMED, and
  `confirmUnsignedPartner: true` pushes it through, recorded on the audit row
  as `unsignedPartnerOverride`.
- **send-quote warns, it does not stop.** A quote commits nothing and no
  gear is on the road, so the 409 (`error: 'unsigned-partner'`) is
  acknowledged once and the button re-arms as **Send anyway** — the same
  shape as `EmailReviewModal`'s existing already-replied guard, reusing that
  machinery rather than adding a second pattern.
- NOT done: the client's own portal approval (`/api/portal/job/approve-quote`)
  is deliberately NOT gated — you cannot refuse a client's yes because our
  partner has not countersigned. That one wants an action item, which is the
  obvious next step and is not built. Nor is an action item / job-page prompt
  for the unsigned partner generally.
- `npm run test:partner-paper`.

## The broker gets the review, not a forwarded paragraph (2026-09-17 — Wes)
- Wes: "Is there a way to extract the broker from a COI and add an option to
  send a link to them when we need an updated COI or something isn't passing
  our test? The link would open a read only review showing the broker what we
  are rejecting or requesting be fixed." Every correction used to go client →
  broker → client, with our requirement text re-explained at each hop.
- **The broker is read off the document, not stored.** `COI_PROMPT` now
  extracts the ACORD 25 **PRODUCER** box (agency, contact name, email, phone,
  address) beside `namedInsured`; it lives in `CoiCheck.aiResponse.producer`
  and is read on demand by `readCoiBroker()` in `src/lib/coi/broker.ts`.
  **No column, no migration** — same reasoning as the named insured: a raw
  FACT off the certificate that a re-run corrects. Placeholder-scrubbing
  ("N/A", "same as insured") and e-mail validation live in the READER, not in
  what we store; an invented broker is a correction request sent to a
  stranger with the client's name in it.
- **"Never asked" ≠ "blank box."** A review filed before today has no
  `producer` key at all and the desk says "re-run it to pull the broker off
  the certificate" — the same distinction `aiHasInsuredName` carries. Today's
  `normalizeCoiReview` always stamps the key, so an empty producer box on a
  fresh review reads as asked-and-blank.
- **`POST /api/coi/review/[id]` action `EMAIL_BROKER`** — the fourth option
  beside Approve / Reject / Request fix from client. Same posture as
  REQUEST_FIX: the email IS the act (a send failure changes nothing), the row
  parks in COUNTERED, Reply-To is the reviewer. Differences: the recipient
  defaults to the producer block, the **client is Cc'd by default** (nobody's
  broker is approached behind their coordinator's back), and **the review
  LINK is appended by the route, never by the editable draft** — the partner-
  welcome rule, so a reviewer trimming a paragraph cannot delete the thing the
  email exists to deliver. Audited `coi.broker_review_sent` (who it went to,
  never the body — that is on the job's thread). Label `coi-broker-review`
  rides `sendOnJobThread`, so the broker's reply files to the job.
- **The link opens `/coi/broker/[token]`** — read-only in the strong sense:
  no form, no POST, no session. `signCoiBrokerToken` reuses the COI-upload
  HMAC envelope with a **domain separator** (`coi-broker-review.v1`) so an
  upload token can never be replayed as a review token, and the payload is
  ONE `coiId` — a forwarded link never widens. 45-day TTL.
- **`buildBrokerReviewPacket()` IS the disclosure envelope**, and the page
  renders nothing it does not return. IN: the requirements, the verdict per
  requirement, what THEIR certificate shows, the insured, the job name, the
  replacement-value sentence, where to send the corrected one (the existing
  client drop link). OUT: the reviewer's internal note, the per-check model
  prose (it names requirements this job may not have — the 2026-09-09 leak),
  the risk level, the stored PDF, the order, any rate, any contact but ours.
- Verdicts are **recomputed on every view**, not frozen at send: a broker who
  opens the link after the desk approved reads "nothing further needed", and
  a production company fixed in HQ clears the named-insured line here too.
  A gear-only job's auto rows stay NA, so we never ask a broker for coverage
  this job does not need.
- **The sample certificate rides along** (Wes 2026-09-17: "we may want to
  also add a copy of our sample COI to broker") — the same ACORD the portal
  and the Forms menu offer, `SAMPLE_COI_PATH` in requirements.ts, absolute on
  the marketing origin so it resolves from any host or inbox. **Gated on
  `SiteSetting.formCoiUrl` being set on BOTH surfaces**: `/api/public/forms/
  [slot]` 404s until an admin uploads the PDF, so the page offers nothing
  rather than a dead link and `brokerReviewLinkLines({ hasSample })` names it
  in the email only when one is on file. A broker matching a document beats a
  broker matching a paragraph; a broker clicking a 404 costs the round trip
  this feature exists to save.
- `COI_INBOX` ('rentals@') moved into `requirements.ts` — the portal's broker
  email and this page name one mailbox. `npm run test:coi-broker`.
- NOT done: nothing yet nudges when a broker has had the link for days with
  no new certificate, and the broker is not offered on the job page. **The
  "no company-level broker on file" half is now done** — see "A list of
  brokers" above.

## A list of brokers, not just a name on a certificate (2026-09-17 — Wes)
- Wes: "Please start keeping a list of brokers — for example on the Mega COI
  review we sent to the broker, whose name is Barbara Wagner and her email is
  barbara@worthingtoninsur.com." `readCoiBroker()` reads ONE certificate's
  producer box; that is the right home for a fact about a document and the
  wrong home for a LIST. Nothing could answer "who is this client's broker"
  when the producer box did not read — which is exactly the certificate most
  likely to need correcting.
- **Two tables, additive SQL, NEVER `db push`:** `sr_brokers` (one row per
  broker, keyed by EMAIL) and `sr_broker_clients` (which of our clients each
  acts for, and how we learned it: CERTIFICATE / CONTACTED / MANUAL). From a
  phone: /admin/maintenance → **"Create the broker directory tables"**; on a
  laptop `npx tsx scripts/add-broker-tables.ts`. Models `Broker` /
  `BrokerClient` carry **no relations** and the DDL no foreign keys — the
  job-Conversation shape, for the same reason (a live DB with known drift,
  and a constraint that can fail a COI review is worse than a dead link row
  the reader skips). **Until it has run everything behaves exactly as
  before**: every read returns empty and every write is a no-op on P2021/P2022.
- **Two rules carry the weight** (`src/lib/coi/brokerDirectory.ts`, pure half
  in `normalizeBrokerFacts` / `mergeBrokerFacts`, `npm run
  test:broker-directory`):
  1. **The email is the identity.** No readable email, no row — a directory
     keyed on a name a model read off a scan is a list of misspellings that
     looks like a directory.
  2. **A typed fact outranks a read one, and a blank never wins.** MANUAL
     (a person editing /admin/brokers) may REPLACE a field; CERTIFICATE and
     CONTACTED only FILL a blank. Otherwise the next certificate whose
     producer box says "Certificates Dept" silently reverts a name someone
     corrected — wrong in the way nobody notices, because the row still looks
     filled in.
- **It fills itself.** `recordBroker()` runs on the client COI drop
  (`/api/coi/[token]` — the arrival path for most certificates, called AFTER
  the job resolves so a job-only token still files under that job's client),
  on the desk's AI re-run (the path that back-fills older certificates), and
  on `EMAIL_BROKER` with `contacted: true` (the address a PERSON chose, which
  outranks whatever the producer box read — the certificate's name/agency
  ride along only when they belong to that same address). Every call is
  best-effort: a stored COI or a sent email must never be lost to a list.
- **The payoff is on the review desk.** `serialize()` is async now and
  carries `knownBrokers` — the directory's answer for THIS client. The
  compose panel offers them as chips, seeds the To box from the directory
  when the certificate named nobody, and the broker card reads "Not read off
  this certificate — but Barbara Wagner is on file for this client."
- **/admin/brokers** (nav: Admin → Brokers, under COIs) lists them with their
  clients, last seen, and how often we have written. Add and edit by hand;
  removal is `isActive false`, never a delete. Staff-gated, not ADMIN-only —
  the people who chase certificates are sales and billing.
- **Barbara Wagner is seeded, not hardcoded into a code path.**
  `src/lib/coi/knownBrokers.ts` is the registry (the partnerProspects shape);
  /admin/maintenance → **"File the brokers we already know"** or `npx tsx
  scripts/seed-known-brokers.ts --write` files her, matched on email so a
  second run never duplicates. Her client is found by the name hint "mega"
  and linked ONLY on exactly one match — an ambiguous or missing match is
  reported, because a broker filed under the wrong client is how one
  production's insurance question reaches another's agent.
- **Her agency is deliberately BLANK.** `barbara@worthingtoninsur.com`
  obviously suggests "Worthington Insurance", and `COI_PROMPT` tells the model
  in as many words never to infer an agency from an email domain. The same
  guess typed by hand, into the row a rep reads before emailing a stranger, is
  the same mistake with a person's hand on it. It fills itself from the
  producer box of the next certificate she issues.
- NOT done: a broker is never tied to a client from the page (links form
  themselves from certificates and sends, or from the seed's hint); nothing
  merges two rows for one person at two addresses; and the directory is not
  offered anywhere outside the COI review desk and its own page.

## After-hours VEHICLE pickup email (2026-09-10)
- Wes: "an easy button for sales to send this summary" — Jose's hand-typed
  After Hours Instructions (address, Gate 1 code, driver's-license line,
  Vehicle / Plate / Lock Box Code). `JobVehiclePickupPanel` on `/jobs/[id]`
  → `/api/jobs/[id]/vehicle-pickup` → `src/lib/afterHours/vehiclePickup.ts`.
  **The gate code and each unit's `Asset.accessCode` go IN the email** (the
  container flow next to it sends a link instead — different call, on
  purpose). Units = the job's live assignments; no lock box code = 409
  naming the unit; no plate = the row is omitted (0/81 units have a plate
  on file — Fleet page edits it). The old `/vehiclemap` + `/lockbox` links
  are dead and NOT hardcoded; the lock box how-to renders only when
  `SiteSetting.lockboxInstructionsUrl` is set on /admin/assistant (Wes
  9/11; column added by ALTER TABLE, http(s) only). Recorded as AuditLog
  `job.vehicle_pickup_sent`, never on `Job.afterHours*`.
  `npm run test:vehicle-pickup`.

## Text messaging (Twilio) — A2P 10DLC campaign APPROVED 2026-09-10
- Campaign `CMadf71a…` (ACCOUNT_NOTIFICATION) on Messaging Service
  `MGda3482bd81e2c26b45cc188de36124dc`, number (747) 335-1665. Filing,
  keyword replies and the go-live checklist: `docs/sms/twilio-a2p-campaign.md`.
  `KEYWORD_REPLIES` in `src/lib/sms/threads.ts` must match that doc.
- **Sends must go THROUGH the service to count as registered.** Set
  `TWILIO_MESSAGING_SERVICE_SID` and `sendSms` sends `MessagingServiceSid`
  with no `From`; `TWILIO_FROM_NUMBER` is only the fallback. A bare-number
  send from a number outside the service is filtered by carriers (30034)
  with no error at send time. `GET /api/admin/a2p-campaign` reports
  `sendPath` and `service.fromNumberInService`. `npm run test:sms-config`.
- Every outbound goes through `sendTracked()` (STOP honored, quiet hours
  9pm–6am Pacific for automated sends, one `SmsMessage` row per text).
- **The assistant is named AHA** (SirReel After Hours Assistant — Wes,
  2026-09-10). Name, expansion, greeting and SMS intro live in
  `src/lib/assistant/identity.ts`; the prompt, the chat widget, /help, the
  admin page and the nav all import from there. It always says it is
  automated, and texts still name SirReel Studio Services (carrier-filed).
  The keyword replies stay exactly as filed — no name in them.
- **Sender number is a release factor by text** (Wes, 2026-09-10): the
  number a text came from, when on file for a driver OR a production
  contact on a CURRENT job, plus the unit number or VIN last 4, releases
  that job's truck without the job code (`verifyAndRelease.senderPhone`,
  `src/lib/assistant/phoneFactor.ts`, `npm run test:phone-factor`). Scoped
  to the live assignment — a number on another job unlocks nothing. Web
  chat never passes a number; the job-code paths are unchanged.
- **A "no mobile" icon on the staff table** (Wes 2026-09-17, handed
  Julian's cell and then "Who are you missing?"): /admin/assistant flags
  every staff row with no `User.phone`, counts them in the panel summary
  ("4 on call · 3 with no mobile") and says what the blank costs — an
  URGENT job note emails that person instead of texting, and AHA cannot
  recognise their texts as staff. **That table also used to list only
  ADMIN / AGENT / MANAGER**, and it is the sole editor for `User.phone`,
  so Ana (BILLING), Julian and the yard had no way to be reached and no
  way to be given a number; it is every active staff row now, DRIVER and
  CLIENT excluded.
- **AHA knows who is texting, by number, server-side**
  (`src/lib/assistant/senderIdentity.ts`; the model never decides). STAFF =
  active User whose `phone` (set on /admin/assistant, "Mobile (texts AHA as
  staff)") or `emergencyPhone` matches → `staff_lookup_unit` / `staff_lookup_job`
  (who is on Cube 27, has a job come back, drivers + numbers). PRODUCTION
  CONTACT on a CURRENT job (JobContact or booking requester, ±7 days) →
  `my_job_info` + free use of file_callback_request ("wide leeway", Wes).
  Lookups in `src/lib/assistant/lookups.ts`, read-only, never codes or
  pricing. Web chat gets none of this — there is no number to match.
- **"Who AHA recognises" on /admin/assistant** (Wes 2026-09-11: "where do I
  manage what numbers have access to what") — `listRecognizedNumbers()` in
  `src/lib/assistant/recognizedNumbers.ts` lists every number in a tier
  (staff / production contact / checkout driver) with the field it sits in,
  what it unlocks, when it lapses, and a link to the record. It reads the
  SAME predicates as `identifySender` / `verifyAndRelease` so the list is
  the access — nothing is granted there. Change the record it points to.
  `npm run test:recognized-numbers`.
- **AHA greets known people by first name** (Wes 2026-09-11: "Hi, Joelle!"
  the first time, don't overuse it, work it in again after an hour or
  more). Decided SERVER-SIDE in `src/lib/assistant/greeting.ts`:
  `greetingMoment(thread)` reads the thread's last in/outbound BEFORE the
  new inbound is recorded → first / returning (≥ 60 min) / none, and
  `greetingInstruction()` is the prompt block. The name comes from
  `SenderIdentity.firstName` (staff user or matched contact) or
  `identifyNumber().firstName` (partner driver / CRM person). Text only —
  web chat has no number. `npm run test:greeting`.
- **AHA access LEVELS** (Wes 2026-09-11: "whatever they can from whatever
  role they have in HQ", plus add/subtract people by hand). One level per
  sender, resolved in `src/lib/assistant/access.ts`: BLOCKED grant →
  hand-made grant → HQ role (`levelForRole`: ADMIN→admin, MANAGER/AGENT/
  BILLING→staff) → contact on a current job → public. Hand-made rows are
  `AhaGrant` (`sr_aha_grants`, one active row per number, revoked never
  deleted) added on /admin/assistant → "Add a person · or block one"
  (admin only, audited `admin.aha_grant_*`). `SenderIdentity.level` picks
  the tools in `runAssistant`; a BLOCKED number gets a fixed line in the
  SMS route and never reaches the model. **Schema change: run
  `npx prisma db push` (additive: one enum + one table) — until then the
  grant reads fail soft and only the derived tiers apply.**
  `npm run test:aha-access`.
- **ADMIN level = continuity** (Wes: Greyson Bailey is backup CEO; "if
  anything happens to me, AHA can explain everything I've been doing").
  NOT a hidden door — an explicit, audited capability of the admin level:
  `platform_memory(query)` searches CLAUDE.md + SHIPLOG.md + docs/**/*.md
  by section (`src/lib/assistant/memory.ts`, credential-looking lines
  redacted; the markdown is traced into the two routes via
  `outputFileTracingIncludes`), `recent_activity(days)` reads the admins'
  audit log (counts + latest rows, never old/new values). Reached by text
  from an admin-level number, or — stronger — signed in on
  /admin/assistant → "Ask AHA as yourself" (`POST /api/admin/assistant/ask`,
  channel `hq`, level from the session role, audited `hq.assistant_tools`).
  New HQ users: `npx tsx scripts/add-hq-user.ts --name … --email … --role
  ADMIN --phone …` (sign-in requires the row to exist + an allowed domain).
  `npm run test:memory-search`.

## Tent first, accessories next (2026-09-13 — Wes)
- Wes: "Whenever tent, Canopy, pop-up are entered. The order form should
  offer the tent first and the accessories like side walls next." Three
  things buried the tents at once: a sidewall is literally named "Canopy
  Tent Sidewall - 10' Black" so it hit the query on its NAME while the
  seeded "Caravan Canopy, 10x10" hit only via an alias (name evidence wins
  the relevance pass); the tiebreak is "shorter name wins" and the
  accessory names are shorter; and the dropdown caps at 10, so ranking the
  ~30 canopy rows up would push every accessory off the end.
- **One rule, both order forms: `src/lib/sales/tentFirst.ts`** (pure, no
  prisma — the client-facing form bundles it). `isTentFamilyQuery` is the
  gate (tent/canopy/pop-up/ez-up/marquee, however spelled); `tentRole`
  splits SHELTER / ACCESSORY / OTHER off the NAME, testing accessory words
  FIRST because every sidewall row also says canopy and tent;
  `orderTentFirst` reorders and holds `TENT_ACCESSORY_SLOTS` (3) back so
  the accessories survive the slice — "next" only means something if they
  are still on the list. Stable within a tier, so "10x10 tent" still puts
  the 10x10 sidewall at the front of the accessories.
- **Naming the accessory is NOT a tent query.** "tent sidewall" /
  "canopy sandbags" is a rep who already knows what they want; lifting the
  canopies over their answer is the same burial in the other direction.
- Staff typeahead (`/api/catalog/search`) also does the two things the
  pure rule can't: over-fetches to `TENT_OVERFETCH` (the default
  `limit * 3` stopped inside the canopies), and pulls the
  `tents-accessories` category along on a tent query — "Sidewalls, 10x15"
  is alias-matched on "tent sidewall", and an alias only answers a query
  that COVERS it, so a bare "tent" could never reach it. Companions merge
  in BEFORE the relevance pass and dedupe by id. Client-facing form:
  `rankSearchResults` in `publicSupplySections.ts` takes the tier as its
  primary sort key. Every other search is byte-for-byte unchanged.
- **THREE boxes search this catalog, not two (Wes 2026-09-14, with a
  screenshot).** After the first fix, sirreel.com's hero search still put
  seven sidewalls above the first canopy: `searchPublicSite` in
  `src/lib/site/publicSearch.ts` is its own ranking path — an in-process
  index sorted by placement and then by SHORTER NAME, and every sidewall
  label is shorter than every canopy label. It now takes the same tier.
  When changing how this catalog ranks, change all three: the staff
  typeahead (`/api/catalog/search`), the supply order form
  (`publicSupplySections.rankSearchResults`) and the site-wide box
  (`publicSearch.searchPublicSite`).
- The site-wide box also had to move its `.slice(0, limit)` to AFTER the
  reorder. Slicing to 8 first meant the canopies were already cut before
  anything could rank them, so lifting the tents would only have reordered
  the sidewalls that survived.
- `npm run test:tent-first` — includes the eight rows from Wes's
  screenshot, in the order the live box returned them.

## Sandbags with every tent (2026-09-13 — Wes)
- Wes: "Whenever we rent tents, we want to offer sandbags. So if someone is
  using the order form and chooses tents, make sure the sandbags show in
  the options. Typically it's [four] sandbags per 10 x 10 tent and six
  sandbags per 10 x 15 tent, and eight sandbags per 10 x 20 tent."
- **ONE PER LEG is the rule behind those numbers** — a 10x10 pop-up stands
  on 4 legs, a 10x15 on 6, a 10x20 on 8 — so `SANDBAGS_BY_SIZE` in
  `src/lib/sales/tentSandbags.ts` is a TABLE, not arithmetic: no formula
  over width × length gives all three AND an 8x8 (4 legs, not 3.2). An
  unlisted size offers NOTHING rather than a guess — a rep who sees no
  offer asks; a wrong count ships.
- **All four counts are CONFIRMED (Wes 2026-09-14: "10x10 is four, 8x8 is
  four — confirmed").** Two of them shipped as inferences and are worth
  knowing about: the 10x10 arrived dictated as "it's for sandbags" and was
  read as FOUR, and the 8x8 Wes never named — it was inferred from the four
  legs it shares with a 10x10. Both turned out right. Nothing in
  `SANDBAGS_BY_SIZE` is an open assumption now.
- **OFFERED, never auto-added.** Sandbags are billable and tents get staked
  instead on some locations, so the count is computed for the rep and the
  decision stays theirs. This is deliberately NOT `InventoryKitPiece`
  (which would auto-add and bill, even though it supports `CHARGED`).
- `tentFootprint()` reads the six ways the catalog spells one size
  ("10' x 15'", "10x15", "-10' x 10'", "10' x 20," and the typo'd "8' x '8").
  Gated on `tentRole() === 'SHELTER'` from tentFirst.ts, which is what keeps
  "Sidewalls, 10x15" — a footprint that is NOT a tent — from asking for its
  own ballast.
- WHICH bag is a catalog question, resolved server-side by
  `GET /api/catalog/tent-sandbags` (never a pinned code): prefers the
  `tents-accessories` category, cheapest daily rate first, so the 25 lb is
  the default and the 35 is a retype. Applies `companyId=` negotiated rates
  like /api/catalog/search does.
- UI is `src/components/orders/TentSandbagOffer.tsx`, silent unless there is
  something to offer. `/orders/new` renders it through the existing
  `rowExtras` hook and splices the line directly UNDER its tent with that
  tent's dates; `/orders/[id]`'s add-line modal STAGES it and posts it as a
  second line only after the tent line lands.
- **Ballast is per tent, so suppression is per tent** — sandbags already on
  the quote do not answer for a second tent. /orders/new tests the row
  directly below (where the offer inserts); the modal asks per add.
- `npm run test:tent-sandbags`.

## AHA sends the lock box photo (2026-09-13 — Wes)
- May, a contact on Miki's job, could not get the vehicle lock box open; Jose
  hand-typed the steps and texted her a photo of the keypad with the two
  buttons arrowed. Wes: "I think we should incorporate this into AHA's
  capabilities. Is she able to send a photo like this to the Driver?" She can,
  by MMS.
- **One source of truth `src/lib/site/lockboxGuide.ts`** — Jose's sentence
  verbatim (`LOCKBOX_STEPS`), the photo, the troubleshooting. AHA's prompt,
  the MMS caption and the public page all read it, so they cannot drift.
- **The photo is PUBLIC on purpose** (`public/help/lockbox-keypad.jpg`, served
  at `/help/lockbox-keypad.jpg`). Twilio fetches an MMS attachment itself,
  unauthenticated, so a private-blob proxy URL 403s and the picture silently
  never arrives. Safe because the image is a keypad with arrows — **no code
  may ever be baked into it, rendered on `/help/lockbox`, or put in a
  caption.** Codes still come only from `verifyAndRelease`, one per message.
- **Two triggers, both server-side.** `send_lockbox_photo` (SMS channel only,
  no arguments, releases nothing) is offered to the model for "it won't
  open"; and a RELEASED lock box code over text is followed by the photo
  automatically, at most once per number per 24h — deduped off the
  `[photo: lock box keypad]` marker `sendTracked` writes into the recorded
  body. The model never picks a URL. Audited `assistant.lockbox_howto`.
- **The caption carries the link, always.** MMS on a 10DLC number is a
  per-number capability and a carrier may drop media on a message it still
  delivers; a refused MMS is re-sent at once as plain text. `GET
  /api/admin/a2p-campaign` reports `service.mmsCapable`.
- `sendSms`/`sendTracked` take `mediaUrls` (non-`https://` entries are
  DROPPED — a bad MediaUrl fails the whole message, text included).
  `/help/lockbox` is a static segment, so it wins over `/help/[slug]` and
  needs no SetupGuide row. `npm run test:lockbox-howto`.

## Second holds & LiteHold — pick the position when you create it (2026-09-16 — Wes/Jose)
- **Two different things wear `holdRank >= 2`, and Wes named the second one
  LiteHold** (2026-09-16: "I don't want to call them 'Student Holds' let's
  call them LiteHold"):
  - **2nd / 3rd Hold** — a QUEUE POSITION behind a production that has the
    unit. You want it; somebody got there first. Keeps the desk's own words
    (Wes 2026-09-09). Reached from the board's "+ Nth hold on this unit" and
    from the over-capacity escape.
  - **LiteHold** — placed behind DELIBERATELY with nothing ahead, typically
    at a reduced rate (Jose's student projects at 50%). It yields: any later
    reservation books straight past it. Reached from the create-time choice.
- **Nothing in the DB separates them** — both are a rank ≥ 2 BookingItem.
  The distinction is carried in the UI only: `queuedBehindSomebody` state in
  NewHoldModal, `rowQueue(r).incumbents.length === 0` in
  MakeReservationModal. So the timeline chip still says "2nd", and no report
  can count LiteHolds. Giving LiteHold its own marker is the same schema
  change as the tentative-hold concept below — do them together or not at all.
- Jose: "there is no way for me to create second holds for vehicles or
  stages." The queue shipped 2026-09-09 (`BookingItem.holdRank`, 1st/2nd/3rd,
  /rank, /promote, the backup sub-lane). What was missing was a door.
- **On the board:** the only gesture that opened NewHoldModal in backup mode
  was `openHoldOnAssetRow`, which infers backup from "the clicked date is
  already booked" — but a booked date is covered by its own bar, whose
  onClick stopPropagation's. Row 32px, bar 24px at top:4 → the whole target
  was a 4px sliver. The selected reservation now carries the action itself
  ("+ 2nd hold on Cube 27"), seeded with that bar's unit/class/dates. The
  rank in the label runs the SERVER's arithmetic (deepest live rank across
  the CATEGORY over the window, +1), so it reads "3rd" when a 2nd already
  exists elsewhere in the class, and at `MAX_HOLD_RANK` it explains instead.
- **Stages made it urgent:** Lankershim's three rooms share ONE class, so
  wanting a specific stage that is taken never reads as the class being
  full — `MakeReservationModal`'s queue panel is gated on `rowAtCapacity`
  and could never fire for it.
- **An over-capacity 409 is no longer a dead end.** The holds route already
  said "place a backup hold" in its own `suggestion`; NewHoldModal renders
  that as a button. `backupMode` is state now, not just the prop it starts
  in, and `submit(bufferOverride, backupOverride)` takes it explicitly.
- **REVERSES "only present other options when there is a conflict"**
  (Wes 2026-09-09). Jose: student projects pay 50% and should START behind
  the queue so a full-rate job supersedes them — a decision made when
  NOTHING is in the way, which a conflict-gated control can never reach.
  Both create paths now offer "Place as 1st Hold / LiteHold"
  unconditionally (`quietRankChoice` in MakeReservationModal, the segmented
  control in NewHoldModal). **The default is unchanged — rank 1** — which was
  the other half of the 9/9 rule and stays.
- **A backup takes NO unit.** Binding one makes that unit read `booked` to
  `getCategoryAvailability` (the assignments query has no rank filter), and
  the later full-rate hold is then REFUSED with `backup-has-dibs` — the
  opposite of superseding. So a rank ≥ 2 created with no asset skips the
  unit-pick drawer in both modals. Unbound, it consumes no capacity and a
  later reservation books straight past it.
- **An unbound backup used to be INVISIBLE** — no assignment, so no bar on a
  unit row, and `timeline-native`'s unassigned lane filtered to `holdRank: 1`.
  A reservation created as a 2nd Hold appeared nowhere. That lane now carries
  rank ≥ 2 too, in blue ("2nd · Cube Truck · Acme", "queued behind") rather
  than the rose "needs a unit" nag, and the band counts them separately.
- **The unit picker lets a backup point at a booked unit.** `assignUnit`'s
  guard is rank-aware (only rank 1 is refused on a booked unit) but
  AssignUnitsModal disabled every booked candidate, so a 2nd hold could never
  be aimed at the truck it was queued behind. `available-units` returns
  `holdRank`; the drawer reads "Which unit is this hold queued behind?" →
  "Queue behind". A primary still cannot.
- **NOT done, deliberately (Wes 2026-09-16 chose "create-time choice for
  now"):** nothing TELLS anyone when a full-rate job supersedes a LiteHold
  — it just sits at rank 2 with no unit. And a backup that HAS been
  bound to a unit still blocks a new primary on that unit rather than
  yielding. A real "tentative hold that gets bumped" is a different concept
  from "backup queued behind, waiting to be promoted"; this ships the door,
  not the new concept.
- `promoteHoldsOnApproval` in holdOnQuoteSend.ts is dead (no callers) and
  must STAY dead — it updateMany's every rank-2 REQUESTED item to rank 1,
  which would silently promote every LiteHold.

## Action items are labelled by the PICKUP, not the record (2026-09-17 — Wes)
- Wes, with 41 COI rows and 71 replacement-cost rows on his phone: "a ton
  of action items that are persistent on the screen even if their time of
  action has passed … after [a day or two] we need to have them drop off."
  Nothing on the list was old — every provider re-derives its rows on each
  load, so a row exists only while its condition is still true — but the
  row's timestamp was `occurredAt`, the date the RECORD was created (a
  booking made yesterday for a pickup six weeks out read "17h ago").
- **Age-based expiry was considered and rejected**: dropping a live "COI
  missing" at 48h hides the row exactly when the pickup it warns about gets
  close. **The window is measured from the PICKUP.** `ActionItem.dueAt` is
  the pickup; the panel labels the row "pickup in 4d" / "pickup today" and
  the group header "next pickup …"; the registry sorts soonest pickup first
  inside a priority. Items with no pickup (a quiet quote, an untouched
  inquiry) keep the "N ago" label. Rules in `src/lib/actionItems/rules.ts`
  (pure, `npm run test:action-window`).
- **`PICKUP_WINDOW_DAYS = 14`**: COI and card-required show only for
  bookings starting today through +14 days (the SQL says
  `start_date <= CURRENT_DATE + 14`). A COI for a pickup six weeks out is
  not this week's chase and was the bulk of the 41. The day-of-pickup row
  still shows (2026-08-31 ruling); the day after, it is gone.
  Kit-incomplete keeps its 7-day lookahead and now carries `dueAt`.
- **COI is ONE ROW PER JOB** (`groupCoiByJob`): the certificate lives on
  `sr_coi_checks.job_id`, so a job with two bookings was the same ask twice
  (Digital Paradigm, in the screenshot). The item is keyed on the LEAD
  booking — the soonest pickup, ties by id — so a `coi:<bookingId>`
  dismissal recorded before the merge still matches for the usual
  one-booking job. A `coi_received` on ANY of the job's paperwork rows now
  settles the whole job (it used to settle only its own booking).
- **Replacement cost is three shapes, not 71 rows**
  (`splitReplacementGroups`): a VEHICLE row going out inside 7 days is its
  own HIGH item (same `replacement-cost:item:<id>` key as before); every
  other catalog row folds into ONE item `replacement-cost:backlog`
  (low, medium while something in it goes out inside the window — it never
  lights the red badge) linking to
  `/inventory/wizard?view=value&upcoming=1`; free-typed lines fold into ONE
  agent item `replacement-cost:free-typed` linking to the soonest order.
  The wizard's new "On upcoming orders" chip / `?upcoming=1` on
  `/api/inventory/items` is the same predicate (no catalog cost, no priced
  RentalWorks unit, a line on a live not-yet-returned order), soonest
  pickup first — so the queue IS the backlog the panel counted. The
  backlog's dismissal key is fixed: "Mark handled" hides the chore for
  that user until they clear the dismissal; a changing count does not
  bring it back, the urgent rows still surface on their own.
- NOT done (Wes chose 1, 3, 4 of the four): a 30-day backstop on the
  past-event providers (quote-aging, inquiry-untouched, payment-info,
  annual-requested, duplicate-job, driver-hours, partner-photos) — a quote
  quiet for 90 days still sits there until the job is marked lost.

## Sign-in is gated on the DOMAIN, not on having an account (2026-09-11)
- Hugo: warehouse@ "is presenting as a sales view". It was: the NextAuth
  `signIn` callback checks `isAllowedEmailDomain(email)` and NOTHING
  else, so ANY @sirreel.com Google account reaches a session whether or
  not a `User` row exists. The `session` callback only sets `role` when
  it finds a row, and the dashboard layout read the absence as
  `UserRole.AGENT` — the SALES surface (client contacts, pricing, CRM)
  for an account nobody provisioned.
- Fix: the session callback stamps `provisioned = !!dbUser`, and the
  layout renders "This account isn't set up yet" + Sign out instead of a
  department. The `|| UserRole.AGENT` fallback stays for a row that
  somehow has no role, but it is no longer reachable by a missing row.
- The DATA was never exposed — every API route looks the row up by email
  and 401s. Only the shell lied. Still: adding a login is
  `scripts/add-hq-user.ts`, and a Google account on the domain is NOT an
  HQ account.
- `add-hq-user.ts` takes WAREHOUSE / FLEET_TECH (a shared desk: yard
  screens, no pricing or client contact) and `--like <email>` copies an
  existing user's role. The check-in desk is `cpr@sirreel.com`
  (WAREHOUSE, created 2026-09-11). **`warehouse@sirreel.com` has NO user
  row** — it is the mailbox the pull orders are emailed to, which is
  exactly why `--like warehouse@sirreel.com` failed.

## Barcode phase 3 — per-UNIT check-out / check-in (2026-09-11)
- Wes: "integrating the barcode scanners that we have to facilitate
  tracking high value items like CP 200 radios, generators, Hazers etc…
  checking out the orders so much quicker if they can just simply scan."
  Phases 1–2 (2026-09-02) mirrored RW's per-unit register into
  `InventoryUnit` and taught `resolveScan` to read an `SR######` label;
  nothing recorded WHICH unit went on WHICH order. Now:
  - **`OrderUnitScan` (`sr_order_unit_scans`)** — one row per physical
    unit per trip: order, line it was counted against (null = went out
    UNLISTED), `outScannedAt/ById`, `inScannedAt/ById`, `inImplied`,
    void fields. Never deleted — a wrong scan is VOIDED. A unit has at
    most one OPEN row (out, not back) across all orders; enforced in
    `recordUnitScan`, not by the DB. `InventoryUnit` stays a read-only
    RW mirror — nothing here writes to it or to RentalWorks.
  - **Schema change — NOT `prisma db push`** (the live DB carries
    objects no schema file knows; a push offers to drop them — see the
    partner-column rule below). Create the table with
    `npx tsx scripts/add-unit-scan-table.ts` (idempotent additive SQL:
    CREATE IF NOT EXISTS + FKs guarded by name; exits 2 if a
    pre-existing table has a different shape). Until it has run the
    report's scanner panel hides itself (`unitScanSummary` fails soft
    on P2021) and the sheet is typed as before; a POST would 500.
  - **Where scanning happens: the check in/out report**
    (`/reports/orders/[id]?edge=OUT|IN`, the screen the yard board's
    Check out / Check in buttons land on — the floor pulls on paper and
    a supervisor files there, per Hugo). `UnitScanPanel` is an
    auto-focused box a wedge scanner's Enter submits; each scan hits
    `POST /api/orders/[id]/unit-scans` and the line's Out/In number
    FOLLOWS the scan count (`applySummary` in CheckReportForm — only
    lines the scanner touched; withdraw every scan and the line goes
    back to the pre-filled count). `LineUnitStrip` under a barcoded
    line shows "3 of 6 scanned" / "4 of 6 back · 2 still out" and the
    labels behind it, each with a withdraw (void) ✕. A line is
    "barcoded" when its catalog row has ≥1 `InventoryUnit`
    (`unitTrackedItemIds`) — NOT `trackingMode`, which means vehicles.
  - **Decisions are pure** (`src/lib/warehouse/unitScanRules.ts`,
    `npm run test:unit-scans`): catalog code / unknown / unlinked →
    refused, no override; line full → refused, `allowOver` attaches
    over the quantity; not on the order → refused, `allowOver` records
    it unlisted (the report offers "Add as a row"); still open on
    another order → refused NAMING the order, `closeOpen` marks it back
    from there (`inImplied`) and sends it here; IN of a unit never
    scanned out → recorded, not refused (the IN scan is the valuable
    one). Duplicates are 200 with `outcome: 'duplicate'`, never errors.
    Every refusal is a 409 with `reason` + `override`; the panel renders
    the one button that pushes it through.
  - **`/warehouse/units` "Find a Unit"** (nav, all three yard branches):
    scan a label → register row + the order it is open on + recent
    trips. `GET /api/warehouse/units/lookup?code=`. Yard door
    (`requireYardAccess`) on every route, same as the report.
  - AuditLog: `order.unit_scanned_out`, `order.unit_scanned_in`
    (`implied` / `neverScannedOut` flags), `order.unit_scan_voided`,
    entityType `OrderUnitScan`.
  - **Antenna + battery on every walkie** (Wes 2026-09-11: "add antenna
    and battery to pick lists as part of the kit"). Wes's RW sheet
    (order 304656) settles the SHAPE: RW prints them as their OWN lines
    beside `104387 … Radio 15`, which is what the floor counts. So they
    are KIT PIECES — `scripts/seed-radio-parts-kit.ts --write` (FREE,
    `clientVisible: false`; no battery or antenna has a price, only a
    replacement cost). Antenna is 1 per radio body.
  - **BATTERIES ARE ONE POOL, at 1.5 per radio** (Wes: "every battery is
    the same and none have a price… We need to make sure that the
    pickers count correctly each direction"). One in each body + a spare
    per two, rounded up: 15 radios → **23 batteries**. NOT a 1:1 row
    beside the old 0.5 `CP200-BATTERY` spare row — two rows for one
    physical object make a return uncountable, because nobody can say
    which pile a returned cell came from. The seed DEACTIVATES the
    legacy spare's kit links on those radios (journaled, reversible by
    id; the item row itself is left alone) and moves its "spare battery"
    aliases onto `102930`. The kit note prints under the line on the
    sheet so the picker knows where to look: 15 in the bodies, 8 loose.
    `npm run test:kit-pieces` pins the totals AND proves one pool equals
    the old body+spare split at every size. The Surveillance Kit is NOT
    seeded — on that sheet it is what the client ordered.
  - **Per-unit checks** are the second half ("each walkie needs to
    confirm those") and are a DIFFERENT mechanism, for parts that never
    get their own line: `InventoryItem.unitChecks String[]` (drawer
    field "Per-unit checks"; `scripts/seed-unit-checks.ts`). Printed
    under the line as "Each unit: ( ) X × N" — but `renderPickListPdf`
    SUPPRESSES a check whose name already appears as a line on the same
    sheet, so seeding both antenna sources never prints it twice. At the
    desk every landed scan shows the checks as chips
    defaulting to present; a tap marks one missing → `PATCH
    /api/orders/[id]/unit-scans/[scanId]/checks` → `OrderUnitScan.
    missingOut / missingIn` (names, clamped to the item's list by
    `clampMissing`). The report form writes the exceptions into the
    line note behind a fixed prefix ("Came back without: SR004674
    Antenna") so the agent sees it on the filed sheet; Find a Unit's
    history shows them. **Columns via `scripts/add-unit-checks-columns.
    ts` (additive SQL) — run BEFORE deploying: `unitScanSummary` treats
    a missing column like a missing table and hides the panel.**
  - NOT done: the pick-list floor (`/warehouse/pick/[id]`) still records
    only `PickListItem.scannedCode`; no write-back to RW; no camera
    scanning (wedge/keyboard only, as before).
## Walk-around photos: date on every frame, Save, out-beside-back (2026-09-17 — Hugo)
- Hugo's three notes on the Damage ID build (HQ's vehicle check in/out,
  `/reports/vehicles` + the filed record `/reports/vehicles/[inspectionId]`):
  time and date at the bottom of each photo; save a photo from HQ for a
  damage report; scroll through check-out and check-in photos side by side.
- **One wording for a photo's time: `src/lib/fleet/photoStamp.ts`** (pure).
  `photoStampWhen` ("Sep 16, 2026 · 2:14 PM PT", Pacific, says so), the
  short badge form, the numbered slot title ("5. Driver side rear" — the
  crew's DamageID number), the caption a saved copy carries, and the saved
  file's name (`Cube-27_check-out_05-driver-side-rear_2026-09-16_14-14.jpg`).
  The record page, the compare viewer, the return capture screen's "Out"
  badge and the burned-in stamp all read it. Nothing else formats a
  photo's time.
- **WHICH time changed underneath.** `InspectionPhoto.createdAt` used to be
  the moment the whole form was FILED (`createMany` at finalize), so every
  photo on a walk-around carried the same time to the minute. All four
  attach loops (staff check-out/return routes, driver `selfCheckout` /
  `selfReturn`) now write `createdAt: blob.uploadedAt` — the moment the
  photo landed in the store from the yard, seconds after the shutter for an
  in-app shot, server-of-record. No schema change. Older rows keep the
  filing time; nothing reads camera EXIF on purpose (the phone's word).
- **Save = a stamped COPY, never the original.** `GET /api/fleet/photos/
  [photoId]?download=1` reads the private blob, draws the caption along the
  bottom with `@napi-rs/canvas` (`src/lib/fleet/stampPhoto.ts`) and the
  Liberation Sans Bold that pdfjs-dist ships (a lambda has no system fonts
  — text drawn with none is silently blank; both traced into the route in
  next.config.js), and returns it as an attachment. HEIC or any decode
  failure → the raw file under the same good name (`X-Photo-Stamped: 0`).
  **`loadImage` applies EXIF orientation itself** — do not apply it again
  (the first cut did, and portrait shots came out upside down).
- **Out beside back: `/reports/vehicles/[inspectionId]/compare`** (+
  `?slot=`), `WalkaroundCompare` over `buildCompareRecord()` in
  `src/lib/fleet/comparePairs.ts` (pure). Check-out is ALWAYS the left frame
  whichever end was opened; Julian's slots in walk order, then each end's
  close-ups and extras (out first). Arrow keys, filmstrip, Save on each
  frame. `filedInspection().counterpart` now carries its `inspectorName`,
  `damagePhotos` and `otherPhotos` for it. Read-only, yard-gated.
- **Julian's check-in side-by-side was ALREADY this, in four places
  (2026-09-17: "at checking in of the vehicle, the fleet team takes the
  same photos they took on checkout prep … damage id would position the
  photos side by side in a check in report").** Do not build a fifth.
  (1) DURING check-in capture, `InspectionReturnForm` passes
  `compareTo={checkout?.photos}` and GuidedPhotoCapture renders the
  check-out shot directly ABOVE the button that replaces it, so the tech
  photographs how it is while looking at how it was; (2) the filed record
  shows each slot beside the other end; (3) `/compare` is the large
  one-angle-at-a-time viewer; (4) the condition report PDF pairs out/back
  per slot. What was genuinely missing was the DOOR: the post-check-in
  screen offered the PDF and the filed record but not the comparison, so
  it was two taps through a page nobody was aiming for. "Compare out vs
  back" now sits on the screen the crew is already standing on.
- `npm run test:photo-stamp`.

## The driver's copy of the checkout sheet, on their phone (2026-09-17 — Wes/Julian)
- Julian's blind-pickup process: check the vehicle out the day before,
  fill the sheet, "leave a copy of the checkout sheet inside the assigned
  vehicle." Wes: "give the drivers a link to the PDF checkout … much
  better for them to have it on their phone." That paper copy was the ONLY
  thing putting the recorded condition in the driver's hands — the driver
  page showed them a photo COUNT and never an image, the self-checkout
  confirmation email goes to the `driver-checkouts` HQ channel and not to
  them, and their return card was never given the `compareTo` the STAFF
  return form has.
- `GET /api/drive/[token]/condition-report` — same `buildInspectionReport`
  + `ConditionReportDocument` as the yard's route, so the driver's copy
  cannot drift from the record it copies. Token is the credential (404
  invalid / 410 expired / 409 cancelled), scoped to the one assignment.
  Shown on the page as "Vehicle condition → Open the checkout sheet".
- **FOUR things it must never carry, and does not:** the DRIVER'S LICENCE
  photo (`buildInspectionReport` filters `DRIVERS_LICENSE` out of every
  side on purpose), the lockbox/gate CODE (the report has never read
  `Asset.accessCode`; codes reach a driver only through the earned-and-
  unlocked path on the page), anyone else's rental, and **anything about
  the CHECK-IN**.
- **The driver's copy is the CHECK-OUT sheet ONLY (2026-09-17 — Wes:
  "typically we deal straight with production for damage reporting — do
  not need to send to driver after return").** `checkoutSideOnly()` in
  inspectionReport.ts strips `back`, every pair's `back`, the check-in
  damage close-ups and extras, `milesDriven` and `newDamage` — which that
  file's own comment calls "what the renter is actually being told about"
  — before the driver route renders. **A driver's link lives 45 days**, so
  without this the person who drove the truck could read the damage found
  at check-in before the production heard it. Damage is a conversation
  with the PRODUCTION; the driver is not a party to it. The availability
  count on the page is `type: 'CHECKOUT'` for the same reason: a vehicle
  with only a RETURN on file has nothing to show them. Pre-existing damage
  recorded at CHECK-OUT stays — that is what they received.
  `npm run test:driver-report-scope` sweeps EVERY field for check-in
  markers, so a `back`-shaped field added later fails there rather than
  quietly reaching a driver. Nothing is emailed to a driver after a return
  either — `selfReturn` mails the `driver-returns` HQ channel.
- **NOT gated on blind** — Wes said drivers, not blind drivers, and a
  staffed pickup's driver having the sheet costs nothing. Gated instead on
  a walk-around actually being FILED on the assignment (staff's or the
  driver's own); a link to an empty sheet is worse than no link.
- **`inspectionReportSendingEnabled()` stays dark and is NOT consulted.**
  That gate is about EMAILING the RENTER a report; handing the person
  driving the truck the sheet that used to sit on its passenger seat is a
  different act. Do not wire this route to that flag, and do not wire that
  flag on to ship a driver copy.
- Julian's day-before staff walk-around is UNCHANGED and still not gated on
  blind anywhere. The driver's four sides remain additional, and on a blind
  pickup they still merge onto the same CHECKOUT Inspection
  (`adoptedStaffInspection`). **Caveat if both happen: FRONT and REAR are
  the same slot on both lists and the record page renders the NEWEST photo
  per slot**, so the driver's pair displays over the staff's from the day
  before (both are stored; the earlier pair is not visible in the slot grid
  or the compare view). The driver's other shots (DRIVER_SIDE,
  PASSENGER_SIDE, ODOMETER, FUEL_GAUGE, INTERIOR) are legacy slots outside
  Julian's 23 and do not collide.
- **Drivers are only asked for photos on an UNPLANNED pickup (2026-09-17 —
  Julian: "we have no need to prompt drivers for checkout photos unless for
  some reason it is an unplanned pickup").** His process walks the vehicle
  around the DAY BEFORE, so on a planned blind pickup the condition is
  already on file before the driver is near the truck and four more sides in
  a dark yard buy nothing — they also DISPLACE the yard's front and rear on
  the filed record (same slot ids, newest wins). "Unplanned" is NOT a flag
  anyone sets: it is DERIVED from whether a CHECKOUT Inspection filed by
  SIRREEL (`inspectedByDriverId: null`) exists on the assignment. None =
  nobody got the chance = the four sides stay required, because that truck
  would otherwise leave with no record either direction.
  `driverCheckoutDuty()` in `src/lib/drivers/selfCheckout.ts` is the pure
  rule; `selfCheckoutState` and `completeSelfCheckout` both read it, and the
  server re-reads the fact rather than trusting the page — this is the gate
  that lets a truck leave. Mileage follows the same logic (the yard's
  overnight reading stands). **Photos are never taken AWAY, only
  un-demanded** — every slot stays offered, because a driver who finds fresh
  damage in the yard must be able to shoot it, and the notes line records
  which way it went. `npm run test:driver-checkout-duty`.
- NOT done: the driver's RETURN card still has no before/after (the staff
  form's `compareTo`), and nothing warns that a blind pickup is hours away
  with the driver's invite undelivered, never opened and no inspection
  filed — there is no action item for blind-pickup readiness and the fleet
  Today board carries blind + inspection state but no driver-link state.

## Job welcome email — "here is your link" (2026-09-11)
- Wes: after the team replies with a quote, "remind us to send the welcome
  email" — on the job tile or page or both. Both: the /jobs tile carries a
  "Send welcome email" chip and the job header carries the button
  (`JobWelcomeButton`, beside + New quote), loud while DUE.
- **DUE = a quote is out on a live order that has NOT gone out yet
  (QUOTE_SENT → LOADED_READY), within 30 days, no welcome sent, AND a
  pickup date (order window start or booking start) is today or later**
  (Wes: "only propose sending to future pickup date clients"; no date on
  file = nothing proposed);
  `welcomeSignal()` in `src/lib/jobs/welcomeReminder.ts` is the ONE rule —
  the tile (`/api/jobs` → `welcome`), the button (`GET /api/jobs/[id]/welcome`)
  and the send all read it. "Sent" is AuditLog `job.welcome_sent` on the
  Job (no column); a re-send is a newer row.
- The email (`src/lib/email/templates/jobWelcome.ts`) is Wes's wording,
  verbatim, seeded into the review modal's box (`defaultJobWelcomeBody`) —
  edit or send as is; a blank box still sends it. The "Open your job"
  button is the client's job-page magic link (per-contact, 7 days, no
  login), minted at send on the newest live order with a `portalSlug`;
  no portal order → 409 "send the quote first". Modal kind `job-welcome`,
  routes under `/api/jobs/[id]/welcome/{,preview,send}`, delivery label
  `job-welcome`. `npm run test:welcome-reminder`.
- NOT the pre-job "Welcome / Job Begin" invite (`/api/sales/welcome`,
  inquiry-scoped, mints the order on click) — that one is for leads
  before a job exists; this one is for a quoted job.

## Email never changes a job on its own (2026-09-11 — Wes)
- **2026-09-13 (Wes): the SUGGESTIONS are gone too.** "All of these AI trying
  to figure out what the emails are about and suggesting actions is
  unnecessary. It clutters up the screen and … it'll lead to this being
  confusing." Removed: `JobEmailSignalsCard` on the job page, the
  `email-change-signal` action item, the `/api/jobs/[id]/email-signals`
  routes, and BOTH `detectJobChangeSignals` call sites (pubsub ingest +
  post-extraction) — no new `sr_job_email_signals` rows are written. The
  table, enums, `classifyChangeSignal()` and its test stay, used only by the
  manual `scripts/brief-email-crosscheck.ts`. Do not re-surface AI readings
  of client email as cards or action items. The rule below still holds: a
  person reads the email and applies any change through the existing
  controls.
- Wes: "there can be nuance in a client's cancelling or changing of a
  job — we want to make sure that any changes to HQ are gated with a
  confirmation or suggestion." **Rule: no code path may change a Job,
  Order, Booking, hold or assignment because of what an email SAYS.**
  Email may raise a suggestion; a person applies the change through the
  existing controls (Mark lost, status menu, order dates).
- The suggestion is `JobEmailSignal` (`sr_job_email_signals`, kind
  CANCEL / HOLD / DATE_CHANGE / EXTEND / RETURN_EARLY / ADD_ITEMS /
  REMOVE_ITEMS, status OPEN → CONFIRMED / DISMISSED). Add-ons ("a couple
  of fans") and drops ("cancel the fans, keep the cube") are ORDER
  changes: the rep edits the line items; a bare "cancel the cube" reads
  as a drop, and whether it is the whole job is the rep's call. `src/lib/email/jobChangeSignals.ts`:
  `classifyChangeSignal()` is the pure read of the words + the reply
  classifier + the extractor's messageNature, evidence quoted verbatim;
  `detectJobChangeSignals(messageId)` ties the message to LIVE jobs
  (thread.jobId / JobContact email / company website domain / order
  number in the subject) and upserts one row per (job, message). Runs
  from the pubsub ingest and again after extraction. Shown on the job
  page (`JobEmailSignalsCard` — Mark lost… opens the same modal as the
  menu; Handled / Not a change resolve the row, audited
  `job.email_signal_*`) and in Action Items (`email-change-signal`).
- `applyReplyClassificationToCadence` no longer marks an order LOST on
  EXPLICIT_REJECTION — it pauses the cadence and leaves the LOST call to
  the human. (It was dead anyway: `EmailMessage.companyId` is never
  written at ingest, so the bridge always returned `no-company-link`.)
- `scripts/brief-email-crosscheck.ts` is the manual version of the same
  read: the jobs a "Today at SirReel" brief named, against the last N
  days of client email, flagged with the same classifier. Read-only.
- **Schema change: run `npx prisma db push` (additive: two enums + one
  table). Until then every write/read of the table fails soft** — no
  suggestions, nothing else affected. `npm run test:job-change-signals`.

## Replacement value for the client's COI (2026-09-11)
- The insurance requirements ask brokers for "Misc Rental Equipment …
  totaling the replacement value of rented equipment"; HQ now SAYS what
  that value is. `src/lib/coi/replacementValue.ts` derives it on read
  from VEHICLE + EQUIPMENT lines (kit pieces in; fees, discounts, labor,
  EXPENDABLES out): reserved unit's `Asset.currentValue`/`purchasePrice`
  → `InventoryItem.replacementCost` → max `InventoryUnit.replacementCost`
  (RentalWorks register) → dearest active asset in the vehicle class.
  `complete:false` means the total is a FLOOR and every surface says
  "at least $X — N items still being valued". Never store it.
- Surfaces: order page card + job page (inside the COI section, both
  money-gated), portal `CoiRequirementsBlock` and the broker email
  (`replacementValueSentence()` is the one wording). Action item
  `replacement-cost-missing` is one row per CATALOG ROW (high = vehicle
  row going out within 7 days); `/inventory?item=<id>` opens the drawer.
- At launch no vehicle carried a value anywhere (0/81 assets, 0/12
  VEHICLES rows) — price those 12 rows first. `npm run test:replacement-value`.

## Partner portal — second partner, first EQUIPMENT partner (2026-09-10)
- **PowerTrip Rentals** (Evan Crawford, CEO; powertriprentals.com; Signal
  Hill / Long Beach) is the second partner after King Kong, and rents
  generators, distro, HVAC, lifts, temporary lighting and carts — delivered
  and set up, no driver on set. The whole partner system was vehicle-shaped
  (drivers, hours, "Partner Vehicle Agreement", one "Motorhomes & Location
  Trailers" section), so it now carries a KIND:
  - `Vendor.partnerKind` (VEHICLES | EQUIPMENT, default VEHICLES) picks the
    words on the partner page, the welcome email and the agreement body.
    Read it through `partnerVocab()` in `src/lib/sub-rentals/partnerKind.ts`.
  - `Vendor.catalogSection` + `SubcontractedVehicle.catalogSection` (override)
    put listed units under a category section on /vehicles — registry in
    `src/lib/site/partnerSections.ts`, anchors `#power`, `#lifts`, `#hvac`…
    A section renders only while a signed partner has a listed unit in it.
  - `SubcontractedVehicle.defaultReceiveMethod` (PICKUP | DELIVERY) seeds
    `SubRental.receiveMethod` when a unit is quoted, which is what decides
    whether the partner's booking page asks for a DRIVER or a DELIVERY
    CONTACT (the delivery-contact card already existed for restroom
    trailers). The account page's alerts follow it (no "driver needed" on a
    delivered generator).
  - The standard agreement route files `vendorAgreementFor(kind)`: the
    Partner Equipment Agreement (`vendorAgreementEquipmentClauses.ts`) keeps
    the vehicle document's structure and numbers; clause 4 is GL +
    inland-marine instead of auto, clause 7 is Delivery/Setup/Service
    instead of Drivers. Wes to read once before it goes to Evan.
- **Onboarding (ran 2026-09-09, journal `journals/onboard-power-trip-*.json`):**
  `npx tsx scripts/onboard-power-trip.ts [--email … --phone …]` upserts the vendor, seeds a placeholder roster
  across their categories (rates EMPTY — Evan proposes from his page;
  unlisted until photos + signature), mints the account link, journals ids.
  Then on /crm/portals#partners: set the deal, file the standard agreement,
  email the link. The Portals partner list now includes partners with roster
  units or a minted link, not only ones with bookings.
- `npm run test:partner-kind` guards the vocabulary, section grouping,
  agreement variant and welcome-email wording.
- **Partner photos are live at once, HQ is told (Wes 2026-09-11).** Evan adds
  photos from his page (`UnitPhotosForm`, shipped in `41965af`); they reach
  sirreel.com the moment the unit is listed and the agreement is signed, no
  approval gate. `notePartnerPhotoAdded` stamps
  `SubcontractedVehiclePhoto.uploadedByPartnerAt`, emails the vendor-portal
  channel once per 10-minute burst, and the `partner-photos-added` action
  item (one per unit) stays until HQ presses "Looks good" (`reviewedAt`) on
  the roster unit page or removes the photo. Columns via
  `scripts/add-partner-photo-columns.ts` (additive SQL); everything fails
  soft until it has run. `npm run test:partner-photos`.
- **Utliiz is NOT offered to partners (Wes 2026-09-11):** "focus on using
  this tech to aggregate partners into our sales and take a smaller piece…
  I don't want them to have the tech so they can't compete with our client
  service." `PARTNER_HQ_OFFER = false` in `src/lib/hq-white-label/product.ts`
  closes the account-page strip, the /vendor/account/[token]/hq landing
  page, the start-trial route and the /hq/[token] shell (VerMar support view
  still opens). The white-label code stays parked; flip the flag to restore.
  Partner emails never carried a Utliiz link — only the turquoise accent,
  which stays (it is the brand accent now, not a foreshadow).
- **Do NOT `prisma db push` for the next partner column.** 2026-09-10: the
  live DB carries `sr_job_locations` and nine `sub_rentals` columns that no
  schema file knows; a push from a checkout drops them. Add columns with
  additive SQL (see the specialty-vehicles commit `029d94e`).

## Partner prospects — nobody is onboarded until they reply and Wes marks them (2026-09-11)
- Wes: "no company gets onboarded until they reply and I mark it as a new
  partner." Stage is DERIVED in `src/lib/sub-rentals/partnerStage.ts`:
  **prospect** (Vendor row + `partnerProspectAt`, so the introduction can be
  sent; no roster, no link) → **introduced** (`welcomeSentAt`) → **partner**
  (`partnerMarkedAt`, Wes's mark). Legacy partners (King Kong, PowerTrip)
  read as partner by roster units / bookings / agreement — a minted link
  alone is not that. `markAsPartner()` (POST `/api/vendors/[id]/mark-partner`,
  Wes-only allowlist, AuditLog `vendor.partner_marked`) seeds the starter
  roster from the registry, mints the account link, and `sendVendorInvite`
  refuses below partner. The Portals row shows a Prospect / Introduced chip
  and the panel carries "Mark as new partner" between the introduction and
  the account link.
- **Columns by additive SQL, not db push:** `npx tsx
  scripts/add-partner-prospect-columns.ts` once. Until then everything fails
  soft (no prospects listed, link gated on the introduction alone, the mark
  refuses and names the script).
- The registry is `src/lib/sub-rentals/partnerProspects.ts` (plain data).
  First cohort (2026-09-10, LA battery power, ranked): **Saniset Fleet**
  (Van Nuys, CleanGEN J250 250 kWh — lead), **Pig Pen Rentals** (LA County,
  battery is a side line of a toilet/fence renter), **GreenLite Trailers**
  (Agua Dulce, Moxion 600/75 530 kWh — also rents star trailers, so part
  competitor), **Greenwave Rentals** (Voltstack fleet, Vancouver HQ with an
  LA service area — not LA-based). Emails seeded only where quotable.
- `npx tsx scripts/onboard-battery-partners.ts --list | --only <slug>… |
  --all [--dry] [--email slug=… --phone slug=…]` queues PROSPECTS ONLY (the
  Vendor row + `partnerProspectAt`; journals the id). Then /crm/portals#partners:
  introduction (Wes) → they reply → Mark as new partner → deal → standard
  Partner Equipment Agreement → email the link. Nothing has been run yet.
- The introduction (`buildIntroDraft`) is first contact in Wes's words
  ("It's Wes Bailey from SirReel…", feature / order / confirm / deliver /
  bill / pay, "both parties", "win/win!"), signed name / Founder & CEO |
  SirReel Studio Services / M: (User.phone, dotted) / E:.
  `scripts/set-user-phone.ts` sets the phone.
- `npm run test:battery-candidates` guards the registry; `npm run
  test:partner-stage` guards the stage rule.

## Partners vs vendors — two words, two tabs (2026-09-11 — Wes)
- Wes: "Vendors are companies that serve SirReel: plumber, electrician etc.
  Partners provide services for clients along with us." King Kong,
  PowerTrip, Transpo and the battery candidates are PARTNERS. Staff- and
  partner-facing copy says partner; `Vendor` stays the model/table name
  (renaming it is not worth the churn).
- /crm/portals has a **Partners** tab (`#partners` — the old tab, partner
  accounts + unit links) and a **Vendors** tab (`#vendors` — active Vendor
  rows that are not partner accounts; no portal link yet, just who to call).
  `#vendor` (every link written before today, incl. sent emails) lands on
  Partners — `FROM_HASH` in PortalsTabs.tsx. Link new code to `#partners`.
- Every Partners/Vendors row shows the main contact with mailto/tel. The
  partner's own page has a "Your SirReel contact" card from
  `Vendor.sirreelContactUserId` (null = Wes, with his signature title), picked
  on the Portals row; resolve via `sirreelContactFor()`. Column added by
  targeted ALTER.

## Who is collecting a will-call unit (2026-09-15 — Wes)
- The "it's a go" note promises SirReel will say who is picking the unit up;
  nothing kept that promise. `SubRental.collectorName` (+ setAt / notifiedAt,
  additive SQL `scripts/add-collector-columns.ts`) records it.
- `setCollector()` in `sub-rentals/collector.ts` is the ONE path: refuses
  anything but WILL_CALL, no-ops on the same name, emails the partner
  (`buildVendorCollectorNotice`) and texts the opted-in (`partnerSms` kind
  `collector`), stamps `collectorNotifiedAt`, writes AuditLog
  `sub_rental.collector_set`. Clearing is allowed and announces nothing.
- Set by the CLIENT on their portal pickup card (POST
  `/api/portal/job/deliveries/unit` with `collectorName` — that route still
  refuses a call time on a will-call row) or by staff on the job page.
  A NAME only: the partner matches it to a licence and still never gets the
  production's number, company or name.
- `npm run test:collector`.

## Partners can ask to hear about bookings by TEXT (2026-09-15 — Wes)
- `VendorContact.smsBookings` + `smsConsentAt` (additive SQL,
  `scripts/add-partner-sms-columns.ts`). OFF by default and only the PARTNER
  may tick it, on their own page beside the number — the HQ contact routes
  strip `smsBookings` from the body on purpose. Ticking records consent on the
  SmsThread (`recordConsent(phone, 'partner-page')`), which clears an old STOP.
- `textPartnerAboutBooking(subRentalId, kind)` in `partnerSms.ts` fires after
  the hold-request, it's-a-go and released EMAILS — the email is still the
  record, the text is a nudge, and a send failure never rolls anything back.
  Everything goes through `sendTracked` (STOP, 9pm-6am quiet hours, the
  thread log). No production, company, address or rate in the words.
- `npm run test:partner-sms`.

## Pickup at the partner's lot — WILL_CALL (2026-09-15 — Wes)
- Car-rental partners (California Rent A Car): the PRODUCTION picks the unit up
  at the partner's lot and returns it there. Delivery stays possible, arranged
  by the partner with the client through the portal. King Kong keeps drivers.
- `ReceiveMethod.WILL_CALL` + `Vendor.defaultReceiveMethod` (additive SQL,
  `scripts/add-will-call-receive-method.ts`). Default chain in
  `defaultReceiveMethodFor()`: unit → partner → kind. Every creation path sets
  it now — the order line-items route used to leave it null, which read as
  "driven" even for PowerTrip's generators.
- WILL_CALL asks the partner for NO driver: booking page shows "Pickup &
  return" (no location/call time), hold + go notes drop the driver ask,
  account alerts are confirm-only, `notifyLogisticsChanged` skips it. Use
  `usesPartnerDriver()` rather than `!== 'DELIVERY'`. Switch per booking on
  the job page; default per partner on /crm/portals#partners.
- Client portal (same day): `loadDeliveries` returns WILL_CALL rows as
  `handoff: 'PICKUP'` with `pickupAt.address` (booking originAddress, else the
  partner's lotAddress — the one vendor fact read beyond name/permission, and
  only for these rows); the section shows a "You pick up" card with a Maps
  link and hides the drop-off/collection forms when nothing is delivered. The
  per-unit call-time route refuses WILL_CALL. `npm run test:portal-pickup`.
- Still open: HQ can't tell the partner WHO is collecting.
- `npm run test:will-call`.

## Cars & SUVs — a catalog section only (2026-09-15 — Wes)
- `PartnerCatalogSection.CARS_SUVS` ("Cars & SUVs", `#cars-suvs`, right after
  Specialty Vehicles) for California Rent A Car (Culver City; VEHICLES partner
  PROSPECT since 2026-09-15, introduction not yet sent). Specialty Vehicles was
  the only vehicle section and is also a billing class (no LCDW, mileage from
  mile 1) — wrong for a sedan. This one is a HEADING ONLY: no department, no
  pricing rule; a VEHICLES partner's unit still quotes under Vehicles.
- Enum value went in by `scripts/add-cars-suvs-section.ts` (additive ALTER
  TYPE, run before the deploy). Move the vendor's `catalogSection` only after
  the deploy is Ready.

## Photo Shoot Rentals — a department AND a catalog section (2026-09-11 — Wes)
- Wes: "for VSM planet, photo shoot rentals is going to be a new class of
  rentals." It is both a `LineItemDepartment` (own section + subtotal on
  quotes/invoices, department discounts, every picker) and a
  `PartnerCatalogSection` (`#photo-shoot` on /vehicles), value `PHOTO_SHOOT`.
- A partner unit's quote department comes from `partnerUnitDepartment()` in
  `partnerSections.ts`: section PHOTO_SHOOT → PHOTO_SHOOT, else EQUIPMENT →
  GE, else VEHICLES. Catalog search uses it; don't re-derive it inline.
- Billing rule: 3-day week (CAP_PER_WEEK 3) for any gear SirReel owns there;
  partner units bill calendar days regardless (partnerDaily.ts). Lane:
  WAREHOUSE like every gear department — so a PARTNER line there creates a pick
  task for gear SirReel doesn't hold (pre-existing for GE partners too; open).
- Enum values went in by `scripts/add-photo-shoot-enum-values.ts` (additive
  ALTER TYPE, before the code deploy); rows move to the value only after the
  deploy (see memory "enum add before deploy"). A new department touches ~27
  files — grep an existing one (WARDROBE_MAKEUP) and add beside every hit.

## The photo section, built from VSM gear (2026-09-16 — Wes)
- Wes: "let's build the photo section for SirReel using VSM gear." 2026-09-11
  shipped the CLASS — department, catalog section, 3-day week, quote heading.
  Nothing was ever put IN it, so `#photo-shoot` was a heading over an empty
  page: the section on /vehicles renders only while a signed partner has a
  LISTED unit in it.
- **The gear is `src/lib/sub-rentals/photoShootRoster.ts`** (plain data, no
  prisma): 14 units across strobes, modifiers, continuous LED, seamless and
  painted backings, backdrop support, stills grip, a tether cart and a
  medium-format camera kit. Seeded by `npx tsx scripts/onboard-vsm-planet.ts
  [--dry] [--email … --phone … --receive …]` — idempotent, matched on (vendor,
  name), journaled by captured id.
- **What is known vs placeholder.** VSM Planet Rentals (Vic Hartounian,
  vsmplanetrentals.com) is a Hollywood house, 23+ years, ~500 rental types
  "from cameras and backings to Sprinter van packages", specialising in
  **Profoto** — that much is public. The individual units are the SHAPE of
  that catalog, not a stock list: their site is egress-blocked to us, so
  every seeded row carries a staff-only note to confirm model, pack size and
  rate with Vic, and model detail is kept loose ("Pro pack & head kit — 2400
  W/s", never a SKU) so a call CORRECTS a row instead of discovering it was
  invented. **Rates are EMPTY** — Vic proposes from his page, HQ accepts.
- **Their Sprinter Cargo Van Packages ARE ours to sell, and they belong in
  Photo Shoot Rentals** (Wes 2026-09-17: "VSM cargo vans come preloaded with
  gear that we don't carry so keep them"). This file first excluded them as
  competing with our own vans — the GreenLite caveat — which read the VAN as
  the product. It is not: the van is the wrapper and the preloaded package is
  the thing, and none of it is gear SirReel holds. So they are NOT a
  Specialty Vehicle or a Car & SUV; they are a photo package that happens to
  arrive on wheels. **Do not "correct" them back out.**
- **WILL_CALL is the partner default**, set on the Vendor and left NULL on
  every unit so it is one edit on the Portals row. A stills rental house is a
  counter business: DELIVERY would ask Vic for a window and a contact he
  never agreed to, PICKUP would ask him for a driver he does not have.
- **`vehicleType` starts "Photo shoot — " on every unit, on purpose.**
  `/api/catalog/search` matches a partner unit on name + type only and
  partner units have no alias table, so a rep typing the name of the section
  got nothing back. The prefix answers "photo" / "shoot" / "photo shoot";
  the half after the dash keeps "strobe", "backdrop", "grip", "camera"
  working. **Staff can quote the gear the moment the script runs** — the
  typeahead needs only `isActive` + `offeredToSirReel`, not a public listing.
- **Bug fixed alongside: PHOTO_SHOOT was missing from `PickListDocument`.**
  It is a WAREHOUSE department (`WAREHOUSE_DEPARTMENTS` in jobs/stage.ts), so
  an owned photo-shoot line reaches the pull sheet — and grouped under an
  `undefined` heading, because `DEPT_LABELS` / `DEPT_ORDER` were left behind
  when the department was added. Both maps are exported now and the test
  asserts every `LINE_ITEM_DEPARTMENT_ORDER` key has a label and a slot.
- Nothing reaches sirreel.com until a unit is listed, has a photo AND the
  Partner Equipment Agreement is signed (`SUB_LISTED_WHERE`), so seeding is
  safe before the call rather than after it. `npm run test:photo-section`.
- **Two units to FEATURE (Wes 2026-09-16: "find a couple of items … and
  let's make them live"): `FEATURED_FIRST` in photoShootRoster.ts** — the
  **Profoto Pack & Head Kit — 2400 W/s** and the **Seamless Paper Backdrop —
  107 in roll**. One light, one background: the two things every stills
  shoot needs, and between them they show the section has range. NOT the
  medium-format camera kit despite being the highest-ticket row — its detail
  is the loosest in the file, and featuring the row most likely to need
  correcting after Vic's call is the wrong first impression.
- **"Listed" was NOT the same as live, and the roster page said it was.**
  `SUB_LISTED_WHERE` tests SIX things; the Public catalog switch set one
  (`publiclyListed`) and then reported "Listed — anyone browsing sirreel.com
  can find it" beside a sirreel.com/vehicles/<slug> link. With no photo or an
  unsigned partner that sentence was false and the link 404'd, and the only
  warning was about a missing slug. `src/lib/sub-rentals/publicListing.ts`
  now names all seven blockers (six where-keys; `vendor` carries two) with a
  fix each; the API derives them SERVER-side on GET/PATCH/DELETE so the page
  cannot assemble them differently from the catalog's own gate; the card
  lists what is missing and **withholds the link until the unit is really
  live**. `VehiclePhotosCard` gained `onChanged` so adding a photo — the
  commonest fix — re-reads them. `npm run test:public-listing` fails if
  `SUB_LISTED_WHERE` grows a condition this rule does not model.
- **Making a VSM unit live needs two things no code can supply**: at least
  one PHOTO on the unit, and a SIGNED agreement on the vendor. Both are in
  `PARTNER_APPROVED_VENDOR_WHERE` / `SUB_LISTED_WHERE`. Do not fetch photos
  from the partner's website — the partner uploads from their account page
  (that path already exists and tells HQ), or HQ uploads what Vic sends.
- **A photo HOME TILE was considered and PARKED (Wes 2026-09-16: "I'm not
  sure we will ever use it but remember the idea").** Not rejected, not
  queued — written down so it is not re-derived from scratch. If it is ever
  built: gate it the way Standing Sets is gated (`hasPublishedSpaces` in
  `src/app/(public)/home/page.tsx`) on a LISTED PHOTO_SHOOT unit existing, so
  it turns itself on the day Vic's listing goes live and points at nothing
  until then; meanwhile it would carry the Grip & Electric shape,
  `contactPrefillHref('Equipment quote: Photo Shoot Rentals')`, which needs
  no listing. Four costs, all real: a 9th band narrows every resting sliver
  (the geometry takes any N — `--hovergrow` is N−1 — but eight is what the
  diagonal home was drawn for); Wes's ordering rule puts a long label in the
  INTERIOR, never a flush edge; each tile's media is its own `SiteSetting`
  column, so this is `tilePhotoShootUrl` by **additive SQL, never `db
  push`** — and with no photo it renders solid-colour beside eight
  photographed bands; and the tile palette is nearly exhausted (amber, teal,
  purple, pink, orange, blue, green, red are taken — a deep indigo or a warm
  chartreuse is about what stays distinct under the duotone multiply).
- **The cheaper front door, also NOT done:** one quote-mode line in
  `publicNav.ts` putting "Photo Shoot Rentals" in the Equipment ▾ menu
  beside Lighting & Electric and the Grip Packages. No column, no geometry,
  no photo. Worth reaching for before the tile if the service ever needs a
  public entrance.

## Today is the yard's date, not UTC's (2026-09-16 — Wes)
- Wes, 5:40pm in Sun Valley: "It seems like HQ thinks today is 9/18." It
  thought 9/17: a dozen screens read `new Date().toISOString().slice(0, 10)`,
  the UTC date, and UTC rolls over at **5pm PDT / 4pm PST**. From then to
  midnight the reservations board's today column and green "on a job today"
  rows, the jobs board's cadence ("Picking up today" / "tomorrow" — so a
  9/18 pickup read as tomorrow on the 16th), the calendar's today ring, the
  agenda, both dashboards, the sales reservations widget's window and the
  default start date on a new reservation / payment / incident all sat a day
  ahead of the wall clock.
- **`pacificYmd()` in `src/lib/dates/pacificDay.ts` is the one rule** (pure;
  `pacificDays()` for the today/tomorrow pair, `pacificYm()` for the month;
  `npm run test:pacific-day` pins the clock at Wes's moment and at both
  boundaries). `checkWindow.ts` re-exports it, so the yard / check-report
  screens that were already right are unchanged. `cadenceDays()` reads it.
- **Never a module constant on a real-data screen.** The board's
  `const today = toDS(new Date())` was also frozen when the bundle loaded, so
  an open tab kept yesterday. Read it in the component body (each render).
  The reporting and maintenance MOCK pages keep a module constant because
  their fixtures are built from it.
- Left alone on purpose: `dormancy.ts` (30-day sweep, a day of slack is
  noise), `walkiePool.ts` (availability from a UTC midnight), the
  `timeline-native` fetch window (a range, not a label), and the "created
  on" note stamps. All server-side and none is shown as "today".

## A declined card has a button now (2026-09-18 — Wes/Jose)
- Wes: "Jose inputted a card for a client, which was declined, but it says
  that there's no way for him to ask for a new card. We need a button for
  that." Two dead ends, in two places, for the same reason: the card ASK is
  job-scoped and both screens a decline lands on are not.
  - **The keyed path** (/crm/[id]#cards → "Key in a card the client
    authorized"). A card that fails the $0 check is deliberately NOT stored,
    so the 402 was a red sentence with nothing after it — and the ask lives
    on the job page, which the wallet never named.
  - **The portal path.** There the unapproved authorization IS stored (the
    client is mid-form; the rest of their paperwork must not be lost), so
    the job's Card Authorization tile read "On file · ····4242" over the line
    "The $0 check was not approved — ask for another card" and offered no
    control: "Send CC request" renders only in the no-card branch, which is
    the one branch a declined card is never in.
- **`cardAskState()` in `src/lib/payments/cardAsk.ts` is the one rule** (pure;
  `npm run test:card-ask`). MISSING (no card) → "Send CC request"; DECLINED
  (`validated === false`) and EXPIRED → "Ask for another card", flagged
  `replacement`. **DECLINED outranks EXPIRED** when a card is both, which it
  usually is — an expired card also fails the $0 check — and that matches
  what the tile has said since 2026-09-01. Only an explicit `false` is a
  decline; the rule keeps "never checked" separate even though today's two
  readers collapse a null `authRespStat` to false, exactly as the existing
  "Unvalidated" chip already does.
- **Nothing sends from the wallet.** `CardAskButton` in CompanyCardsPanel
  resolves a job and hands the staffer to `/jobs/<id>?card=ask#card-auth`,
  which opens the SAME review modal every client email goes through — one
  composer, so the preview, the recipient picker and the confirm cannot
  drift into a second copy on the CRM page. Job resolution:
  `?job=` when they walked here from a job tile, else
  `GET /api/crm/companies/[id]/card-ask-jobs` (`cardAskJobsForCompany` in
  jobCardOnFile.ts, soonest pickup first, archived/LOST/HOLD out, WRAPPED
  in because a wrapped job still gets invoiced). **A LIST, never a pick** —
  with two shows for one production, choosing for the rep is how a card
  request lands on the wrong job's thread, and the job is what the client
  reads in the subject. One candidate is a button, several are a choice,
  none says so plainly rather than dead-ending again.
- **The email says the right thing.** "Before we can send X out the door, we
  need a credit card on file" is wrong to the client who typed one in last
  week — it reads as our mistake and leaves them not knowing theirs was
  refused. `cardAskClientSentence()` swaps that first sentence;
  `composeCardAuthEmail` derives the reason SERVER-side off the job's card
  (booking paperwork first, then the company wallet — the same precedence as
  `/api/jobs/[id]`), never from a flag the browser passes, so a client can't
  be told their good card failed. Everything else — the security paragraph,
  the button, the closer — is unchanged, and MISSING/NONE leave the standard
  ask byte-for-byte. Deliberately vague about WHY the bank refused it: we
  don't know and their bank won't tell us. The review modal carries an amber
  strip saying a card is on file and this asks for a second one.
- The card already on file **stays** — the client adds another in the portal
  (Wes 2026-09-03: "we don't wanna remove the first card"), which is what
  `CcAuthCard`'s "Add another card" has always done.
- NOT done: nothing chases a replacement that never arrives (no action item
  for "asked for another card N days ago, still declined"), and a declined
  charge at the collections desk still has no ask of its own.

### The client is told too (2026-09-18 — Wes: "I don't understand how they were able to submit a card that was declined")
- They were, on ONE of the three entry paths, and the split is deliberate:
  **staff keying** (/crm/[id]#cards) and the **company account portal**
  (`addClientCompanyCard`) both REFUSE a decline and store nothing; the
  **client's job portal** (`/api/portal/[token]/sign` step `cc`) stores it.
  That last one is right and stays: the same statement writes their
  signature, payment preference and cardholder details, so refusing the card
  would throw all of it away with the client standing there mid-form. **A
  declined card on file can only have come through the portal** — the keyed
  path cannot produce one.
- **What was wrong is that the route answered a bare 200.** `r.ok` was true,
  `onAuthorized()` fired, and the step collapsed to the green "Credit Card
  Authorized" panel. The client saw success and walked away; the desk got a
  `recordCardTrouble` AUTH_DECLINED email about a card only the client could
  replace. The one person who could fix it in ten seconds, wallet still
  open, was the one person nobody told.
- **The storage stays; the success CLAIM goes.** The cc step now carries
  `cardApproved` (three-state: approved / refused / **never answered** — a
  gateway that THREW is not a decline, the card may be fine, so the client
  hears nothing), and the response adds `cardDeclined` + `cardMessage` only
  on a real refusal. `ok: true` still means "your submission was recorded",
  which is true either way.
- **Both halves, or the fix lasts until they refresh.** At SUBMIT the card
  shows the notice and re-opens capture with the card cleared and the
  signature/name/ZIP kept. On a RETURN visit `CardsOnFilePanel` replaces the
  green banner with the red one — computed over the LIST (`usable`), so a
  production that added a good second card is not nagged.
- **`authChecked` on `CardOnFileSummary` is the whole safety of this.**
  `validated` is `authRespStat === 'A'`, false for a refused card AND for
  every card stored before the $0 check shipped (2026-09-01). On a staff chip
  that conflation is a shrug; telling a CLIENT their working card was refused
  by their bank is a false alarm worse than the silence it replaces. Read the
  pair through `clientCardWasDeclined()` — never `validated` alone — on any
  client-facing surface. A declined card also stops being selectable as the
  charge card in `ClientCardRows`.
- Neither notice guesses WHY (same rule as `cardAskClientSentence`), and both
  say nothing was charged + what survived. `npm run test:card-ask` pins all
  of it, including the never-checked false-alarm direction.
- Known gap: `CardShell`'s `statusLabel` still reads "Authorized" from the
  paperwork step's own `done`, so the header chip can disagree with a red
  body. Fixing it means lifting `useClientCards` into `CcAuthCard`, which
  would fetch on every portal open — deliberately not done.

### …and HQ chases the ones who don't act — `card-declined` (2026-09-18 — Wes)
- The third piece. #55 gave staff a button, #58 told the client; this one is
  for the client who is told and does nothing. Provider
  `src/lib/actionItems/providers/cardDeclined.ts`.
- **`card-required` could never have covered it.** That provider's whole
  condition is `NOT EXISTS` — no portal card on any of the job's paperwork
  rows, nothing on the company wallet. **A declined card satisfies both, so
  the dead card SILENCES the warning about itself.** Same blind spot in
  `cardGateForJob`: `onFile` is computed from existence and never reads
  `authRespStat`.
- **So the yard WILL release a vehicle on a declined card, today.** That is
  stated in the item's subtitle rather than fixed, deliberately: teaching the
  gate to refuse starts stopping trucks at the dock and is Wes's call, not a
  side effect of an action item. **If it is ever wired, gate on
  `clientCardWasDeclined` (authChecked && !validated), NEVER on `!validated`**
  — the latter is false for every card HQ never checked and would have
  blocked 21 of the 23 bookings going out in the 14 days to 2026-09-06.
- **One rule, three ways: `replacementNeeded(cards)` in cardAsk.ts** (pure).
  No cards → card-required's row. Cards, none usable → this. One usable
  anywhere on the job or the company → nothing, and the dead card is left
  alone on the account. `isCardUsable` treats an UNCHECKED card as fine, for
  the 21-of-23 reason above; the client portal's red banner reads the same
  predicate, so what HQ chases and what the client is told cannot drift.
- Same pickup window and live-booking predicate as its sibling (both halves
  of one question must agree on scope), one row per JOB keyed on the lead
  booking, high inside 3 days. The SQL `LEFT JOIN`s paperwork_requests where
  card-required `JOIN`s it — a bad card can sit on the WALLET with no request
  of its own — and orders `sent_at DESC` so "asked Nd ago" is the last ask.
- **Not verified against live data** — this session had no `DATABASE_URL`.
  The pure rules are covered by `npm run test:card-ask`; the query shape
  copies card-required's, which was verified.

### …and the CLIENT gets an EMAIL (2026-09-18 — Wes: "WE NEED AN email to go out to the client when their card declines")
- Nothing did. The decline emailed the DESK (`recordCardTrouble` → rentals@ +
  Wes, the client only as Reply-To) and, from earlier the same day, told the
  client ON SCREEN — which reaches only the person still looking at the page.
  A client who read "Card not approved" and closed the tab was never
  contacted again by anything.
- **`emailClientAboutDecline({ token })` in `src/lib/portal/cardDeclinedEmail.ts`**,
  fired beside `recordCardTrouble` in the same `!isApproved` branch — so it
  is structurally impossible for it to fire on a gateway that THREW. Words
  are pure in `src/lib/email/templates/cardDeclined.ts`
  (`buildCardDeclinedEmail`), the same template/compose split as
  cardAuthRequest.ts.
- **Four things the copy must do, all pinned by `npm run test:card-ask` in
  both html and text:** say the BANK did not approve it (not "a problem" — a
  client who doesn't know it was their bank comes looking at us); say
  **nothing was charged** AND explain the $0, which is the sentence that
  stops the phone call; ask for a different card and say the rest of their
  paperwork is SAVED (or they redo a signature they never lost); and **never
  guess why** — including no "call your bank", which is advice about a cause
  we have not established.
- **PORTAL path only.** The staff-keyed path (/crm/[id]#cards) is
  deliberately not wired: nothing is stored there, the rep is standing right
  there with the "Ask for another card" button, and an automatic "your card
  was declined" to a client who does not know we keyed anything off their
  paper CCA is a confusing email nobody chose to send.
- **One email per client per hour**, however many cards they try — the same
  window as the desk alert so the two cannot disagree about what counts as
  one episode. Kept in the **AuditLog** (`portal.card_declined_client_emailed`
  on the PaperworkRequest), the "sent is an audit row, no column" pattern the
  job welcome uses. Stamped only AFTER a successful send — the opposite of
  the desk alert, which stamps first because a repeated staff alert is worse
  than a missed one; here a missed email is the whole failure being fixed.
- Rides `sendOnJobThread` (label `card-declined-client`, named in
  `systemLabel`), Reply-To the job's agent — a reply to this is "can I pay
  another way", which is a person's question. Recipient is `sentTo` (who we
  asked), falling back to the booking contact. Fire-and-forget: their
  signature is already written and a Resend outage is not their problem.
- Still NOT done: nothing chases the client a second time if they ignore it —
  the `card-declined` action item puts it on a rep's list and sends nothing.

## Lost because of insurance — a reason of its own (2026-09-18 — Wes)
- Wes: "We've lost a couple of jobs because of improper insurance from the
  Production. I'd like to have this as an option." The Mark-lost picker had
  five reasons and none of them was true of that job — a rep either picked
  `SCOPE_CHANGED` (wrong: the show is still shooting, just not on our gear)
  or `OTHER` (which counts nothing). With the COI desk, the broker directory
  and the replacement-value work all built on the premise that certificates
  cost us deals, the one number that would prove it was unrecordable.
- **`LostReason.INSURANCE`**, label **"Insurance requirements not met"**.
  `LOST_REASON_CHOICES` / `LOST_REASON_LABEL` in `src/lib/orders/listStatus.ts`
  are the one list — MarkLostModal and the /orders picker both read it — plus
  the human-reason allowlists in `/api/jobs/[id]/mark-lost` and
  `/api/orders/[id]/mark-lost`. Nothing else in the codebase branches on a
  lost reason.
- **Enum value by additive SQL, NEVER `db push`, and BEFORE the deploy:**
  `npx tsx scripts/add-insurance-lost-reason.ts` (one
  `ALTER TYPE … ADD VALUE IF NOT EXISTS`, idempotent), or the same statement
  pasted into the Neon console from an iPad. A Prisma client 500s reading an
  enum value Postgres does not have, and the picker offers it the moment the
  code is live.
- NOT done: nothing ties the loss back to the COI record that failed — the
  reason is a bare classification, and "which requirement did they miss" is
  still only in the rep's note. No reporting groups losses by reason yet.

## Ana can correct an invoice from her own desk (2026-09-17 — Ana)
- Ana: "how do I update an invoice from my side?" She could not. Both ways of
  correcting an invoice existed — **regenerate** (rewrite the figures from
  the order, KEEP the number — Wes 2026-09-01) and **void + re-cut** — but
  both lived on the JOB page, two screens from `/collections`, which is where
  she reads "Client asked for a change". And neither could touch the two
  facts that live on the invoice and nowhere else.
- **The split that decides every button here: figures belong to the ORDER;
  the due date and the printed note belong to the INVOICE.** A rate, a line
  or a late discount is fixed on the order and pulled through. An invoice
  total that can be typed over reconciles to nothing, so there is no total
  field and never should be — `PATCH /api/invoices/[id]` takes `dueDate` and
  `notes`, full stop.
  - **Due date** — SirReel bills due-on-receipt so the generator stamps the
    issue date. Terms a client negotiated, or an extension given on the
    phone, had nowhere to go, so honouring one meant letting the invoice read
    as delinquent. That date is what every aging figure and "30d late" chip
    counts from.
  - **Note** — the PO number the client's A/P wants on the face of the
    document, a remit instruction, "corrected 9/17". Ana's edit REPLACES it
    wholesale; the old value is in the AuditLog `invoice.edited` row.
- **The PDF follows, rendered from the invoice's OWN snapshot** —
  `renderStoredInvoice()` (extracted from `renderPaidInvoice`, which is now
  the PAID-only gate in front of it). NOT `generateRentalInvoice`, which
  re-derives from the live order and would drag unrelated line edits into a
  document nobody asked to republish. Replace-on-regenerate for the blob.
  A **PAID** invoice is already rendered on demand (the PAID stamp), so its
  blob is left alone.
- **No snapshot → the edit is REFUSED, whatever the status.** The snapshot is
  what every presentation is drawn from, PAID render included, so a
  pre-snapshot invoice would move the row and leave the client's PDF saying
  something else. The refusal names the fix (regenerate first, or void and
  re-cut). This guard was first written gated on "needs a blob rewrite" and
  the test caught the PAID hole — keep it unconditional.
- **A regenerate now CARRIES THE DUE DATE OVER instead of restamping it.**
  The generator defaults `dueDate` to the issue date, so a rewrite pushed the
  due date to today: an invoice 20 days late came back 0 days late because
  somebody corrected OUR arithmetic, and any hand-set terms were silently
  gone. A correction does not restart the client's clock. (This is also what
  lets a hand-set due date survive without a new column.)
- **Two surfaces, one route.** `/collections` → All HQ invoices → **Correct**
  on the row: the client's change request IN THEIR WORDS
  (`clientChangeNote` is on the payload now — "asked for a change" with no
  words sent her to the job page to read one sentence), the due date, the
  note, a **"Pull the figures through from the order"** button (the
  regenerate) and a LINK to the order for what is actually billed. The job
  page's `JobInvoicesPanel` carries the same edit as **Due date & note**
  beside its existing Update / Send / Void.
- VOID is the only hard lock — a withdrawn document stays as it was. **PAID
  is deliberately NOT locked**: a settled invoice still gets asked for a PO
  number. Billing-gated (`can(role, 'billing')`) like void, regenerate and
  reopen. `npm run test:invoice-edits`.
- Unchanged and still the answer for money: the order is the book. Reopen a
  CLOSED/INVOICED order (`POST /api/orders/[id]/reopen`, billing-gated) to
  edit lines or discounts, then pull the figures through.

## Orders by the day they were created — checking the EOD report (2026-09-17 — Ana)
- Ana: "Is there a way I can check the drop down list of orders and quotes and
  specify a certain date? … there is no filter for finding orders grouped
  together by date. And a way to calculate the total value while I'm
  searching would be great, too. That way I know if the EOD report that gets
  generated is accurate or not."
- **The value total already existed** (the `{total} orders · $X total` line in
  the /orders header, `valueTotal` off the whole filtered set, not the page)
  and follows every filter including the new dates. What was missing was the
  date filter and, more importantly, a count Ana could hold against the report.
- **`tallyOrderDay()` in `src/lib/orders/dayTally.ts` is the ONE definition,
  and both surfaces read it** — the EOD report renders it into the evening
  email, /orders renders it above the table. A date filter that counted rows
  its own way would not CHECK the report; it would be a second number to argue
  with. Pure, `npm run test:order-day-tally`.
  - A quote is `quoteStatus` DRAFT or SENT — never `status`; an order can be
    BOOKED while quoteStatus lags, and the question is whether the client said
    yes. Orders are worth `bookedTotal ?? total` (`total` keeps moving with
    post-booking edits), quotes are worth `total`.
  - CANCELLED is out. DRAFT, LOST and ARCHIVED are IN — a quote written and
    lost the same afternoon was still written.
- **The card is deliberately NOT a description of the table under it.** The
  /orders list hides drafts, lost and archived by default and still shows
  cancelled rows, so the row count differs BOTH ways. `reconciliationNote()`
  names it in one sentence ("Counts 1 draft, 1 lost … Leaves out 1 cancelled
  order the list still shows") and says nothing on a day where they agree. A
  card that quietly counted only the visible rows would be worse than no card:
  a confirmation that agrees with nothing. The tally query therefore ignores
  `where` and is built from the window + scope alone — a status filter must
  not move the figures being checked.
- **Pacific days, not UTC** (`createdFrom` / `createdTo`, `YYYY-MM-DD`, both
  ends inclusive, either one alone means that single day). A UTC cut would put
  every order written after 4pm into tomorrow's count and the two screens would
  disagree every evening. The day helpers moved out of eodReport.ts (which
  imports prisma) to `src/lib/time/pacificDay.ts` so the tally and its tests
  stay pure; eodReport re-exports them, so its dozen importers are unchanged.
- The EOD panel now prints the COUNT beside each of those two figures — it only
  ever showed dollars — and links to `/orders?createdFrom=<date>&createdTo=<date>`.
  The orders page reads that deep link off `window.location` in an effect, NOT
  `useSearchParams` (a client page with no Suspense boundary fails `next build`).

## "Approved — book it" names the order and takes you to it (2026-09-17 — Wes)
- Wes, on SR-JOB-0312: "It says that the production supply order is booked
  but it does not give me any other options there. On the tile it says
  that I need to book it." Both surfaces were right, about DIFFERENT
  orders — the job carried one booked order and one still APPROVED.
- **The header badge cannot tell APPROVED from BOOKED, on purpose.**
  `cadenceForOrder` in `src/lib/jobs/cadence.ts` maps both to the state
  `booked`, because a new `CadenceState` would re-tier the board's
  colours, legend and sort (the same reason `approvedUnbooked` is carried
  as its own COUNT in `/api/jobs`, not as a state). So the badge is NOT
  changing. What was missing is the qualifier beside it.
- **The job page now carries a `#book-it` prompt** under the quick-action
  row (where JobWelcomeButton already lives), rendered when any live order
  is APPROVED. It NAMES each order with its content summary and puts
  `MarkBookedButton` beside it — "which order?" was the whole complaint,
  and a count on a tile can never answer it.
- **The tile chip navigates now.** It was plain text inside the row's
  `<Link>`, so pressing it landed a rep at the top of a long job page
  whose header reads BOOKED. It is a `<button>` that pushes
  `/jobs/<id>?book=1`; the job page expands every approved order and
  scrolls the prompt into view, once per landing.
- **One name per act, across all three surfaces.** Before: the tile said
  "Approved — book it", the job page said "Record client approval", the
  order page said "Mark booked". Now the label follows the STATUS —
  APPROVED already has the client's yes on file, so the only act left is
  **Book it**; from DRAFT / QUOTE_SENT the yes is not on file and
  recording it is half the point, so it is **Record client approval**.
  The confirm button inside the panel always says Book it. The order
  page's own APPROVED action was already "Book it" and is unchanged.
- Nothing about the booking mechanics moved: `POST /api/orders/[id]/
  mark-booked` and `bookOrder()` are untouched, and `MARK_BOOKABLE` /
  `BOOKABLE_FROM` still agree on DRAFT / QUOTE_SENT / APPROVED.

## The reservation follows the order's dates (2026-09-17 — Wes)
- Wes, on Someday Studios' passenger van: "I changed it in the order, but
  that did not change it on the reservation as we had planned for it to
  do." Pickup 18th → 17th on the order; the board still drew the van on
  the 18th. Nothing had ever moved a UNIT with a line's dates:
  `BookingAssignment.startDate/endDate` are COPIES stamped at assign time
  from the quoted block (assignWindow.ts), and neither date edit wrote
  them back. Worse, `coverageOfBlock` matches by exact day, so the NEW
  block read as unfilled while the same van sat held on the old one.
- **Two edits move line dates, one implementation follows them:**
  `syncReservationToLineDates()` in `src/lib/scheduling/followLineDates.ts`,
  called by the row editor (`PUT /line-items/[lineId]`) and "Change dates…"
  (`POST /dates/apply`). It runs `holdOnQuoteSend` (peak + envelope widen),
  re-stamps the units, then `tightenBookingEnvelope` brings the envelope IN
  when nothing still needs the old days. Pure rules `planAssignmentFollow`
  / `bookingEnvelopeFor`, `npm run test:follow-line-dates`.
- **Why the row editor never fired before:** its gate was the line's own
  `assetCategoryId`, which every catalog-bound vehicle leaves null (the
  class lives on the catalog row). `holdCategoryForLine()` in
  holdOnQuoteSend.ts is now the exported, pure resolution the hold itself
  uses; resolve a line's class through it, never off `assetCategoryId`
  alone.
- **The quantity / catalog-binding branch is closed too (same day).** It
  gated on `newIsHold` off the line's own `assetCategoryId`, so a real van
  edited 1 → 2 left the hold at 1 and the capacity confirm never fired.
  Now: both class ids come from `holdCategoryForLine` (before and after the
  edit — the order page sends both binding fields on EVERY save, so the
  route compares against the row, not "present in the body");
  `planHoldSyncOnLineEdit()` (pure, holdOnQuoteSend.ts, `npm run
  test:quote-hold`) decides what the hold is owed; the WRITE is
  `holdOnQuoteSend(orderId)` — SET to the peak, never the delta-summing
  `syncHoldOnLineUpdate` (one van quoted for two separate weeks, one block
  bumped to 2, is a hold of 2, not 3). The 409 `requiresConfirmation` is
  kept (only the increase must fit; a class the line did not hold before
  costs the whole quantity; checked on the line's NEW days), and
  `saveEditLine` now does the add-line confirm-and-retry instead of a
  dead-end alert. Response carries `holds { quantityBefore, quantityAfter,
  releasedUnits, note }`; the page alerts `note`.
- **Merged with the order-line ↔ unit through line (`66bec271`, rescued
  from a detached HEAD onto `rescue/line-unit-throughline`, 2026-09-17).**
  The PUT runs the recompute AROUND that commit's per-truck handling:
  a VEHICLE line's quantity cut first hands back THIS line's trucks by
  asset (`releaseLineUnits`, last-bound first, `keep: newQty` so unbound
  slots go before a bound truck — without it a line of 18 with one van,
  trimmed to 1, released the van), then recomputes; a bump recomputes,
  then binds the extras stamped to the line (`assignUnitsForLine`); a
  line that stops being a vehicle releases its trucks. A vehicle CLASS
  change is refused (409 `USE_SWITCH_CLASS`) before any of this —
  `saveEditLine` handles that code INSIDE its 409 branch, because the body
  can only be read once. Response carries `holds`, `released`,
  `unitAssignment` and `assignmentsFollowed`.
- **Limits of the recompute:** it never shrinks a hold whose units are
  ASSIGNED — on a stage, where there is no per-line truck, a cut is
  reported in `holds.note` instead; and it only visits classes still
  quoted, so a class the line LEFT (a stage re-picked) is released by
  asset via `releaseBookingItem` when `categoryStillQuoted()` is false.
  **Never `syncHoldOnLineDelete` for that** — at zero it DELETES the
  BookingItem and the FK cascade takes every unit on it; the line DELETE
  handler now uses it only for stages and releases a vehicle line's
  trucks by asset. `syncHoldOnLineAdd/Update` prefer a live rank-1 row and
  revive a released one from zero.
- **Which units follow:** the ones carrying the old block's days verbatim
  (the same rule coverage counts by), up to the moved line's quantity, this
  order's own before unstamped ones; a sibling order's unit never moves.
  Overlap is accepted only when the class has NO other block on the order
  (a row stamped with an order span before blocks existed). CHECKED_OUT:
  the pickup already happened, so only the return follows, and only when
  the pickup did not move.
- **A unit booked elsewhere on the new days does NOT move** on the row
  editor — it stays, and the PUT response's `assignmentsFollowed.blocked`
  names it (the page alerts). The client's dates are the client's dates;
  the truck is a re-pick. "Change dates…" showed the rep every conflict
  and had them tick through, so it passes `allowConflicts` and the unit
  moves anyway, audited `overrodeConflict: true`. Every re-stamp is
  AuditLog `booking_assignment.dates_followed_line` with old/new days.
- **The envelope shrinks only when nothing bare is on the booking:** a
  class held with no quoted line behind it (Make Reservation, no order
  line) has the envelope as its only date, so with one present the
  envelope stays widen-only. Otherwise pushing an order a week later no
  longer leaves a phantom hold on the old days.
- The header `PUT /api/orders/[id]` `startDate/endDate` is still a mirror
  with no UI and reaches nothing scheduling-side — on purpose.

## The client can ask to move their dates (2026-09-18 — Wes)
- Wes, on the L'anza job: "client said they wanted to change the pickup date
  but couldn't figure out how to do that." They couldn't. The portal's
  Schedule card printed Pickup and Return and offered NOTHING beside them,
  and the one line on the page that mentions a change ("Need these dates
  held sooner, or something changed?") lives inside the not-booked-yet
  notice — which stops rendering the moment the order is quoted. So the
  further along a job got, the less the portal said about how to move it.
- **It is a REQUEST, and only a request.** No portal path writes
  `Order.startDate`, a hold, an assignment or a price. Moving dates is the
  most cascading edit in the system (it re-prices every line and re-stamps
  every unit — followLineDates.ts) and it can collide with another
  production, which is exactly why "Change dates…" shows a rep the totals
  delta, the conflicts and the custom-dated lines FIRST. That cascade
  cannot be put in front of a client, and a form that answered "the 16th is
  free" would be wrong by the time they read it. Standing rule (Wes
  2026-09-11) holds: a client's words never change a job on their own.
- `POST /api/portal/job/dates/request` (cookie-auth'd, the ORDER comes from
  the session) → `sr_order_date_change_requests`. **One open ask per order**:
  a second ask SUPERSEDES the first (stamped `SUPERSEDED`, never deleted) —
  a client who says "the 16th" then "the 17th" changed their mind, and a
  desk reading two rows cannot tell which is current.
- **Only dates that actually MOVE are stored** (`movedOnly`). Both boxes
  post on every submit, so without it every request would also "ask" for
  the return nobody touched. `currentStartDate/EndDate` snapshot what the
  order said WHEN THEY ASKED — `drifted` then warns a rep whose order has
  moved since, because applying "their" pickup blind would silently undo
  whatever changed in between.
- **The ask never outlives its answer.** `/dates/apply` closes it
  (`resolveDateChangeRequests`), "Close this" on the order page closes it,
  and on top of both the reader DROPS any row whose dates the order already
  carries (`alreadySatisfied`) — however they came to move. A words-only
  ask names no date, so nothing auto-satisfies it but a person.
- Surfaces: the portal card (`DateChangeRequestCard`, under the two dates —
  the place the thought occurs; it says out loud that the dates have NOT
  changed yet), a panel on the order page above the Dates field whose button
  opens the ORDINARY PushDatesModal **seeded** with what was asked (not
  money-gated — anyone working the order needs to know), the action item
  `date-change-requested` (HIGH inside 7 days of pickup), and an email to
  the rep on the JOB THREAD (label `date-change-request`, Reply-To the
  person who asked) so it files into the job Conversation.
- **Schema: ONE new table, phone-runnable.** /admin/maintenance → "Add the
  client date-change request table" (`date-change-request-table`), or
  `npx tsx scripts/add-date-change-request-table.ts`. Until it has run
  everything FAILS SOFT — the portal does not offer the form (it shows the
  rep's number), the order page shows no request, a write answers 503
  naming the task. `npm run test:date-change-request`.
- NOT done: nothing tells the client when the request is answered — the
  dates just update on their portal, and telling them is a conversation on
  the job thread. Nothing nudges a request that has sat for days beyond the
  action item, and there is no way to ask about ONE line's dates (the ask is
  the whole order's window, which is what the client sees).

## "Booking item is fully assigned" — one capacity rule (2026-09-17 — Jose)
- Jose, on Mad Minds (SR-JOB-0389): changing Cargo 35 for another van was
  refused "booking item is fully assigned". Not a driver, not a lock. The
  PICKER counted exact-day coverage against the QUOTED quantity (the ADV
  Carrera rule, 2026-09-14) while the WRITE counted every OVERLAPPING
  assignment against the hold's own quantity — the order is loaded on
  Cargo 35 + Cargo 45, so the second van's overlap filled the block on the
  server while the picker still showed the swap. Two answers to "is this
  block full?" on one screen.
- **`blockCapacity()` in `src/lib/scheduling/assignWindow.ts` is the one
  rule** (pure; `npm run test:assign-window`): when the resolved window IS a
  quoted block, the block's quantity and exact coverage; with no block to be
  exact against, the hold's quantity and overlap. `available-units` and
  `assignUnitToBookingItem` both call it. The refusal is now
  `error: 'fully-assigned'` with a readable `reason`, the counts, and
  `swappableAssetIds`; nothing matched the old string.
- **The picker turns that refusal into the swap prompt** ("Which unit does X
  replace?") and re-reads its counts, instead of a dead-end error. A block
  whose units are checked out still says so.
- **On a swap the DRIVER goes with the job, not the van.** `DriverAssignment`
  rows on the outgoing assignment are re-pointed at the replacement inside
  the transaction (the driver's page and link survive; it now releases the
  new van's code); inspections are detached (a walkaround is of the OLD van,
  it stays on that asset's history); a checkout record on the outgoing unit
  refuses the swap up front (`replace-checked-out`) — its FK is RESTRICT and
  would otherwise fail after every other check passed. The replacement is
  created BEFORE the outgoing row is deleted so those rows have somewhere to
  go. Response carries `driversMoved`. Nobody is TOLD the driver's van
  changed — open.

## Cargo 20–25 have no lift gate (2026-09-16 — Wes)
- Wes: "We haven't successfully changed cargos 20 through 25 to be without a
  lift gate. Instead we've added a second cargo 25 that has no lift gate but
  cargo 25 with a lift gate still exists." The six were seeded into "Cargo
  Van w/ Liftgate" (seed_fleet.ts, March) and ruling A of 2026-07-15 filed
  Planyo's "w/o" placement of them as stale. Planyo was right.
- **This is a DATA change, shipped as a maintenance task, not a hand edit.**
  `cargo-vans-no-lift-gate` on /admin/maintenance (iPad) or `npx tsx
  scripts/cargo-vans-no-lift-gate.ts --write` (laptop) — one implementation,
  `src/lib/fleet/moveCargoOffLiftGate.ts`. Dry run first; it prints the plan
  per van and writes nothing. **It has not been run yet** — this session had
  no database access; Wes runs it.
- **The ORIGINAL row survives, the duplicate folds into it.** Rules in
  `src/lib/fleet/cargoLiftGate.ts` (pure, `npm run test:cargo-lift-gate`):
  the active row in the w/ class (oldest first) is the survivor because it
  carries the seed id, the odometer, the access code and every trip; every
  other active row with that name — the second Cargo 25, and the Planyo-era
  Cargo 22/25 that sat in w/o since May — has its nine history tables
  (`ASSET_HISTORY_RELATIONS`, pinned against `model Asset` by the test)
  re-pointed at the survivor, facts the survivor lacks copied over
  (`fillFromDuplicate`: fill-if-empty, higher odometer, notes appended), and
  is retired under "Cargo 25 (duplicate — folded 2026-09-16)". **Nothing is
  deleted.** Inactive rows are never a survivor and never folded.
- **Counts are set from the rows, on BOTH tables.** The scheduler reads the
  merged `InventoryItem.qtyOwned` (`getCategoryAvailability`), not the frozen
  `AssetCategory.totalUnits`; the task sets both to the active-asset count of
  each class. The w/o class was ARCHIVED in June (exports/catalog-export.json
  has it `isActive:false`) — the task un-archives it and mirrors the w/
  class's `reservableOnGantt`, or the moved vans would vanish from every
  picker.
- **A HOLD's class is not re-written.** A live reservation filed under w/
  whose unit is one of these vans is NAMED in the log ("Look at:") and left
  for a person to re-class on the reservation — the class on a hold is what
  the quote says. Same for a hold that was assigned both rows of one van
  (it holds the unit twice after the fold; release one).
- `PLANYO_UNIT_CATEGORY_OVERRIDES` is now EMPTY — it pointed Cargo 20/21/23/24
  at the class they are leaving, and once they sit in w/o the reservation's
  own category matches first. Per-asset AuditLog rows:
  `asset.category_moved`, `asset.folded_into` (old values included; the CLI
  journal has the same). `TaskRefused` (`src/lib/admin/taskRefused.ts`) is
  now the one refusal class every maintenance task throws; `SeedRefused`
  stays as an alias.

## Run a task without a laptop — /admin/maintenance (2026-09-16 — Wes)
- Wes: "I need to be able to run these scripts from my iPad with no access
  to my actual laptop." Everything seedable had ONE way in — `npx tsx
  scripts/…` with `DATABASE_URL` exported by hand — so being away from the
  laptop meant the work waited.
- **A web button cannot shell out to `scripts/`.** They are not traced into
  the Vercel lambda (next.config.js only includes the markdown AHA reads),
  `tsx` is a devDependency, and spawning a process out of a serverless
  function is not a thing to build a production seed on. So the WORK moves
  into a lib module with **two entry points**: the CLI script (journal file)
  and `/admin/maintenance` (AuditLog row). One implementation — a seed that
  behaves differently depending on which button started it is worse than one
  that only runs in a terminal. First one extracted:
  `src/lib/sub-rentals/seedVsmPlanet.ts`; `scripts/onboard-vsm-planet.ts` is
  now argv + journal + exit code and nothing else. **Add behaviour to the
  lib, or the phone loses it.**
- **Registry, split in two like partnerSections.ts:**
  `src/lib/admin/maintenanceTasks.ts` is plain metadata (the page is a client
  component and imports it), `maintenanceRunners.ts` is id → function,
  server-side. `maintenanceRunner()` refuses any id not in the metadata
  registry — that IS the allowlist.
- **Four safety properties, all deliberate:** ADMIN-only via `requireAdmin`
  (a dry run still reads production); the request picks an ID out of a map
  and never a path, command or script name; **dry run is the default and
  fails closed** — a write needs `dryRun: false` AND `confirm: <task id>`;
  and every real run writes an AuditLog `admin.maintenance_run` carrying the
  CREATED IDS, which is what keeps "cleanup by captured id only" workable
  when the run happened on a phone with no journal file.
- **No schema changes here, on purpose — with ONE exception (2026-09-17,
  Wes: "It's not possible to do any of this from my phone").**
  `category: 'schema'` may run ONLY `CREATE TABLE / INDEX … IF NOT EXISTS`:
  the task carries its statements as `ddl` (plain data, e.g.
  `src/lib/email/jobThreadTableSql.ts`), `isAdditiveStatement` in
  `src/lib/admin/additiveDdl.ts` is the gate — the registry test applies it
  at build time and `runAdditiveDdl` refuses at run time — and the runner
  logs each table's columns afterwards so a phone screen proves it took. A
  brand-new table has no half-run state, which is why this class is safe
  where an ALTER is not. The `add-*-columns` / `ALTER TYPE` scripts STAY on
  a laptop: the live DB carries objects no schema file knows and their
  failure mode is a half-migrated production database. Tasks that DEPEND on
  such a migration preflight it and refuse with a fix line (see the
  PHOTO_SHOOT enum check) rather than 500-ing a page. First schema task:
  `job-conversation-tables` — the Phase 2 Conversation tables; the CLI
  `scripts/add-job-thread-tables.ts` is a thin wrapper over the same
  `JOB_THREAD_TABLES_DDL`.
- Page is built for a phone: 16px inputs (anything smaller makes iOS Safari
  zoom on focus), full-width controls, dry run as the primary button, "Run
  for real" behind a second tap. Nav: Admin → **Run a Task**.
- `npm run test:maintenance-tasks` guards the registry both directions — a
  runner with no metadata is an undocumented endpoint, metadata with no
  runner is a button that 404s — and that no task advertises DDL.

## Deliver to SirReel — Sun Valley, and borrowed gear on the sheet (2026-09-16 — Wes)
- Wes: "we need to have the option Deliver to SirReel - Sun Valley" … "if
  they are delivered, they should be on the Pick List but in a different
  section (Partner). How do we handle this with sub leased equipment? It
  should be the same as that but under a different heading. **Both subbed and
  partner equipment have to be returned to their host warehouse.**"
- **Why a FOURTH ReceiveMethod and not just DELIVERY.** `DELIVERY` already
  carries two destinations: the enum's original meaning is "vendor drops at
  SirReel's location" (an ad-hoc sub-lease), and on a PARTNER unit it was
  re-pointed 2026-09-10 to "the partner delivers to SET". One value, two
  places, depending on whether the row happens to carry a roster unit — so
  "to our yard" had no way to be said about a partner unit without re-reading
  every existing DELIVERY row and guessing which sense was meant.
  `DELIVER_TO_SIRREEL` says it once. Enum value by `scripts/add-deliver-to-
  sirreel-receive-method.ts` (additive ALTER TYPE, **run before the deploy**);
  from an iPad it is one statement in the Neon console.
- **`usesPartnerDriver` is now a positive list** (`m === 'PICKUP' || m == null`).
  It was `!== 'DELIVERY' && !== 'WILL_CALL'`, which defaulted an unknown value
  to TRUE — adding the fourth method would silently have started asking the
  partner for a driver's name and a call time.
- **The ONE exception to "partner lines stay off the pick list."**
  `PARTNER_SUB_RENTAL_WHERE` now excludes `DELIVER_TO_SIRREEL`: that gear sits
  on our floor and leaves on our truck, so it needs pulling, counting and
  loading. Everything else about that rule is unchanged.
- **Two new headings ABOVE the departments** (`src/lib/warehouse/pickSections.ts`,
  pure): **Partner** (a roster unit delivered to us) and **Sub-Rental** (ad-hoc
  gear sub-leased from another house — always on the sheet, but previously
  scattered through the department sections and indistinguishable from gear
  SirReel owns). Borrowed gear sorts FIRST: it is somebody else's property and
  may not have arrived yet, which is worth discovering at the top of the sheet.
- **Each borrowed line prints "Back to <house>"**, and each section carries a
  one-line "not ours — check it in and send it back". That naming IS the
  feature: the heading alone would just be tidier filing. A sub-leased fixture
  that came back unlabelled used to end up on our shelf looking like ours.
- **Prisma cannot select one relation twice**, so the sheet loads EVERY live
  sub-rental and the "partner line" predicate is applied in JS
  (`withPartnerSubs` in renderPickListPdf). `npm run test:pick-sections` pins
  that twin against `PARTNER_SUB_RENTAL_WHERE` — the thing most likely to drift.
- The receive-method union was duplicated as a literal in 12 files; all of them
  now import `ReceiveMethodKey` from partnerKind.ts.
- NOT done: nothing yet TRACKS the return leg — the sheet says where gear goes
  back, but there is no board that says whether it got there. `SubRentalStatus`
  already has RETURNED and /sub-rentals is earmarked as the returns board.

## Partner lines stay off the pick list (2026-09-11 — Wes)
- Wes: "keep partner lines off the pick list." A partner's unit is delivered
  by the partner or collected from them — never through our warehouse.
- A PARTNER LINE = a line with a live SubRental on a ROSTER unit
  (`subcontractedVehicleId` set, not CANCELLED), or a line riding under one.
  Ad-hoc gear sub-rentals ("Sub-rent…", POST /api/sub-rentals) are NOT partner
  lines — our crew collects that gear, so it stays on the list. One definition:
  `src/lib/orders/partnerLines.ts` (`PARTNER_LINE_WHERE`, `isPartnerLineIn`,
  `partnerRouting`).
- A would-be WAREHOUSE partner line gets `fulfillmentLane` null, `pickStatus`
  null, no PickListItem — every warehouse reader (load-ready rollup, check
  reports, pull-order backfill) keys on lane WAREHOUSE, so they all skip it.
  FLEET / STAGE routings are untouched.
- Enforced in: `syncPickListOnLineAdd` (looks it up; the add-line route passes
  `partnerFulfilled` because the booking is created after the line),
  `bookOrder` (and takes back unpicked pre-book items), auto-bind
  (`releasePartnerLineFromPickList` — already-picked rows stay), the paper pull
  sheet + pull-order preview, and both job-stage warehouse counts.
- `npm run test:partner-pick-list`. A cancelled partner booking does NOT put
  the line back on the list by itself — Wes: "there needs to be a warning
  wired in." `partnerCancelledLines.ts` finds the line (warehouse department,
  no lane, no live partner booking, a CANCELLED roster booking on it or its
  parent) on an order the warehouse is working (BOOKED / LOADED_READY / ON_JOB,
  or a pull order already released). It raises action item
  `partner-cancelled-off-pick-list` (high once loaded / on the job / picking up
  within 3 days) and a prompt on the order page whose button files it
  (`/api/orders/[id]/partner-cancelled-lines`, audited). Pre-book lines need
  no warning: booking routes them. `npm run test:partner-cancelled-lines`.

## The introduction carries the link now (2026-09-11 — Wes)
- REVERSES the 2026-09-10 rule ("I don't want to send a portal link without the
  initial welcome email" → no link in the introduction). Wes 2026-09-11: "I
  think we should include the partner's logos in the intro email as well as the
  portal link … the sooner we get info to them the better!"
- `renderPartnerWelcome` takes `accountUrl` + `logoUrl` (from
  `partnerWelcomeExtras`, which mints the token if there is none — minting is
  not an invite; this mail IS). Their logo rides at the top of the body via the
  PUBLIC token proxy `/api/public/vendor-account/[token]/logo`, so it loads in
  an inbox with no login. Preview and send share the renderer, so the preview
  is still the mail.
- **The link is added by the RENDERER, never by the model** — welcomeAiDraft
  still strips links from anything it writes. Keep it that way.
- Sending stamps `portalInvitedAt/To` as well as `welcomeSentAt`: the link has
  gone, and the Portals tab must not read "never sent". The separate "Email the
  account link" button stays, for resending on its own.
- `npm run test:partner-welcome`.

## Partner contacts — the people at a partner (2026-09-11 — Wes)
- Wes: "I need to be able to add people on the partner portal. owners and
  others. let's have a contacts section." `VendorContact` (`sr_vendor_contacts`,
  added by `scripts/add-vendor-contacts-table.ts`, additive SQL). Roles are
  TEXT against the list in `lib/sub-rentals/vendorContacts.ts` — not a Postgres
  enum, so a new role needs no two-deploy dance.
- **Both sides keep the list** (Wes's choice): HQ on /crm/portals#partners
  (`VendorContactsPanel`), the partner on their page (`VendorContactsCard`);
  the partner's edits email HQ through `tellHq`, like their contact-details
  edit. One rule set: `cleanContactInput` / `addVendorContact` / … in
  vendorContacts.ts. Both write paths go through it.
- **`isPrimary` IS the address on file** — it mirrors into
  Vendor.contactName/email/phone, so every existing partner mail path
  (`poEmail ?? email`) keeps working and nothing else had to change. The main
  contact can't be removed; make someone else primary first. Removal is
  `isActive false`, never a delete.
- **`emailBookings` is per person and OFF by default** (Wes's ruling): ticked,
  `vendorBookingCc()` CC's them on the estimate notice, hold request,
  it's-a-go, cancellation and logistics mail. NOT on the introduction or the
  account link — those stay one-to-one with the person holding the page.
- The partner's existing contact on file seeds as the first row on first read,
  so neither side opens empty. `npm run test:vendor-contacts`.

## Partner discount waterfall (2026-09-11 — Wes)
- Wes, on VSM Planet (deal 35%, "willing to go to 40-43% off to keep a
  client"): a client discount on a partner's unit is **shared 50/50** until
  the partner's share reaches `Vendor.partnerMaxSharePercent`, then comes out
  of **SirReel's share alone** down to a floor of **10% of LIST**
  (`SIRREEL_FLOOR_PERCENT`); deeper is **declined**. $1,000 list: 0% →
  VSM $650 / SirReel $350 · 16% → $570 / $270 · 33% → $570 / $100 · 35%
  declined. The floor is of LIST, not of the billed price — 10% of billed
  would let 35% through, and Wes declines it. Null max = the partner doesn't
  flex. Before this the partner was paid list × (1 − share) whatever the
  client paid, so 30% off a 30% deal made SirReel $0.
- Pure math in `src/lib/sub-rentals/discountWaterfall.ts` (`npm run
  test:discount-waterfall`); the DB half is `partnerMargins.ts`. Department
  and order discounts are spread over the lines from computeOrderTotals'
  breakdown (expendables excluded, as there).
- `partnerFloorGate` runs on discount POST/PATCH, line PUT (ANY line — a
  FIXED or flat-total order discount re-spreads), send-quote and
  mark-booked. It refuses only what an edit makes worse, so an order already
  over the line can still be eased. There is no override.
- `stampVendorCost` pays the partner the waterfall for the LINE's billable
  days — no weekly blocks, and no fallback to `clientDailyRate` (that is the
  client's price). A stamped `vendorDailyRate` is COMMITTED: a later
  discount comes out of SirReel, still floored.
- Surfaces: DiscountsPanel "Partner units" (staff only — names the partner);
  Portals deal card max field + `describeDeal`; partner page, account-link
  invite, agreement §8 + Terms box say discounts are shared up to their max
  and never mention SirReel's floor. Agreement v2026-09-11 — re-file for any
  partner whose agreement was filed earlier.
- Not guarded: a discount landing on a partner's ANCILLARY fee lines (paid
  to them in full) comes out of SirReel; a partner unit ADDED under an
  existing discount is caught at send/book, not at the add. The column went
  in by targeted `ALTER TABLE … ADD COLUMN IF NOT EXISTS` — the live DB has
  drift, never `db push` blind.
- **VSM Planet IS in the DB — under the name `VSM Planet`.** Created
  2026-09-11 23:57 with the 35% / 43% deal, Vic's email, a minted portal
  token and TEN units drawn from their real published categories (Sprinter
  Cargo Van Packages ×3, Strobe Lighting & EQ, Continuous Lighting,
  Electrical & Distro, Grip, Production…), each carrying a note like
  "Their 'Grip' category — stands, flags, a…". `catalog_section` is NULL on
  all ten, which is exactly why `#photo-shoot` still rendered empty.
- **A 2026-09-16 edit "corrected" this note to say the row had never been
  created. That was WRONG and is retracted.** The photo-roster seed keys on
  `VSM Planet Rentals`, found nothing, and the absence was read as the
  database being stale rather than the lookup being too narrow. **Match a
  vendor by every name it might carry before concluding it does not exist.**
  `VSM_PLANET_ALIASES` in photoShootRoster.ts is that list and
  `findVsmVendor()` is the only lookup a VSM code path may use; the seed
  REFUSES rather than adding a roster on top of units it did not create.

## One thread per job — Phase 1 SHIPPED 2026-09-17 (Wes)
- Wes 2026-09-16: "figure out a way to have individual jobs stay on one
  thread. For the client to have a single thread would be better … Is it
  that we open a chat within the job itself and that chat feeds a single
  email thread to the client?" Design, troubleshooting, placement and the
  billing answer: `docs/specs/job-thread-one-conversation.md`. Read it
  before touching how client mail is sent or filed. Phase 1 is the
  ANCHORS + AUTO-FILING; Phase 2 (the Conversation panel, internal notes,
  lanes, Hand to Billing, From = the author) and Phase 3 (Gmail-native
  sending) are NOT built.
- **Why it shattered, in one line:** no send carried proof of its job. 91
  sites went through `sendAgreementEmail` with no In-Reply-To/References,
  five subjects, three Reply-Tos (rep / billing@ / hello@); `EmailThread`
  is keyed per MAILBOX (`gmailThreadId`), the pubsub never set `jobId`, and
  HQ never learned its own Message-IDs (the root of the hello@ capture
  trick for wes@).
- **`sendOnJobThread()` in `src/lib/email/jobThread.ts` is the drop-in for
  `sendAgreementEmail` at any site that knows its job** (same payload +
  `jobId`, optional `staffEmail`, `separate: true` to opt out). It puts
  three anchors on the email (rules in `jobThreadRules.ts`, pure, `npm run
  test:job-thread`): (A) an HQ-minted `<jt.<jobcode>.<uuid>@sirreel.com>`
  Message-ID + In-Reply-To/References to the job's earliest and newest
  filed message, stored on the outbound `EmailMessage.rfc822MessageId` so
  `hasKnownConversationLink` matches a FIRST reply; (B) `jobs+<jobcode>@
  sirreel.com` on Cc — the driver-relay plus-address mechanism, Cc NEVER
  Reply-To (Reply-To stays the person); (C) one subject per job, "Re:"
  once. The root thread is `EmailThread` `hq-job-<jobId>` (deterministic,
  created on first send, `jobId` set). **Its subject ADOPTS the newest
  thread already filed to the job** (the client's inquiry) and is minted
  `<job> — SirReel (<code>)` only when nothing is filed — continuing the
  client's thread is more "one thread" than starting ours.
- **Wired (Phase 1):** send-quote, job welcome, paperwork summary, manual
  follow-up, portal invite, invoice + pre-invoice (Reply-To billing@
  unchanged — billing rides the same thread, Wes 2026-09-17), and the job
  page composer (`/api/jobs/[id]/email`; its subject box is read-only
  now). The four compose helpers in `lib/email/preview/` return the
  thread subject via `previewJobThreadSubject()` (read-only, creates
  nothing) so the review modal shows what will go out. NOT wired: the
  cadence runner (`sendCadenceEmail`, its own Resend path, gated OFF by
  `CADENCE_SENDING_ENABLED`) and the pre-job sales welcome (no job yet).
- **Wired (2026-09-17, Wes: "when I do something like send a paperwork
  request or a COI request … does that automatically fall within the same
  email thread? If it doesn't let's make sure it does") — EVERY remaining
  client-facing send that knows its job, 27 sites:** card authorization
  request + the client's handoff of it, self-serve "what's next", thank-you,
  the paperwork portal link (re-sent from the order, re-sent from the
  portal, the invite to a contact added on the order, the colleague a client
  approves), negotiated agreement ready to sign, counter-proposal notice,
  agreement re-issue, the signed copies of the rental agreement and the
  stage contract, stage contract ready to sign, updated quote on change
  (LCDW / check-out), final invoice + payment options, payment details
  (job-aware caller only; the admin and inquiry callers pass no job and
  send plain), the client's payment-details share to their A/P, after-hours
  access / share / vehicle pickup, driver request, COI "more needed" and
  "approved" (job-scoped COIs; a company-level COI has no job and sends
  plain), the client's COI-requirements mail to their BROKER (client Cc'd +
  Reply-To, so the broker's answer files to the job), and the sub-rental
  estimate when it names a job. `sendOnJobThread` takes a null `jobId` and
  sends plain, so a helper with an optional job needs no branch. Every label
  has a name in `systemLabel` (the test pins the list) — a new client-facing
  send needs BOTH the wrapper and a label line, or it reads "Sent by HQ".
  The survey that found them: `sendAgreementEmail(` still has ~55 call
  sites, all staff/partner/driver/HQ notices or pre-job sends (no job).
- **Ingest (`/api/gmail/pubsub`) files an anchored thread to its job by
  itself** — `resolveJobForIngest()`: job address on To/Cc/Delivered-To/
  X-Original-To first, then the References chain against stored ids
  (through a duplicate's canonical row). FILL-ONLY via
  `fileThreadInJobIfUnfiled`; a thread a person placed is never re-pointed.
  Also: the job code is checked BEFORE the driver relay (parseRelayTag
  would claim `jobs+sr-job-…` as a driver tag); HQ's own copy of a send
  (it lands in jobs@ via the Cc) is folded onto the recorded row by the
  `X-SirReel-Job-Message` header even if Resend rewrote the Message-ID on
  the wire; MONEY-mode inboxes (billing@/payments@) keep an anchored
  message with no invoice keyword (`jobTagged` / `conversationLink`).
- **The hello@ REPLY-TO CAPTURE is OFF for thread sends (2026-09-17 — Wes:
  "I don't understand why there are emails still getting generated from the
  system that go there").** Nothing was ever ADDRESSED to hello@ — it is
  appended to REPLY-TO by `effectiveReplyTo` in sendAgreementEmail.ts
  whenever the Reply-To is an on-domain address the ingest does not fully
  watch (wes@, hq@), so what lands there is the CLIENT'S REPLY. It existed
  because a reply to a Resend send carried an In-Reply-To HQ had never
  stored, leaving no way to prove the reply belonged to an HQ conversation
  (Wes's ruling 2026-08-28, chosen over ingesting wes@). **Phase 1 removed
  that premise** — every thread send carries an HQ-minted Message-ID stored
  on the outbound row PLUS `jobs+<code>@` on Cc, two independent anchors —
  so `sendOnJobThread` passes `replyToExact: true` and the client sees the
  person alone. **A send with NO job still gets the capture**: no anchor is
  exactly the case the trick was built for (the pre-job sales welcome,
  inquiry replies). Partner mail opted out separately on 2026-09-14. Both
  directions are pinned in `npm run test:partner-mail`.
- **Unverified, by design tolerant:** whether Resend honours a caller-set
  `Message-ID`. If it does not, the ingested own-copy carries the real id
  on a thread filed to the job, so a client reply referencing it still
  resolves — one hop later. Check the first live send's headers in jobs@.
- **What the client sees:** one growing conversation per job instead of a
  row per document; "Quote", "Invoice" live in the body headings the
  templates already carry. `rentals@` team Cc unchanged through Phase 1.
- Do NOT resurrect `job_messages` (legacy, keyed by RW order number) for
  internal notes. Do NOT put the job address in Reply-To. Do NOT widen the
  wes@ LINKED filter — anchors add proof, nothing else. `startThreadForJob`
  in recordOutboundOnThread.ts has no callers now; the root thread comes
  from `jobThreadContext()`.

## The job Conversation — Phase 2 SHIPPED 2026-09-17 (Wes: "Build Phase 2")
- **Schema change — NOT `prisma db push`.** Two tables by additive SQL,
  from a phone on /admin/maintenance → "Create the job Conversation tables"
  (`job-conversation-tables`, the first `schema` task) or on a laptop
  `npx tsx scripts/add-job-thread-tables.ts` — both run
  `JOB_THREAD_TABLES_DDL` (`sr_job_threads` — the claim, one row per job;
  `sr_job_thread_notes` — internal notes). Until it has run, the panel still
  shows the emails, notes/claim read as none, and a note or claim POST
  answers 503 naming the task. Models
  `JobThreadState` / `JobThreadNote`, plain columns, no relations (the Job
  and User models are untouched).
- **The panel is `src/components/jobs/JobConversation.tsx`**, fed by
  `GET /api/jobs/[id]/conversation` (`src/lib/email/jobConversation.ts`):
  every `EmailMessage` on a thread with this `jobId`, canonical copies only
  (`duplicateOfId: null`), merged with the notes by time. It is a READ — no
  second copy of the mail. Four row kinds: client (left; quoted history
  stripped by `stripQuotedReply`), staff (right, by name — a
  `@sirreel.com` sender whatever the direction, so a Gmail reply Jose
  sent shows as his), system (the notifications@ sender, one compact line
  reading the send label back out of `triageNotes` — `recordOutboundOnThread`
  now writes `label:<EmailPayload.label>` there; unknown label → "Sent by
  HQ"), and note (violet, dashed, "Internal · never sent").
- **Lanes are derived on read, no column** (`laneFor` in
  `src/lib/email/conversationRules.ts`, pure, `npm run test:job-conversation`):
  system → by label (invoice/pre-invoice = BILLING); staff → BILLING role
  or a billing inbox; client → the inbox it landed in (`routingHeaders.
  deliveredTo`, To, Cc) — billing@/payments@/ana@ = BILLING. Filter chips
  All / Sales / Billing in the panel header; notes always show.
- **Claim:** "<name> is answering" / "Handed to Billing" / "Handed to
  Sales" / Release — `POST …/conversation/claim`, `applyClaim` is the pure
  transition (a new claim replaces the old; a hand leaves nobody holding
  it and points the lane). **Hand to Billing emails `COPY_RECIPIENTS.
  billing`** with a link to `/jobs/[id]?tab=conversation` (label
  `job-thread-handoff`). Audited `job.thread_claimed|handed|released`.
- **Notes:** `POST …/conversation/notes`, `cleanNote` (4000 chars),
  `@First` / `@First Last` mentions matched against HQ users into
  `mentions` (ids). A plain note notifies nobody — the chip row under the
  box is the nudge. Audited `job.note_added`. Do NOT use the legacy
  `job_messages` table for this.
- **URGENT notes (Wes 2026-09-17: "something that elevates it from an
  internal chat … to 'this needs to be seen right now' by whomever is
  tagged").** The "Mark urgent" toggle in note mode → `urgent: true` on the
  POST → `raiseUrgentAlerts`: every tagged person (never the author) gets a
  TEXT to `User.phone` (the /admin/assistant mobile) via `sendTracked`
  with `source: 'staff'` — exempt from quiet hours on purpose, a person
  pressed it — else an EMAIL (label `job-thread-urgent`), else recorded as
  unreachable. Pure half in conversationRules: `urgentPlan` (who, how),
  `urgentSmsText` (140-char excerpt + deep link), `alertSummary` ("texted
  Ana · emailed Julian · Chris unreachable"). **Refused with nobody tagged**
  (400) — the panel disables the button and says "Tag someone first".
  **A note is urgent when it has rows in `sr_job_thread_alerts`** (one per
  recipient: channel SMS/EMAIL/NONE, status SENT/FAILED/SKIPPED, sentTo,
  detail) — no column on the note, so the table went in by CREATE TABLE
  alone: `JOB_THREAD_TABLES_DDL` now carries THREE tables and Wes re-runs
  "Create the job Conversation tables" once (dry run shows one missing).
  Until then the texts still go out and the audit row `job.note_urgent`
  records them; only the red chip on the card is lost. The card is red
  with an URGENT pill and the summary line; the sender's toast reads the
  same summary, so a failed text is never mistaken for a sent one.
- **A reply to the client is CONFIRMED before it goes (Wes 2026-09-17:
  "Things that are going out to the client need to be flagged or confirmed
  because I'm a little bit afraid that someone's going to try to write an
  internal note and accidentally send an email to the client").** Two taps:
  the first ARMS the reply and shows exactly who receives it (To, Cc,
  from); the second sends. Any edit to the message, the recipients or the
  mode disarms it, and ⌘↵ follows the same two taps. Notes never arm.
- **The armed strip also reads the WORDS, not just the recipients.**
  `internalNoteTells()` in conversationRules.ts (pure, in
  `test:job-conversation`) looks for the marks of a team note — an
  @mention of someone on staff, a "Hey team" / "Hi all" opener, a
  colleague addressed by first name at a line start — and names each one
  with a **"Keep it internal instead"** button that files the draft as a
  note and emails nobody. Loud, never blocking: "Hi all" to a production
  is a real thing to write. The recipient list answers "who gets this";
  this answers "what IS this", which is the half Wes was afraid of.
- **Server-side, `POST /api/jobs/[id]/email` refuses without
  `confirmed: true`** (400). The arm step is what supplies it, so a
  composer that skips the confirmation — a future one, or a stale tab —
  cannot put a message in front of a client. `JobEmailButton`'s modal is
  its own review and passes it. The Chat page does not send client mail.
- **The composer is the Phase 1 send** (`POST /api/jobs/[id]/email`), now
  **From = the author** (`Jose Pacheco <jose@sirreel.com>` through Resend's
  verified domain — the cadence runner has sent as the agent that way since
  it shipped); a sender outside `@sirreel.com` falls back to SirReel HQ.
  Subject is the job's and read-only; the job address is implicit ("filed
  to SR-JOB-…" chip). ⌘↵ sends. No attachment picker yet — the Send quote /
  Send invoice buttons still carry the documents. **Cc from the job (Wes
  2026-09-17):** under the free-text Cc box, "Cc someone on the job…" lists
  the job's contacts not already in To/Cc (pick one, it re-lists the rest)
  and "Cc everyone on the job (N)" adds them all; the box stays free-text
  for an outside address. Both feed the same comma list the route parses
  (`MAX_JOB_EMAIL_CC` 15). **A client email is TWO taps (Wes 2026-09-17:
  "I'm a little bit afraid that someone's going to try to write an
  internal note and accidentally send an email to the client"):** "Email
  client…" ARMS it and shows To / Cc / from in an amber strip; "Yes, send
  to the client" sends. Editing anything disarms. ⌘↵ follows the same two
  steps; a note never arms. The @chip row shows EVERY active teammate but
  yourself (the old `slice(0, 8)` hid Jose and Ana) and a chip already in
  the note is lit and inert.
- **Placement — a DOCK owned by the /jobs layout, not the job page**
  (Wes 2026-09-17: "a minimize button for the chat window so that we can
  leave it open on top of the other jobs that we are looking at. Also, a
  close window button"). The panel used to be an `<aside>` in
  `/jobs/[id]/page.tsx`, so it died on every walk from one job to the next
  — there was nothing to leave open. `JobChatDock.tsx` mounts it from
  `jobs/layout.tsx` (the same trick that keeps the rail's scroll
  position), as the third flex child of the list|detail row.
  - Three states, ONE mount: **open** = a reserved 400px column at 1280px+
    (a flex child, so it never covers the job) and a `fixed inset-0`
    window below that; **min** = a pill at the bottom right naming the job
    it holds, over everything; **closed** = gone. Minimise HIDES the panel
    rather than unmounting it, so a half-typed note survives.
  - **Follow mode** is what preserves the old always-on rail: while
    nobody has pressed either button the window re-binds to whichever job
    is on screen. Minimise and close both stop it (that is what pinning
    means); the job header's **Conversation** button is the only way back,
    and it carries the "client replied" dot. Following is gated on 1280px
    — below that an open window is the whole screen, and a job page that
    buries itself under a chat on arrival is not a rail.
  - The window can hold job A while you read job B — that IS the feature,
    and also exactly how someone writes into the wrong conversation, so
    the pane carries a **"Holding SR-JOB-A — you're on B · Switch"** strip
    and an "Open SR-JOB-A" link. `key={target.id}` on the panel means a
    draft never rides from one job to another.
  - `?tab=conversation` is still the deep link (the Hand-to-Billing email,
    an urgent note's text, the order page, /chat) — it OPENS the window,
    once per job. The `ConversationTabs` strip is gone; the dock is the
    entry point at every width. `JobEmailThreads` is gone from the job
    page (still used by /rentalworks/reconcile); `JobEmailButton` stays
    for the counter-proposal panel.
- **Rail:** `/api/jobs` rows carry `conversation: { awaitingReply,
  lastInboundAt }` from ONE `emailThread.groupBy` over the page
  (`conversationSummaryForJobs`: newest inbound on any thread filed to the
  job newer than our newest send). The rail shows a "Client replied" chip.
  The order page shows a link to the job's conversation and no composer —
  one place to write.
- **The Chat page — /chat, every conversation YOU are in (2026-09-17 —
  Wes: "a chat tab on the left menu … all chats, no matter which job, will
  show up here … another way to communicate if you're not already in the
  job", then at once "the chats shouldn't be for everyone. It should be
  for everyone who is included in that chat. In other words if it was
  directly @billing, it wouldn't show up in Hugo's and vice versa").**
  - **INCLUSION, not a listing.** `chatInboxFor(actor)` in
    `src/lib/email/chatInbox.ts` collects jobs by REASON and the row NAMES
    the reason: `mentioned` (@you in a note) · `holding` (you hold the
    claim) · `wrote` (your note, or mail from/to you on the thread) ·
    `rep` (you are `Job.agentId`) · `desk` (handed to Billing, or it
    landed in billing@/payments@/ana@, and you ARE the billing desk —
    `isBillingDesk`, role BILLING or one of those inboxes). **Seniority is
    not a reason**: an ADMIN sees what they are in, nothing more. If you
    cannot see why a job is in your list, the rule is wrong.
  - Scoped SERVER-side off the session (`GET /api/chat` passes no user id
    and has no "all" mode). Bounded: 45-day window, ≤60 jobs, capped
    sub-queries. Cc-only participation is NOT a reason — `EmailMessage`
    has no cc column (Cc lives in `routingHeaders` JSON), and jobs@ is on
    every send anyway.
  - **Order is attention, not time** (`chatTier` / `sortChatRows`, pure):
    urgent-for-you → tagged-you → client waiting → the rest, newest first
    inside each. "Still on you" is DERIVED — tagged and you have not
    written since; there is no read/unread table and this did not add one.
  - **Replies here are INTERNAL NOTES only** (Wes asked which way; the
    split is by risk). A note's context is the note, so it answers inline
    — and it POSTs to the job's own notes route, so it is ONE record that
    "shows up simultaneously in the chat page and the job internal notes",
    never a copy. Urgent + @chips work the same as on the job. **A client
    email needs the job**: that message quotes dates and money that live
    on the job page, and the two-tap confirm lives there too — one
    composer, so the guard rails cannot drift. Every row carries "Open the
    job to email the client".
  - **Company + job on every row AND above the reply box** (Wes: "it needs
    to be very clear what company and job it is referring to") — the
    header scrolls away on a phone, so the box repeats it.
  - **Search at the top does TWO things** (Wes 2026-09-17: "we probably
    need a search field at top of chat to find jobs or clients that we want
    to message about"): it filters the rows you HAVE in the browser as you
    type, and — debounced 250ms — asks `GET /api/chat?q=` for jobs you are
    NOT in, listed under "Not in your chat" with the same two actions. That
    is what lets a conversation be STARTED here, not only continued.
    `searchJobsForChat` matches production / job code / CLIENT company /
    a person on the job (the same four the /jobs box uses) and is scoped by
    `resolveDataScope` + `jobScopeWhere` — the /jobs list's own helpers, so
    chat opens no door that page does not. Archived jobs excluded.
  - Nav: `CHAT_ITEM` in permissions.ts is in ALL FOUR branches (sales,
    billing, yard, the fixed IA) — the yard gets tagged as often as sales.
    A shared nav row is not a shared view; the page scopes it. **FIRST in
    every branch, directly under the Incoming pill** (Wes 2026-09-17: "I
    assume the chat item will sit at the top of the left menu, just under
    Incoming?"). That NARROWS the 2026-09-03 ruling ("move the Reservations
    tab to the top of the list and have that be the default view for
    everyone") to its second half: Reservations is still where everyone
    LANDS — `defaultLandingPath` is untouched — it is just no longer the
    top row. A chat tab people have to hunt for is one nobody reads.
- NOT built: an attachment picker in the composer; a mention notification;
  the role gate on the Billing lane (Wes's recommendation was to leave it
  visible); the New inbound column link; Phase 3 (Gmail-native sending).

## Active Roadmap
1. AI fleet optimization
2. RentalWorks token refresh automation
3. Update Timeline page to use real jobId instead of cart_id
4. Planyo decommission tail (cutover shipped 2026-09-14) — clear the
   residual `/planyo-cancellations` queue, then delete the `planyo-sync`
   cron entry + `src/lib/sync/planyo/` once it has been dark a month.
   Plan artifact: eb4023dd

(Removed as shipped: Julian's dispatch view = /dispatch "Deliveries &
Pickups"; standalone /jobs list + detail; the new-quote auto-create-job
fallback was replaced by Job-as-root + JobResolverModal.)

## Sales workspace (2026-08-27: merged into /jobs)
- `/jobs` IS the one-stop shop (Wes: "incoming, active and wrapped").
  The landing panel (nothing selected) is the former /inquiries
  workspace intact: New inbound (NewInboundColumn) + QuotesOutPanel
  (the ONE sent-quotes list, follow-up Nudge attached) +
  SalesReservationsWidget + SalesSignalsStrip + the Today strip. The
  sidebar carries active/wrapped (cadence colors + readiness chips)
  plus a pinned "Incoming · N" strip; `/jobs?panel=incoming` is the
  mobile route into the landing panel. Action Items folded in too
  (2026-08-27): ActionItemsPanel renders the registry on the landing
  (omitted when empty) and /action-items redirects to /jobs — no
  separate nav entry.
- `/inquiries` and `/sales/pipeline` both redirect to /jobs;
  `/inquiries/[id]` stays a real page (email deep links). The old
  kanbans/Prospects/FunnelMetricsStrip/InquiriesSection/OpenQuotesPanel/
  FollowUpsDuePanel and /api/sales/metrics were DELETED (kanban
  WON/LOST columns were structurally broken — do not resurrect).
- AGENT role gets a trimmed nav branch in getNavSections; sales lands
  on /jobs (defaultLandingPath). There is no separate Inquiries nav
  entry anywhere.
- Inquiry conversion now always closes the inquiry: new Job →
  convertedJobId; attach-to-existing-Job → convertedOrderId.

## /jobs list scope (2026-08-29 — Wes)
- Wes: "we really don't need to have old jobs that accessible. just
  archived. Anything older than 30 days is unnecessary to be on the
  main access page."
- **Default sort is `recent` (Recently touched)**, ordering on
  `lastActivityAt` = newest of `Job.updatedAt` and every order's
  `updatedAt`/`quoteSentAt`. The old default sorted by JOB creation, so
  sending a quote (which touches the ORDER) never moved the job —
  SR-JOB-0219 sat at position 37 the morning it was quoted. The old
  behaviour survives as "Newest job".
- **Dormancy is NOT a date cut.** `scripts/archive-dormant-jobs.ts`
  archives only when ALL of: no activity in 30 days, no future dates on
  the job / its orders / its live bookings, no order outside
  CANCELLED-CLOSED, and no non-void invoice with a balance. Measured
  2026-08-29: 52 jobs were stale but FOUR were still live (Extended
  Stay + Desigual x DL had future dates; two carried open orders). A
  naive age cut buries real upcoming rentals — do not "simplify" this
  to `createdAt < 30d`.
- 48 archived on 2026-08-29 (Planyo-era, last touched 07-19); reversible
  by captured id in `journals/archive-dormant-jobs-*.json` + AuditLog action
  `job.archive_dormant`. Archived jobs stay reachable via the toolbar's
  Archived filter.
- List cap raised 200 -> 300 as a BACKSTOP only. It was silently
  truncating (250 live jobs, take:200 — the 50 oldest were unreachable
  while the header read "200 JOBS"). Re-run the sweep rather than
  raising the cap again; a truncated list gives no sign it was truncated.

## /jobs redesign (2026-08-28 — Wes's design session)
- **JobsToolbar** (rendered by the jobs LAYOUT above the list|detail
  split) carries the page title + Incoming pill + search + status/sort
  + Mine + the color-legend chips + the two create buttons, **Make
  Reservation** and **New Order** (`CreateLaunchers`; the global shell
  header row was DELETED — the launchers live here and in the mobile top
  bar). "+ New Job" was retired 2026-09-10 (Wes: "all jobs are triggered
  by either Make Reservation or New Order") — both paths resolve the job
  through JobResolverModal, so nothing creates a bare job. The rail
  (JobsSidebar) is JUST the list + a slim count strip.
- Landing "Today" strip split into **Going out / Coming back** cards
  (Out/Back-strip vocabulary); the not-returned one-liner lives in
  Coming back.
- **rowState's date fallback is start-aware**: zero-order (Planyo-era)
  jobs starting today read 'picking-today' (one-day windows too),
  starting tomorrow 'picking-tmw' — before this, Going out was always
  empty because picking states only derived from HQ order cadence.
- **Job.returnedAt is the not-returned kill switch**: rail rows in
  'overdue' carry a one-click "✓ returned" (POST
  /api/jobs/[id]/mark-returned). 2026-08-28 purge stamped all 54
  phantom overdues (returns weren't handled in HQ; journal in
  journals/purge-not-returned-*.json, AuditLog action
  job.backfill_returned).
- Reservations Out/Back strip: one-day rentals render ONCE (Going out,
  "back same day" chip); reservation cards carry
  attachedOrderId/Number (job-orders ∪ booking-orders union) → violet
  "order" chip, click opens the order.

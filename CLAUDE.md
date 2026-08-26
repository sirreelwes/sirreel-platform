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
  - Planyo (Site ID 36171) remains the team's working surface until Wes announces the switch. Anything booked/edited in Planyo after the import is DRIFT: re-run `scripts/scheduling-planyo-migration.ts --write` for new carts (journal-idempotent, appends by planyoCartId); for edits to already-imported carts use the supersede recipe — release the cart's items (assignments → SWAPPED, items → UNFULFILLED), delete its Reservation journal rows by captured id, re-run `--write`.
  - Still no write-back to Planyo. Post-import manual list (report): 3 Lankershim room assignments, 1 backup-hold linkage, agent reattribution (imports default to Wes as agent).
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
- Dark theme: `bg-zinc-900` containers, `bg-zinc-800` inputs, `border-zinc-700`, `text-white`, `text-zinc-400` labels, `text-zinc-500` hints
- Accent: `bg-amber-600 hover:bg-amber-500` for primary CTAs
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
  production company (`PATCH /api/jobs/[id]/company`, job + orders move
  together) and re-issue an agreement signed under the wrong one
  (`POST /api/orders/[id]/agreement/reissue`). The superseded signature is
  snapshotted to `sr_agreement_reissues` — SignedAgreement is unique on
  (orderId, contractType), so re-releasing overwrites it.
- The client COI drop link now runs the AI review on arrival (it used to store
  the PDF with no analysis at all).

## Active Roadmap
1. AI fleet optimization
2. RentalWorks token refresh automation
3. Update Timeline page to use real jobId instead of cart_id
4. Reservations go-live announcement (plan artifact: eb4023dd) — 6 stage
   residuals for Julian/Hugo, then Wes announces; Planyo → read-only

(Removed as shipped: Julian's dispatch view = /dispatch "Deliveries &
Pickups"; standalone /jobs list + detail; the new-quote auto-create-job
fallback was replaced by Job-as-root + JobResolverModal.)

## Sales workspace (2026-08-21)
- `/inquiries` IS the sales home: New inbound (NewInboundColumn) +
  QuotesOutPanel (the ONE sent-quotes list, follow-up Nudge attached) +
  SalesReservationsWidget + SalesSignalsStrip. `/sales/pipeline`
  redirects there; the old kanbans/Prospects/FunnelMetricsStrip/
  InquiriesSection/OpenQuotesPanel/FollowUpsDuePanel and
  /api/sales/metrics were DELETED (kanban WON/LOST columns were
  structurally broken — do not resurrect).
- AGENT role gets a trimmed 8-tab nav branch in getNavSections;
  sales lands on /inquiries (defaultLandingPath).
- Inquiry conversion now always closes the inquiry: new Job →
  convertedJobId; attach-to-existing-Job → convertedOrderId.

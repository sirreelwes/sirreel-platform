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
  - NOT done: the pick-list floor (`/warehouse/pick/[id]`) still records
    only `PickListItem.scannedCode`; no write-back to RW; no camera
    scanning (wedge/keyboard only, as before).
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
  Then on /crm/portals#vendor: set the deal, file the standard agreement,
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
  Vendor row + `partnerProspectAt`; journals the id). Then /crm/portals#vendor:
  introduction (Wes) → they reply → Mark as new partner → deal → standard
  Partner Equipment Agreement → email the link. Nothing has been run yet.
- The introduction (`buildIntroDraft`) is first contact in Wes's words
  ("It's Wes Bailey from SirReel…", feature / order / confirm / deliver /
  bill / pay, "both parties", "win/win!"), signed name / Founder & CEO |
  SirReel Studio Services / M: (User.phone, dotted) / E:.
  `scripts/set-user-phone.ts` sets the phone.
- `npm run test:battery-candidates` guards the registry; `npm run
  test:partner-stage` guards the stage rule.

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
  existing discount is caught at send/book, not at the add. VSM Planet is
  not in the DB yet. The column went in by targeted `ALTER TABLE … ADD
  COLUMN IF NOT EXISTS` — the live DB has drift, never `db push` blind.

## Active Roadmap
1. AI fleet optimization
2. RentalWorks token refresh automation
3. Update Timeline page to use real jobId instead of cart_id
4. Reservations go-live announcement (plan artifact: eb4023dd) — 6 stage
   residuals for Julian/Hugo, then Wes announces; Planyo → read-only

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

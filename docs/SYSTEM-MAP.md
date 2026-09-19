# SirReel HQ — System Map

Structural orientation for anyone (human or agent) who needs to understand
this codebase before changing it.

**This is the "what and where". It is not the law.** The law is `CLAUDE.md`
(why things are the way they are, and what must never be tidied away) and the
Hard Rules at the top of `SHIPLOG.md`. `CLAUDE.md` is organised
chronologically by ruling, which makes it superb for "why is this like this?"
and useless for "where does X live". This file is the other half.

Measured against `main` on 2026-09-19. Where a number is here, it was counted,
not remembered.

> Supersedes `ARCHITECTURE-AUDIT.md` (2026-07-02), which is badly stale — it
> describes 86 models and a 4,498-line schema. The system has since roughly
> doubled. Treat that file as history.

---

## 1. What this is

The internal operations platform for **SirReel Production Vehicles, Inc.**, a
Los Angeles production-vehicle and equipment rental company. It runs the
business end to end: quoting, reservations, the client portal, contracts and
e-signature, insurance certificates, the warehouse floor, the vehicle yard,
driver dispatch, invoicing and collections.

It is live at `hq.sirreel.com`. The staff side is small — `CLAUDE.md` names
seven people and their roles, and it is worth reading that list, because a
surprising amount of this codebase is shaped by one named person's working
habits. Clients, rental partners and drivers reach it through tokenised
portals and never sign in.

**There is no staging environment and no test database.** Read §9 before
running anything that touches data.

---

## 2. Stack and scale

Next.js 14 (app router, `src/`) · TypeScript · Prisma · Neon PostgreSQL ·
Vercel · Tailwind.

**Roughly 2,300 hand-written source files and ~461,000 lines.** None of it is
generated — the largest file in the repo is a 7,589-line page component
somebody typed.

| Area | Files | Lines |
| --- | --- | --- |
| `src/app` (routes + pages) | 907 | **157,145** |
| `src/lib` (the logic) | 762 | **141,598** |
| `src/components` | 314 | **95,493** |
| **`src/` total** | **1,984** | **395,260** |
| `tests/` | 186 | 23,781 |
| `scripts/` | 107 | 16,611 |
| `prisma/` | 14 | 12,881 |
| Docs (`CLAUDE.md` 2,921 · `SHIPLOG.md` 754 · `docs/`) | 23 | ~12,400 |

| | |
| --- | --- |
| Prisma models / enums | **178** / **123** (10,780-line schema) |
| API **endpoints** | **916** (in 696 `route.ts` files) |
| Pages | **193** (168 staff/portal + 25 public) |
| React components | **309** |
| `test:*` npm scripts | **183** (178 run green with no DB) |
| Vercel cron entries | **30** (27 handlers; the daily brief is scheduled twice) |
| Email templates | **34** |
| Action-item providers | **23** |
| PDF documents | **30** |
| Environment variables | **73** |
| `AuditLog` action strings | **181** |
| Prisma migration files | **5** — see §9 |

**Count endpoints, not route files.** One `route.ts` exports up to five
handlers, so the API surface is 916, not 696: **392 GET, 388 POST, 60 PATCH,
60 DELETE, 16 PUT.** A sweep that counts files understates the surface by a
third.

**Calibrate on this before you estimate anything.** A question like "where is
X handled?" can have six right answers here, and a sweep across "the whole
codebase" is not a thing you can do in one pass. Work from the domain spine
(§3) and the directory map (§4) down to the file, rather than searching
broadly and hoping.

Runtime dependencies are deliberately few: `@prisma/client`, `next-auth`,
`resend` (email), `@react-pdf/renderer` + `pdf-lib` + `pdfjs-dist` (documents),
`@vercel/blob` (private file storage), `googleapis` (Gmail ingest),
`@anthropic-ai/sdk` (the AHA assistant and document review), `zod`,
`date-fns`, `lucide-react`.

---

## 3. The domain spine

Learn this graph and most of the codebase becomes legible.

```
Company ──┬─< Job ──┬─< Order ──< OrderLineItem
          │         │     │
          │         │     └─ bookingId? ─────┐
          │         │                        │
          │         └─< Booking <────────────┘
          │                 │
          │                 └─< BookingItem ──< BookingAssignment ──> Asset
          │                        │  (a CLASS      (a specific unit,
          │                        │   + quantity     dates stamped)
          │                        │   + holdRank)
          │                        ├──> AssetCategory   (legacy class)
          │                        └──> InventoryItem?  (unified catalog)
          └─< Person (via JobContact / Affiliation)
```

**The distinction that matters most:** an `Order` is the *commercial* document
(what the client is quoted and billed). A `Booking` is the *scheduling* claim
— what is held on the calendar. They are linked but separate, and the same
change often has to be applied to both. `src/lib/scheduling/followLineDates.ts`
exists entirely because editing an order's dates did not move the units held
against it.

**`BookingItem` is a held class, not a unit.** It carries a category, a
quantity and a `holdRank` (1 = a real hold; ≥ 2 = a queued backup or a
"LiteHold"). A `BookingAssignment` is what binds an actual `Asset`. A rank-2
item with no assignment consumes no capacity and is invisible on unit rows —
which is why the unassigned lane on the board has to carry it explicitly.

**Two catalog systems coexist, on purpose.** `AssetCategory` is the legacy
class table; `InventoryItem` is the unified catalog (Aug 2026). `Asset` and
`BookingItem` carry FKs to **both** — readers prefer `catalogItemId`, and the
legacy column stays populated so nothing has to be dropped. Do not "finish"
this migration on your own initiative.

### The lifecycles

123 enums, but these carry the domain. An agent that knows these can read most
of the codebase's branching:

| Enum | States |
| --- | --- |
| `OrderStatus` | DRAFT · QUOTE_SENT · APPROVED · BOOKED · LOADED_READY · ON_JOB · RETURNED · LD_CHECK · INVOICED · CLOSED · CANCELLED |
| `OrderQuoteStatus` | DRAFT · SENT · WON · LOST · EXPIRED |
| `CadenceState` | QUOTE_DRAFT → QUOTE_SENT → QUOTE_ACKNOWLEDGED → QUOTE_DISCUSSING → BOOKED → PICKUP_CONFIRMED → IN_PROGRESS → RETURNED → INVOICED → PAID → WRAPPED (+ LOST, CANCELLED) |
| `BookingStatus` | REQUEST · AI_REVIEW · PENDING_APPROVAL · CONFIRMED · ACTIVE · RETURNED · CANCELLED · ARCHIVED |
| `JobStatus` | NEW · QUOTED · ACTIVE · WRAPPED · HOLD · LOST — **not a lifecycle the app advances.** Demoted 2026-08-25 to three human off-ramps (HOLD / WRAPPED / LOST); "where is this job" is DERIVED from its orders by `jobs/cadence.ts`. Legacy ACTIVE rows are ignored. |
| `InvoiceStatus` | DRAFT · SENT · PAID · PARTIAL · VOID |
| `SubRentalStatus` | ESTIMATED · REQUESTED · CONFIRMED · PICKED_UP · ON_RENT · RETURNED · CANCELLED |
| `LineItemDepartment` | VEHICLES · COMMUNICATIONS · STAGES · PRO_SUPPLIES · EXPENDABLES · GE · ART · WARDROBE_MAKEUP · PHOTO_SHOOT |
| `LineItemPickStatus` | PENDING_PICK · PICKED · STAGED · LOADED · RETURNED · SHORT |
| `FulfillmentLane` | FLEET · WAREHOUSE · STAGE |
| `ReceiveMethod` | PICKUP · DELIVERY · WILL_CALL · DELIVER_TO_SIRREEL |
| `LostReason` | NO_RESPONSE · ACKNOWLEDGED_NO_BOOK · EXPLICIT_REJECTION · MANUAL_CLOSE · LOST_TO_COMPETITOR · BUDGET · TIMING · SCOPE_CHANGED · INSURANCE · OTHER |

**`CadenceState` is the one to internalise.** It is the derived answer to
"where is this job", computed from the orders rather than stored, and it
drives the /jobs board's colours, sort and chips.

Other spine models worth knowing: **`SubRental`** (a partner's or another
house's unit on our order), **`Vendor`** (a partner company — the model is
called Vendor, the word on screen is "partner"), **`PaperworkRequest`** (the
client's paperwork portal), **`CoiCheck`** (an insurance certificate),
**`Invoice`**, **`AuditLog`** (see §7).

---

## 4. Where things live

```
src/
  app/
    (dashboard)/     ~90 staff pages — the internal app
    (public)/        sirreel.com marketing + public catalog
    portal/          the CLIENT portal (job + company scoped)
    drive/ driver/   driver-facing, token-scoped
    coi/ agreement/  single-purpose token pages (COI drop, counsel review)
    intake/ details/ order/ invoice/ pay-details/   one-shot client links
    (vermar)/ (whitelabel)/   white-label surfaces (largely parked)
    api/             696 route handlers
  lib/               762 modules, 141k lines — the real logic lives here
  components/        314 components, 95k lines, grouped by surface
prisma/schema.prisma 178 models, 10,780 lines
scripts/             107 operational scripts, 17k lines
tests/               186 test files, 24k lines, almost all pure and offline
docs/                specs, runbooks, this file
```

**`src/lib` by weight** — measured in LINES, which tells you where the
complexity is far better than file count does:

| Area | Lines | What it covers |
| --- | --- | --- |
| `email/` | 15,822 | templates, Gmail ingest, the job Conversation, thread anchoring |
| `orders/` | 12,644 | totals, discounts, line items, status, partner lines |
| `sub-rentals/` | 9,717 | partners, rosters, agreements, the margin waterfall |
| `contracts/` | 9,117 | clause registry, PDF rendering, negotiated agreements |
| `portal/` | 7,960 | client + company portal payloads and rules |
| `sales/` | 6,733 | quoting, catalog ranking, tents/sandbags |
| `invoices/` | 5,198 | invoice generation, edits, aging |
| `coi/` | 4,385 | certificate review, requirements, broker directory |
| `fleet/` | 4,306 | DOT/BIT paperwork, inspections, photos |
| `jobs/` | 3,982 | cadence, stage, welcome, job-level rollups |
| `sync/` | 3,726 | RentalWorks + Planyo mirrors |
| `scheduling/` | 3,595 | holds, assignment windows, date-following |
| `warehouse/` | 3,537 | pick lists, unit scans, sections |
| `actionItems/` | 3,117 | the registry and its ~20 providers |
| `rentalworks/`, `collections/`, `assistant/`, `crm/` | 2,700–2,800 each | |

Smaller but load-bearing: `payments/`, `drivers/`, `catalog/`, `admin/`,
`site/`, `inventory/`, `dates/`.

### Some files are very large

**122 files exceed 500 lines; 24 exceed 1,000.** The heaviest are the staff
screens that grew feature by feature:

| File | Lines |
| --- | --- |
| `app/(dashboard)/orders/[id]/page.tsx` | 7,589 |
| `app/(dashboard)/orders/new/page.tsx` | 4,848 |
| `app/(dashboard)/jobs/[id]/page.tsx` | 4,395 |
| `components/schedule/GanttBoard.tsx` | 3,742 |
| `app/portal/job/[slug]/page.tsx` | 2,725 |
| `components/scheduling/MakeReservationModal.tsx` | 2,580 |

You will not hold these in context. Do not try — `grep` to the symbol or the
section you need and read a window around it. And do not volunteer to split
one up: they are big because a lot of decisions landed in them, each with a
paragraph in `CLAUDE.md`, and a refactor of that size is a change nobody
asked for with a very long tail.

**API routes by weight:** `portal` (84), `orders` (79), `public` (64),
`admin` (46), `jobs` (45), `crm` (44), `scheduling` (29), `cron` (27),
`collections` (24).

**`src/components` by weight:** `site` (35), `orders` (32), `jobs` (30),
`crm` (29), `portal` (24), `hq-white-label` (14, parked), `scheduling` (11),
`portal-v2` (10), `sales` (9), `collections` (8), then `reports`, `fleet`,
`coi`, `shared`, `dashboard` at 6–7 each.

**Repeatable inventories** — when you add one of these, there is an existing
set to copy the shape from:

| Thing | Count | Where |
| --- | --- | --- |
| Email templates | 34 | `src/lib/email/templates/` |
| Action-item providers | 23 | `src/lib/actionItems/providers/` |
| PDF documents | 30 | `*Document.tsx` across lib + components |
| Cron handlers | 27 | `src/app/api/cron/` |
| Maintenance tasks | 13 | `src/lib/admin/maintenanceTasks.ts` |
| Operational scripts | 107 | `scripts/` (96 allowlisted in `.gitignore`) |
| Run journals | 118 | `journals/` — the captured-ID records that make cleanup reversible |

The cron schedule reconciles exactly: 30 entries, 27 handlers under
`/api/cron`, plus `/api/gmail/watch` and `/api/admin/rw-invoice-sync`, with
the daily brief scheduled twice (morning and evening editions). No dead
schedule entries, no unscheduled handlers — checked.

**Root-level docs** beyond `CLAUDE.md` (2,921) and `SHIPLOG.md` (754): three
contract-review phase briefs (~990 lines total), `contract-negotiation-playbook.md`
(384), `DEPLOY.md` (315), `E2E-REPORT.md` (179), `README.md` (169),
`native-scheduling-v1-brief.md` (152).

---

## 5. The pattern that explains this codebase

**A decision lives in one pure module. A thin database half feeds it. Many
surfaces read it.**

**411 of 762 `src/lib` modules — 53% — never import Prisma.** That is not an
accident; it is the dominant architectural pattern, and it is why 178 of 183
test scripts run with no database at all.

The shape, every time:

- `somethingRules.ts` — pure functions, no Prisma, no `fetch`, no env. Takes
  plain data, returns a decision. Has a `npm run test:<name>` script pinning
  it, usually naming the *expensive direction* of getting it wrong.
- `something.ts` — the DB half: loads rows, calls the pure rule, writes.
- Several readers — a staff page, a client portal page, an email template, an
  action item — all calling the same rule so they cannot disagree.

Canonical examples, all real files:

| Module | The one question it answers |
| --- | --- |
| `jobs/cadence.ts` | where is this job, derived from its orders |
| `dates/pacificDay.ts` | what is "today" in the yard (never UTC) |
| `payments/cardAsk.ts` | is a card missing, declined or expired |
| `scheduling/assignWindow.ts` | is this booking block full |
| `portal/insuranceRules.ts` | must we still ask the client for insurance |
| `portal/annualSigningRules.ts` | is there an agreement to sign |
| `sub-rentals/partnerPaperGate.ts` | has this partner signed |
| `coi/insuredMatch.ts` | does the certificate name the right company |
| `warehouse/unitScanRules.ts` | what does this barcode scan mean |
| `actionItems/rules.ts` | is this item still worth showing |
| `email/conversationRules.ts` | which lane, and is this really internal |

Two reasons this is strict rather than stylistic:

1. **Client components cannot import Prisma.** Several of these rules are read
   by the client portal in the browser *and* by a server route. Putting the
   rule in a pure module is the only way both can share it.
2. **A second copy of a rule is a rule that drifts.** The repo is full of
   incidents caused by two surfaces answering the same question differently —
   the portal saying "nothing to sign" over an unsigned agreement, the unit
   picker and the assign route disagreeing about whether a block was full.

### Computed on read, not stored

Verdicts are recomputed on every read rather than frozen at write time:
whether a COI passes, whether a job is covered by an annual agreement, whether
a replacement value is complete. Fixing the underlying fact then clears the
flag everywhere with no re-run. Only raw facts off a document get stored.

### The audit log is the record, not a column

`AuditLog` carries **181 distinct action strings** (`job.welcome_sent`,
`company_agreement.superseded`, `order.unit_scanned_out`). "Has this been
sent?" is answered by the presence of an audit row, not a boolean column — a
re-send is simply a newer row, and no migration is needed to start recording
something.

### The email IS the act

For anything that notifies a human: send first, stamp after. A send failure
must leave no trace claiming it happened. And **links are appended by the
route or template, never by the editable note** — so a rep trimming the prose
cannot delete the thing the email exists to deliver.

### Refuse rather than guess

Operational scripts and maintenance tasks refuse on ambiguity — a company name
matching 0 or 2+ rows, a size not in the table, a class nobody has ruled on —
and the refusal names the fix. A wrong guess here reaches a client or an
inspector.

### One implementation, two entry points

Operational work lives in `src/lib`, with a thin CLI in `scripts/` (argv +
journal + exit code) **and** a registered task on `/admin/maintenance` so it
can be run from a phone. `src/lib/admin/maintenanceTasks.ts` is plain metadata
(the page imports it) and `maintenanceRunners.ts` maps id → function. Dry run
is the default and fails closed. Schema tasks may only run additive
`CREATE TABLE/INDEX IF NOT EXISTS` and `ALTER TYPE … ADD VALUE IF NOT EXISTS`,
gated by `src/lib/admin/additiveDdl.ts`.

---

## 6. Who can see what

**Staff** sign in with Google, gated on the email domain **and** on a `User`
row existing. Roles (`UserRole`): `ADMIN`, `MANAGER`, `AGENT`, `BILLING`,
`FLEET_TECH`, `WAREHOUSE`, `DRIVER`, `CLIENT`, plus vestigial `DISPATCHER`
(no holders; the enum value is kept because dropping it rewrites the column).

Roles resolve to capability flags in `src/lib/permissions.ts` — `bookings`,
`seePricing`, `fleet`, `warehouse`, `billing`, `crm`, `claims`, `reporting`,
`coverage`, `maintenance`, `gantt`, `calendar`, `pipeline`, `ai`, `salesOnly`.
Prefer deriving a new gate from existing flags (`canCreateOrders` is
`bookings && seePricing`) over adding a column.

**Clients, partners and drivers never sign in.** They reach scoped pages by
signed token. Tokens are narrow by design — payload is usually one id, with a
TTL, and HMAC schemes carry a **domain separator** (`coi-broker-review.v1`,
`counsel-review.v1`) so a token minted for one purpose cannot be replayed as
another. A forwarded link must never widen access.

63 API routes carry an explicit guard (`requireAdmin`, `requireYardAccess`,
`requireDispatchAccess`). `src/middleware.ts` matches `/:path*` and handles
exclusions in the function body.

**Money is gated.** The yard and warehouse roles cannot see pricing or client
contacts. Any new surface that shows a rate needs to respect that.

---

## 7. Conventions

- **Prisma is a singleton**: `import { prisma } from '@/lib/prisma'`. There
  are **zero** `new PrismaClient()` in `src/app`. Keep it that way.
- **622 of 696 API routes** set `export const dynamic = 'force-dynamic'`.
- **Order numbers** are `S{YYMMDD}-{NNN}`, Pacific daily reset, minted by
  `nextOrderNumber(tx)` *inside* the create transaction so the counter rolls
  back with a failed insert. Job codes are `SR-JOB-0001`. Eleven pre-cutover
  orders keep legacy `SR-ORD-NNNN` numbers.
- **Dates are Pacific, never UTC.** `pacificYmd()` in `dates/pacificDay.ts`.
  UTC rolls over at 5pm local and put a dozen screens a day ahead. Never
  compute "today" into a module constant — read it in the component body or
  an open tab keeps yesterday.
- **The staff shell is LIGHT.** `<main>` is `bg-[#F7F6F3]`. Use the `lt-*` /
  `chip-*` Tailwind tokens, not raw `zinc`. Dark styling is legal only inside
  a card painting its own opaque dark background.
- **Accent is `amber-*`, which is remapped to Utliiz turquoise `#0F7A93`.**
  Gold is gone.
- **16px inputs below the `sm`/`lg` breakpoint.** Anything smaller makes iOS
  Safari zoom the page on focus. Several surfaces are used on a phone in a
  yard.
- **Tests are named after the behaviour**, not the file: `test:card-ask`,
  `test:partner-paper`, `test:tent-sandbags`. If you change a pure rule,
  find its test first.

---

## 8. Integrations

| System | Status |
| --- | --- |
| **Neon PostgreSQL** | Primary datastore. One database — production. |
| **Vercel** | Host. Push to `main` = production deploy. 30 crons. |
| **Vercel Blob** | Private file storage (PDFs, photos). Streams through gated proxies — a raw blob URL 403s in a browser and must never be handed to one. |
| **Resend** | All outbound email. |
| **Gmail API + Pub/Sub** | Inbound client email ingest, filed to job threads. |
| **Twilio** | SMS/MMS. A2P 10DLC campaign approved; sends go through the Messaging Service or carriers filter them. |
| **CardPointe / Fiserv** | **LIVE in production.** Real cards. Local stays UAT. |
| **Anthropic API** | The AHA after-hours assistant, COI extraction, contract review. |
| **RentalWorks** | Legacy billing source of truth. **Being deprecated** — design new features HQ-native, not RW-aligned. |
| **Planyo** | Legacy scheduling. **Dark since 2026-09-14.** Not a source to reconcile against. |
| **Slack** | Alerting. |

Roughly 70 environment variables. `.env.example` lists the shape. **Never put
production credentials in `.env.local`** — local dev and every ad-hoc script
read it, and a prod CardPointe value there charges real cards from a laptop.

---

## 9. Before you run anything

Four facts, each of which has already cost somebody something. `AGENTS.md`
carries the short form; `CLAUDE.md` and `SHIPLOG.md` carry the full rulings.

1. **No test database.** Dev server and ad-hoc scripts hit the production
   database. Fixtures must be self-owned; cleanup deletes **by captured ID
   only** — never by pattern, shape or "looks like a test row".
2. **`prisma db push` is unsafe here.** The live database carries objects no
   schema file knows about; a push offers to drop them. Schema changes go in
   as additive SQL. `migrate reset` / `migrate dev` are never run.
3. **`npm run build` is the gate**, not `tsc` — `tsc` skips ESLint and Next's
   route validation. Must exit 0.
4. **Push to `main` deploys to production.** Branch, PR, green preview, merge.

---

## 10. Finding your way to a change

The fastest route, in order:

1. **`grep CLAUDE.md` for the feature.** Nearly every non-obvious behaviour
   has a paragraph naming who asked for it and what broke without it. If
   nothing is there, that absence is itself information — say so.
2. **Find the pure rule.** `ls src/lib/<area>/` and look for `*Rules.ts` or a
   file named after the decision. That is usually where the change belongs.
3. **Find its test.** `grep '"test:' package.json` for the area. 183 scripts,
   named after behaviour.
4. **Find the readers.** `grep -rn '<functionName>' src/` — a rule is usually
   read by 3–6 surfaces, and a change affects all of them. If you find two
   places answering the same question differently, that is a bug, not a style
   issue.
5. **Check the surfaces.** A user-visible change usually needs the staff page,
   the client portal, and sometimes an email template and an action item.

### Known rough edges

Honest inventory, so nobody mistakes these for things to fix in passing:

- **Two stale `.save` backups are COMMITTED to the repo**, and `.gitignore`
  has no rule for `*.save` (it only covers `.bak.*`):
  `src/app/(dashboard)/layout.tsx.save` and `src/lib/autoAssign.ts.save`.
  The first sits directly beside the real staff-shell layout, so a `grep` for
  shell markup can land you in a stale copy. Read the real file. Removing
  them and adding the ignore rule is a genuine small cleanup — but it is a
  cleanup nobody has asked for, so propose it rather than doing it in passing.
- **Only 5 migration files exist for 178 models.** That is the concrete shape
  of the "migration history has known drift from the live DB" rule: the
  migration directory is emphatically *not* the record of how the database got
  here, and you cannot reconstruct the schema from it. Schema changes go in as
  additive SQL and the schema file is the reference.
- **Git history may be truncated.** A cloud or CI checkout of this repo is
  often a shallow clone (`git rev-parse --is-shallow-repository` → true), so
  commit counts, `git log` depth and `git blame` are unreliable there. Do not
  reason about the project's age or churn from them without checking.
- `ARCHITECTURE-AUDIT.md` is stale (July, pre-doubling).
- **No test is genuinely red.** 178 of 183 pass offline; the other 5 want a
  live database or Chrome. The three that were red until 2026-09-19 were all
  **stale assertions**, not bugs — see `AGENTS.md`, "If you find a red test
  here, suspect the TEST before the code". Two of them encoded the day-count
  rule that flipped from exclusive to inclusive on 2026-09-12; "fixing" them
  in the code would have re-priced every daily-rate line in the system.
- Two `tsc` errors pre-exist in `tests/inventory/stock.test.ts` and
  `tests/sub-rentals/partner-intro-nudge.test.ts`.
- `AssetCategory` and `InventoryItem` coexist mid-cutover, by design.
- The schema has known drift from the live database — the schema file is not a
  complete description of what is in Postgres.
- `job_messages` is legacy and must not be resurrected for internal notes.
- White-label (`hq-white-label/`, `(vermar)`, `(whitelabel)`) is parked behind
  `PARTNER_HQ_OFFER = false`, not dead.
- `src/lib/sync/planyo/` stays until Planyo has been dark a month.

Before deleting anything that looks unused, read the "If you were told to
optimize" section of `AGENTS.md`. In this repo, surprising code is usually a
scar.

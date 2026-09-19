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

| | |
| --- | --- |
| Prisma models / enums | **178** / **123** (10,780-line schema) |
| API routes | **696** |
| Pages | **193** |
| `src/lib` modules | **747** |
| React components | **309** |
| `scripts/*.ts` | **107** |
| `test:*` npm scripts | **183** |
| Vercel cron jobs | **30** |

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
  lib/               747 modules — the real logic lives here
  components/        309 React components, grouped by surface
prisma/schema.prisma 178 models
scripts/             107 one-off and re-runnable operational scripts
tests/               186 test files, almost all pure and offline
docs/                specs, runbooks, this file
```

**`src/lib` by weight** (file counts) — this is a good proxy for where the
complexity actually is:

| Area | Files | What it covers |
| --- | --- | --- |
| `email/` | 83 | templates, Gmail ingest, the job Conversation, thread anchoring |
| `orders/` | 71 | totals, discounts, line items, status, partner lines |
| `sub-rentals/` | 44 | partners, their rosters, agreements, margin waterfall |
| `portal/` | 40 | client + company portal payloads and rules |
| `contracts/` | 39 | clause registry, PDF rendering, negotiated agreements |
| `sales/` | 30 | quoting, catalog ranking, tents/sandbags |
| `actionItems/` | 26 | the action-item registry and its providers |
| `fleet/` | 25 | DOT/BIT paperwork, inspections, photos |
| `coi/` | 24 | certificate review, requirements, broker directory |
| `jobs/` | 23 | cadence, stage, welcome, job-level rollups |
| `site/` | 20 | public catalog, search, home tiles |
| `invoices/`, `scheduling/`, `sync/`, `assistant/` | 15–18 each | |

Smaller but load-bearing: `payments/`, `crm/`, `collections/`,
`rentalworks/`, `drivers/`, `warehouse/`, `catalog/`, `admin/`, `dates/`.

**API routes by weight:** `portal` (84), `orders` (79), `public` (64),
`admin` (46), `jobs` (45), `crm` (44), `scheduling` (29), `cron` (27),
`collections` (24).

---

## 5. The pattern that explains this codebase

**A decision lives in one pure module. A thin database half feeds it. Many
surfaces read it.**

**396 of 747 `src/lib` modules never import Prisma.** That is not an accident
— it is the dominant architectural pattern, and it is why 175 of 183 test
scripts run with no database at all.

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

- `ARCHITECTURE-AUDIT.md` is stale (July, pre-doubling).
- `test:supply-estimate`, `test:week-decision`, `test:job-stage` are **red on
  `main`**. `test:supply-estimate` is a 6-day window billing as 7 — money, and
  worth a human's attention.
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

# ARCHITECTURE AUDIT — SirReel HQ

Discovery-only audit, 2026-07-02. Read-only; no code changed. Sources: prisma/schema.prisma (4,498 lines), SHIPLOG.md, src/middleware.ts, app route tree, lib/, .env.local (names only), package.json.

---

## 1. DOMAIN MAP

**86 models, ~95 enums.** Schema header comment says "21 Tables · 11 Sections" — badly stale.

### CRM
- **Company** → ProductionTypeProfile, User(defaultAgent); hub for Order/Job/Booking/Claim/CoiCheck/ContractReview/Inquiry. Carries MSA/COI/negotiated-terms columns.
- **Person** → User(assignedAgent), self(worksWith); Affiliation[], JobContact[], PortalAccess[], PersonSession[], PersonEmailAlias[], PersonMerge[]. Not company-scoped.
- **Affiliation** (Person↔Company join), **PersonEmailAlias**, **PersonMerge** (reversible merge audit), **OutreachActivity**, **Activity** (legacy `activities_crm`), **InquiryCapture** (per-email capture verdict).

### Jobs / Orders
- **Job** (`sr_jobs`) → Company, User(agent), ProductionTypeProfile?; owns Order[], Booking[], JobContact[], ContractReview[], CoiCheck[].
- **Order** (`sr_orders`) → Job, Company, User(agent), Booking?, Person?; owns OrderLineItem[], Invoice[], SubRental[], OrderDiscount[], SignedAgreement[], PickList?, PortalAccess[], CadenceEvent[], OrderDocument[].
- **OrderLineItem** → Order, InventoryItem?, AssetCategory?, Package?. **OrderDiscount**, **OrderDocument**, **ThankYouSuggestion**, **QuoteFollowUp**, **Inquiry** (→ convertedJob/convertedOrder), **JobContact**, **AgentWeeklyCandid**.

### Assets / Fleet
- **AssetCategory** (`asset_categories`) — Fleet Pricing source of truth; has Asset[], BookingItem[], OrderLineItem[], RateChangeLog[], VehicleCategory[].
- **Asset** → AssetCategory; DOT reg/BIT cert/insurance fields; has BookingAssignment[], Inspection[], CheckoutRecord[], LotCheck[], BitInspection[], DispatchTask[].
- **BitInspection**, **MaintenanceRecord**, **LotCheck**, **Driver**, **CheckoutRecord**, **Inspection** (has DamageItem[]), **DamageItem** (→ InsuranceClaim?, Invoice?, Incident?), **DispatchTask**.

### Scheduling / Bookings
- **Booking** → Company, Person, User, Job?; has BookingItem[] → **BookingAssignment[]** → Asset. Lifecycle REQUEST→…→ARCHIVED.
- **Reservation** — LEGACY Planyo mirror; native engine does NOT read it (drift).
- **PlanyoSyncRun** / **PlanyoSyncEvent** — read-only sync audit.

### Pricing / Catalog / Warehouse
- **InventoryItem** → InventoryCategory?, Vendor?, InventoryLocation?; dual location systems (legacy `Location` enum + FK) in transition.
- **RateChangeLog** — rate audit (InventoryItem? + AssetCategory?); subject of the SHIPLOG Hard-Rules incident.
- **Package**/**PackageItem**, **Vendor**, **SubRental**, **PickList**/**PickListItem**.

### Billing
- **Invoice** (`sr_invoices`, RENTAL + LD types) → Order; has Payment[], DamageItem[]. **Payment** → Invoice, PortalAccess?.

### Contracts / COI
- **ContractReview** → Job?, Company?; has ReviewChangeDecision[], SignedAgreement?. **ReviewChangeDecision**, **SignedAgreement** → Order, **StageBookingTerms** → Order, **CoiCheck** → Company?/Job?/Inquiry?, **PaperworkRequest** → Booking (legacy; snake_case `coi_*` columns bolted on — schema smell).

### Claims / Incidents
- **InsuranceClaim** → Booking?, Asset?, Company, Inspection?, Invoice?, CoiCheck?, EmailMessage?, Incident?; has ClaimDocument[], ClaimTimeline[], ClaimMail[]. **Incident** (`sr_incidents`) — hub: carrier-claim → bill-renter → absorb.

### Email / Messaging
- **EmailAccount** → User; **EmailThread**; **EmailMessage** → Company?/Person?/InsuranceClaim?, self(duplicateOf); **EmailDelivery** (Resend send audit); **AiDecision**; **CadenceEvent** (CRH engine).

### Auth / Users / Portal
- **User** — hub, ~40 back-relations; role enum + salesOnly + dataScope. **Account**/**Session**/**VerificationToken** (NextAuth), **AuditLog**, **PortalAccess** → Order+Person, **PersonSession** (passwordless portal).

### HR (isolated partition)
- **Employee**, **HrEmail**, **HrMail**, **HrAttachment** — never touch EmailMessage; hr@ short-circuited in pubsub.

### Public site
- **VehicleCategory** (`vehicle_categories`) → AssetCategory? (live price via FK); 9 public spec fields (2026-07). **ProductionTypeProfile**.

### ORPHANS (zero inbound relations)
IngestFilterStat, VerificationToken (expected), DailyCollections, HealthCheckLog, OrderDailyCounter, and the 6 "recovered" models: **Alert, ClientSession, DismissedEmail, EodReport, JobMessage** (joins by `rw_order_number` string, no FK), **PaymentLog** (legacy RW payments).

### Drift/legacy flags
- Reservation (Planyo mirror, unread) · PaymentLog vs Payment · DailyCollections vs EodReport (near-duplicates) · dual ProductionType enum vs ProductionTypeProfile table · dual Location enum vs InventoryLocation FK · legacy enum values (`PLANYO_BACKFILL`, `CHESTNUT`/`LIMA`, `DAY_0/1/3`) · retained-unused SQL sequences (`sr_order_number_seq`, `sr_claim_number_seq`, `sr_incident_number_seq`) · stale schema header count.

---

## 2. HOST / ROUTE MAP (src/middleware.ts)

Matcher `/:path*`; local/preview + unknown hosts pass through. **Middleware does host routing only — zero session checks.** All authz is per-route/layout.

- **orders.sirreel.com** — `/` rewrites → `/order/supplies`; portal/client paths 308 → tsx; allow-list (`/order/supplies`, `/vehicles`, `/api/public/`, assets); **everything else 404**.
- **tsx.sirreel.com** — `/` 307 → `/portal/auth/sign-in`; allow-list (portal/client/coi/intake/cardpointe/public/order); **everything else 404** (client never sees staff surfaces).
- **hq.sirreel.com** — portal/client/intake/order paths 308 → tsx; **everything else passes with NO middleware auth** — route handlers are the only gate on hq.

### Public (by design)
Pages: `(public)/vehicles`, `/login`, `/client-login`, `/intake[/slug]`, `/order/supplies`, `/portal/auth`. API: `/api/public/*`, `/api/health`, `/api/cardpointe/config`, magic-link issuers (`/api/portal/auth/request`, `/api/client/auth` — rate-limited/anti-enumeration).

### Token / cookie / secret gated
`portal/[token]`, `coi/[token]`, `client/[token]` (token IS auth) · `portal/account` + `portal/job/*` (person/job session cookies) · `/api/webhooks/resend` (Svix) · `/api/cron/*` (CRON_SECRET).

### FLAGGED — mutation routes with NO guard at all (reachable unauth on hq host)
- `src/app/api/inventory/bulk-update/route.ts` — **raw-SQL % price multiplier across inventory, zero auth** (worst)
- `src/app/api/gmail/pubsub/route.ts` — Pub/Sub push processed with **no OIDC/secret verification**
- `src/app/api/gmail/{fetch,watch,sync}/route.ts`
- `src/app/api/admin/backfill-summaries/route.ts` — under /api/admin but no requireAdmin (unlike siblings)
- `src/app/api/alerts/route.ts`, `alerts/dismiss/route.ts`, `emails/dismiss/route.ts`
- `src/app/api/fleet/route.ts`, `fleetio/sync/route.ts`, `planyo/link-order/route.ts`
- `src/app/api/ai/chat/route.ts`, `tools/coi-check/route.ts`, `orders/parse-pdf/route.ts`, `orders/parse-quote/route.ts` (each burns Anthropic tokens unauth)
- `src/app/api/webhooks/cognito/route.ts` — token-param only, no signature (borderline).

Intentional-public with alternate controls (not gaps): `public/supply-request` + `public/intake` (rate-limit + Turnstile), `portal/job/[slug]/resend-link` (rate-limit), auth issuers/signout. Caveat: scan confirms a guard symbol exists per file, not that every exported method invokes it.

---

## 3. LIFECYCLE COVERAGE — OrderStatus (schema.prisma:2039)

`DRAFT → QUOTE_SENT → APPROVED → BOOKED → LOADED_READY → ON_JOB → RETURNED → LD_CHECK → INVOICED → CLOSED` (+ CANCELLED). Parallel `OrderQuoteStatus` kept in lockstep via `src/lib/orders/quoteStatus.ts`.

| State | API writer | UI | Gap? |
|---|---|---|---|
| DRAFT | orders/route.ts, from-parse, from-inquiry; generic PUT revert | "Back to Draft" (orders/[id]/page.tsx:295) | — |
| QUOTE_SENT | orders/[id]/send-quote/route.ts:200 | Send Quote button | — |
| APPROVED | lib/orders/bookOrder.ts:222; portal e-sign agreement/sign/route.ts:268 | Mark Approved | — |
| BOOKED | bookOrder.ts:154 via [id]/book | "Book it" | — |
| LOADED_READY | auto rollup only — lib/orders/loadReadyRollup.ts:120 | lane panel (no manual button, by design) | — |
| ON_JOB | generic PUT only | Mark On Job (:311) | soft: no dedicated endpoint/guard; in-code TODO :305 |
| RETURNED | generic PUT (:251 mints ThankYouSuggestion) | Mark Returned | — |
| **LD_CHECK** | **NONE — zero assignment sites in src/** | STATUS_ACTIONS skips it (RETURNED→CLOSED) | **defined-but-unreachable state** |
| INVOICED | auto — lib/invoices/sendInvoice.ts:248 (invoice SENT + RETURNED); reverted on void | invoices block | — |
| CLOSED | auto on full payment recordPayment.ts:311; manual Close (:313) | Close Order | ld-invoices/route.ts:9 warns CLOSED reachable with open L&D |
| CANCELLED | generic PUT; Planyo reconcile (reconcile.ts:188) | Cancel (:1119) | — |

- **Damage capture works but bypasses LD_CHECK**: `orders/[id]/return-damage` POST → LdDispositionPanel → `PATCH /api/damages/[id]` → LD invoice (`lib/invoices/generateLdInvoice.ts`) — all while status stays RETURNED/INVOICED/CLOSED. Wire LD_CHECK in or drop it.
- **INVOICED handoff is NATIVE, not RentalWorks** — `lib/invoices/generateRentalInvoice.ts` (PDF → Blob, anchored to bookedTotal); no rentalworks refs in invoices code.
- Editability gate: `lib/orders/editability.ts:34` — editable DRAFT→LD_CHECK, locked INVOICED+.
- **Job status enum is QUOTED/ACTIVE/WRAPPED/HOLD/LOST** (no CANCELLED; CLAUDE.md says CANCELLED — stale doc). LOST via jobs/[id]/mark-lost; HOLD has light UI surface.

---

## 4. PRICING TRUTH

- Canonical: **AssetCategory.dailyRate/weeklyRate Decimal(10,2)** (Fleet Pricing). VehicleCategory.dailyRate is fallback/override only; resolution = `assetCategory.dailyRate ?? vehicleCategory.dailyRate`.
- Read paths: `lib/site/vehicleCatalog.ts:73` (public pages) · `api/public/vehicle-categories/route.ts:47` (order form) · `api/admin/vehicle-categories/route.ts:40` (spec editor) · `api/public/catalog` + `supply-request` (InventoryItem.dailyRate) · RateChangeLog written by admin/asset-categories + inventory/items routes.
- **Duplicate resolver ×3** — the identical `?? + Number()` fallback is re-implemented inline in the three files above; no shared helper.
- **Line-item rate is a client-supplied snapshot**: `api/orders/[id]/line-items/route.ts:33` takes `rate` from the request body; server never re-resolves from Fleet Pricing (frontend resolves at orders/[id]/page.tsx:1706). `from-parse/route.ts:343` lifts rate from parsed PDF.
- **Hardcoded prices (flags):**
  - Mock fleet-rate arrays diverging from Fleet Pricing: `(dashboard)/reporting/page.tsx:37-45`, `(dashboard)/dashboard/page.tsx:92-100` (rate: 175/200/400/450/3000…).
  - Silent `?? 1000` /day fallback: orders/[id]/page.tsx:3072; `?? 0` at :1706 and SupplyOrderApp.tsx:649.
  - Contract fee constants ($24/day LCDW, $10/gal, $250/day smoking, $1,000 deductible) duplicated across 4+ files: `portal/[token]/page.tsx:1026-1076`, `api/portal/[token]/contract/download/route.ts:128`, `lib/contracts/contractClauses.ts:180`, `client/[token]/page.tsx:108,501`.
- Money columns: **all Decimal** — schema Floats are only AI-confidence scores. Clean (but see §7 write-path floats).

---

## 5. EXTERNAL SEAMS

- **RentalWorks** (billing legacy; being deprecated — CLAUDE.md forbids new RW-aligned features). Client `lib/rentalworks/client.ts` (Bearer `RENTALWORKS_TOKEN`, base URL hardcoded). Call sites: api/rentalworks/* (4 routes), bookings/by-rw-order + [id]/link-rw, crm/find-duplicates, admin/{collections,collections/debug,backfill-collections}, timeline-native, lib/{orders.ts, sales/QuoteDocument.tsx, jobs/nextJobCode.ts, health/rentalworks.ts}; UI: dispatch/rentalworks, crm/duplicates, admin/health, dashboard, client/[token], 4 dashboard components; scripts ×5. **Token rotation fully MANUAL** (runbook docs/runbooks/rentalworks-token-rotation.md; ~50-day cadence; roadmap item #3 unbuilt).
- **Gmail DWD** (ingest, read-only scope). Service-account JWT per inbox; `getGmailClient` **duplicated in each of 8 gmail routes** (no shared factory). Watched inboxes hardcoded in `lib/email/watchedInboxes.ts` (12 @sirreel.com inboxes; hr@ partitioned). Plus NextAuth Google OAuth for staff sign-in (`lib/auth.ts`, hd=sirreel.com). Legacy mock stub `lib/email.ts` still present.
- **Resend** (all outbound email). Send call sites: lib/email/{sendCadenceEmail,sendAgreementEmail}.ts, lib/invoices/sendInvoice.ts, lib/cadence/runner.ts, ~14 API routes (send-quote, invoices/[id]/send, portal invite/auth, follow-ups, thank-you, coi-review…). Webhook `api/webhooks/resend` (Svix-signed). **DKIM caveat (SHIPLOG): send domain empirically unverified — sends can fail.** `@sendgrid/mail` dep is dead (denylist string only).
- **CardPointe** (cards + ACH; UAT only, PROD flip pending underwriting). Single client `lib/cardpointe/client.ts` (`CARDPOINTE_ENV`-switched). Routes: portal/job/invoice/[id]/{pay-card,pay-ach}, invoices/[id]/payments, cardpointe/config, cron/ach-poll, admin/collections. Stale unprefixed env trio (`CARDPOINTE_{MERCHANT_ID,USERNAME,PASSWORD}`) unused by the client.
- **Vercel Blob** (private docs/images; no signed URLs → proxy pattern). Shared streamer `lib/claims/streamBlob.ts` used by 14 routes; **raw access bypasses in §7**. No shared upload helper (5 upload libs + ~10 inline `put`).
- **Anthropic** (`ANTHROPIC_API_KEY`, sdk ^0.39.0) — ~20 call-site files. Model strings inconsistent: date-pinned `claude-sonnet-4-5-20250929` (majority), unpinned `claude-sonnet-4-5` (runReview, replyClassifier, portal/job/coi), `claude-sonnet-4-6` (hr/parseHrEmail, claims/parsePastedClaim), haiku pinned elsewhere. Prior outage cause: retired-model 404 (commit 2ff66dc).
- **Planyo** (scheduling truth pre-cutover; read-only sync, no write-back by design). Client `lib/sync/planyo/planyoClient.ts`; sync lib ×8 files; routes scheduling/*, planyo/{unlinked,link-order}, cron/planyo-sync; `PLANYO_BACKFILL` rows are a stale snapshot, not live.
- **Fleetio** (fleet maintenance; plain fetch) — `lib/fleetio.ts`, api/fleetio/{test,sync}.
- **Slack** (alerts; bot-token fetch) — `lib/slack.ts`; cron health-check + planyo-sync + cadence reply-classification.
- **Wix/DNS** — no API; `lib/health/dns.ts` notes sirreel.com marketing site is Wix-hosted (this repo's public-site work is the replacement path); Cloudflare DNS, resolver-only.
- Env names (values never read): ANTHROPIC_API_KEY · BLOB_READ_WRITE_TOKEN · CARDPOINTE_{UAT_*, MERCHANT_ID/USERNAME/PASSWORD stale} · FLEETIO_{ACCOUNT_TOKEN,API_KEY} · GOOGLE_{CLIENT_ID,CLIENT_SECRET,SERVICE_ACCOUNT_KEY} · NEXTAUTH_{SECRET,URL} + NEXT_PUBLIC_APP_URL · PLANYO_{API_KEY,SITE_ID} · RENTALWORKS_{URL,TOKEN,USERNAME/PASSWORD unused} · RESEND_API_KEY (webhook secret prod-only) · SLACK_BOT_TOKEN · DATABASE_URL · CRON_SECRET · CADENCE_SENDING_ENABLED.

---

## 6. AUTH / ROLE MATRIX

- Roles (schema:1770): ADMIN, MANAGER, AGENT (default), DISPATCHER, FLEET_TECH, DRIVER, CLIENT. Orthogonal axes: `salesOnly` bool, `dataScope` TEAM|OWN. Google-only sign-in, domain-locked (lib/auth.ts).
- **Only hard role gate is `requireAdmin`** (lib/auth-admin.ts) — used by just 9 of 22 /api/admin routes (asset-categories ×3, vehicle-categories ×2, locations ×2, health ×2).
- **Effective matrix:** ADMIN = everything. **Any signed-in AGENT can mutate:** inventory items + rates (`api/inventory/items` POST/PUT/DELETE — "any authenticated user" by comment), pricing packages (`api/admin/packages` POST/PUT/DELETE — session-email check only), orders/jobs/crm/claims (session), and **inventory bulk price multiplier with NO session at all** (`api/inventory/bulk-update`).
- Domain gates are bespoke helpers, not the role enum: requireDedupAccess (email allowlist), requirePickerRole, requireDispatchAccess, requireSubRentalAccess, requireHrAccess, claims allowlist, exec requireCoverageAccess. Permissions layer (`lib/permissions.ts` ROLE_PERMISSIONS/can) is enforced server-side in only 2 routes (incidents).
- **UI-only enforcement:** getNavItems/can consumed client-side ((dashboard)/layout.tsx, RoleContext.tsx, orders/[id]/page.tsx…) — salesOnly agents just don't SEE inventory/pricing; the APIs accept their session. permissions.ts:291: "intentionally NO role-gating here."

---

## 7. DUPLICATION / DRIFT

- **Prisma singleton:** clean in src/ (only lib/prisma.ts). 18 scripts/ files + 5 loose root .ts scripts each new up their own client (acceptable for one-shots).
- **Email send paths:** no canonical helper. `lib/email.ts sendEmail()` is a dead stub (send commented out). 3 independent `new Resend()` clients: sendAgreementEmail.ts:54, sendCadenceEmail.ts:136, and `api/client/auth/route.ts:5` (inline magic-link, bypasses everything).
- **Blob streaming bypasses** (raw get/getBlob instead of streamPrivateBlobAsResponse): `api/portal/job/invoice/[id]/pdf/route.ts:27` (the pattern's own origin, never migrated), `api/invoices/[id]/pdf/route.ts:16`, `api/portal/[token]/agreement/signed-copy/route.ts`, `api/tools/contract-review/[id]/{file,counter-pdf}/route.ts`. No shared upload helper at all.
- **fmtMoney duplicated 26+ times** inline (billing.ts:160, QuoteDocument.tsx:198, 7 sales components, SupplyOrderApp, both admin pricing pages, both public vehicle pages…) + variants fmtCurrency/money/formatCurrencyDisplay. **fmtDate ×20+** with divergent format strings (3 server-side in portal agreement routes). `src/lib/format/` contains only phone.ts.
- **Money-as-float write paths** (Decimal columns fed JS floats): `api/inventory/items/route.ts:58-60` + `[id]/route.ts:61-64` (parseFloat), `api/admin/packages/route.ts:94` (Number), `api/sub-rentals/route.ts:121` + `[id]/route.ts:93` (Number → derived totals), and **`api/inventory/bulk-update` applies a float multiplier via raw SQL with no cent rounding**.
- **Gmail client factory duplicated** across all 8 gmail routes (see §5).
- Schema drift: the 6 "recovered" models exist because live DB and schema diverged (recover-and-add-jobs.js); migration history unusable (`db push` only, per CLAUDE.md).

---

## 8. TOP 10 SEAM RISKS (ranked)

1. **`api/inventory/bulk-update/route.ts` — unauthenticated raw-SQL bulk price mutation** (float multiplier, no rounding, no auth, reachable on hq host).
2. **UI-only role enforcement** — salesOnly/AGENT sessions can write inventory rates + pricing packages via API despite hidden nav (`api/inventory/items/*`, `api/admin/packages/*`; lib/permissions.ts is client-side).
3. **16 unguarded mutation routes on hq host** — middleware never checks sessions there; gmail/pubsub accepts unverified push; parse/ai routes burn Anthropic tokens unauth (§2 list).
4. **RentalWorks manual token rotation** — ~50-day expiry, hand-minted, Slack-alert-reactive; collections/dashboards go dark on miss (`lib/rentalworks/client.ts`, runbook; roadmap #3 unbuilt).
5. **Resend DKIM unverified send domain** — outbound email (quotes, invoices, magic links, COI) can silently fail; plus 3 divergent send paths and a dead sendEmail stub (SHIPLOG recurring note).
6. **LD_CHECK unreachable + CLOSED-with-open-L&D** — damage flow bypasses the state machine; nothing forces L&D resolution before close (`api/orders/[id]/ld-invoices/route.ts:9`).
7. **Client-supplied line-item rates** — server trusts request-body `rate`; a compromised/buggy client writes arbitrary prices into quotes/invoices (`api/orders/[id]/line-items/route.ts:33`).
8. **Anthropic model-string sprawl** — ~20 files, mixed pinned/unpinned/4-6 IDs; a retirement 404s features one by one (already happened: 2ff66dc). No central model constant.
9. **Schema/DB drift is structural** — 86 models vs "21 tables" header, 6 recovered orphans, dual enum/table systems (Location, ProductionType), dead Reservation mirror; `migrate dev` permanently unusable.
10. **Hardcoded price/fee constants drifting from Fleet Pricing** — mock rate arrays in reporting + dashboard pages, `?? 1000` fallback, contract fees duplicated ×4 files (§4).

---
*End of audit. 5 parallel discovery agents; no app run, no tsc, no code changes.*

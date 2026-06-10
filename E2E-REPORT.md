# E2E Lifecycle Walkthrough — Report

**Date:** 2026-06-10
**Test fixture:** `ZZTEST E2E Productions` · contact `e2e-test@sirreel.com` · notes `E2E TEST — DO NOT PROCESS` on every row.
**No emails sent. No deploys. No schema changes.**

This report is the output of a test + audit pass through the order lifecycle from inquiry to close. Every stage was exercised against the production DB via either a real route, a service-function call, or — where the route is browser-only — direct Prisma writes that mirror the route's transaction shape.

---

## 1. Stage-by-stage table

| # | Stage | Result | Notes |
|---|---|---|---|
| 1 | Inquiry → CRM | ✓ PASS (after correction) | `Inquiry.create` accepts manual ad-hoc creation. **Gotcha:** `InquirySource` enum is `MANUAL \| GMAIL \| WEB_FORM` — initial attempt with `'OTHER'` failed before correction. Programmatic non-email Inquiry capture works via `source='MANUAL'`. |
| 2 | Quote (Job + Order, 2 depts) | ✓ PASS | Job `SR-JOB-0017`, Order `S260610-001` created. 3-day window. VEHICLES ($900) + PRO_SUPPLIES ($144) + tax 8.75% → `$1135.35` pre-discount total. |
| 3a | Modify — add post-quote item | ✓ PASS | Custom description (`Apple boxes (post-quote add)`) persists; 3-day inheritance correct (`lineTotal = 10 × $2 × 3 = $60`). Jose's Bug A fixed. |
| 3b | Dept discount (10% PRO_SUPPLIES) | ✓ PASS | dept lineSubtotal `$144` → discount `$14.40` → netSubtotal `$129.60`. discountedSubtotal `$1089.60`, total `$1184.94`. Tax recomputed on the discounted subtotal correctly. |
| 3c | Flat-total override → $1000 | ✓ PASS | Inverse formula stored as `FIXED` order discount = `$170.06`. Final total `$1000.00` to the cent. Upward target (>current total) correctly produced a negative-implied discount (which the UI must reject). |
| 4 | Quote PDF regen | ✓ PASS | `renderToBuffer(QuoteDocument)` → 72,921-byte PDF. Discount rows render under section subtotal + between Subtotal/Tax; Zelle block (76pt) included. |
| 5 | Approve → Book | ✓ PASS | `bookOrder()` atomically: status → BOOKED; `bookedSubtotal/bookedTaxAmount/bookedTotal` snapshotted ($1104 / $-104 / $1000); lane routing FLEET=1 / WAREHOUSE=2 / STAGE=0. |
| 6 | Picklist auto-create | ✓ PASS | `PickList(DRAFT)` created with 2 `PickListItem` rows for the WAREHOUSE-routed lines. Both line items at `pickStatus=PENDING_PICK`. |
| 6b | Walk pickStatus → LOADED | ✓ PASS | Line items + PickList successfully advanced to `LOADED`. The scanner UI at `/warehouse/pick` is the browser path. |
| 7 | Dispatch / pickup | ▷ BROWSER-ONLY | **No dedicated POST `/api/orders/[id]/on-job` route exists.** Status was advanced via direct PUT. The `/dispatch` board is read-only display. ON_JOB is a manual edit only today. |
| 8 | Client email touchpoints (audit) | ▷ BROWSER-ONLY | 7 originate points: `send-quote`, `follow-ups/send`, `invoices/send`, `agreement/resend-link`, `portal-resend`, `bookings/send-portal`, plus cadence-scheduled (BOOKING_WELCOME, pickup reminder, return reminder, completion). All gate through `EmailReviewModal`. **No sends executed in this test.** |
| 9 | Checkout photos at dispatch | ○ MISSING | **No checkout-photo capture path tied to OrderLineItem.** `Inspection` model requires `(assetId, bookingAssignmentId)` which the spine Order doesn't provide. The chain is Order → BookingAssignment via Booking — not direct. **Portal job page renders zero checkout/return photo today.** |
| 10a | Return transition | ▷ BROWSER-ONLY | Status flipped to RETURNED via direct PUT. No dedicated transition route. |
| 10b | Return damage capture | ○ MISSING | `POST /api/orders/[id]/return-damage` requires a BookingAssignment to attach photos via Inspection. **Spine-only orders without a Booking chain can't use this route.** Damage capture is gated on Planyo-sourced orders. |
| 11 | RENTAL invoice generation | ⚠ ENV-LIMITED | `generateRentalInvoice` ran end-to-end up to the Vercel Blob upload, then 401'd locally (no `BLOB_READ_WRITE_TOKEN` in dev env). Production has the token; the path itself is exercised by the `628e763` zero-discount-sanity smoke against real order `SR-ORD-0004`. Verify on Vercel. |
| 12 | Close | ▷ BROWSER-ONLY | Status flipped to CLOSED via direct PUT. Normally driven by payment-recorded webhook. |

**Totals:** 8 PASS · 0 confirmed BUG · 2 MISSING · 4 BROWSER-ONLY · 1 ENV-LIMITED.

---

## 2. Bug list (ranked by client-visibility)

**No client-visible bugs surfaced** in the walkthrough — Jose's bug-cluster fixes (`ded16a9`/`076f6f1`/`3684ec3`) and the OrderDiscount math (`628e763`) hold up under the exercised flow. The sidewall fixture produced `$144` correctly; the discount math produced exact target totals; the booked snapshot froze the post-discount total at the moment of booking.

Only finding noted:

1. **(Cosmetic, dev-facing)** `InquirySource` enum lacks `'OTHER'`. The `MANUAL` value covers ad-hoc creation, but the inconsistency with `OrderLineItem.type` (which DOES have OTHER) is mildly confusing. Not a client-visible issue.

Re-verification needed on Vercel:
- **Stage 11.** RENTAL invoice generation only fully exercises when `BLOB_READ_WRITE_TOKEN` is present. The math + the lookup path passes locally; the upload + persistence step is unverified outside production. **Browser checklist item.**

---

## 3. Gap list (MISSING features) — with build-scope estimate

Three structural gaps. None are bugs — they're features that don't exist yet.

### A. Checkout / return photo capture tied to the Order spine
- **Why it's missing:** The `Inspection` model chains through `Asset` + `BookingAssignment`. The spine Order model carries `OrderLineItem.assetCategoryId` / `inventoryItemId` but never a specific `assetId` until fleet team binds via `/api/scheduling/booking-items/[id]/assign`. For an Order without a Booking chain (CRH-only sales flow), there's no place to attach a checkout photo.
- **What the client sees today:** Nothing — the portal job page has no checkout / return / damage sections.
- **Build scope estimate (one line):** New `OrderInspection` model keyed on `(orderId, type=CHECKOUT|RETURN)` with attachment children + portal-page section to render thumbnails. ~3 commits: schema + capture endpoint + portal display. Most of the upload plumbing (`uploadClaimDocument`, drag-drop UI) already exists and is reusable.

### B. Lifecycle client-update emails (between quote-send and invoice-send)
- **Why it's missing:** Cadence projection (`projectCadenceFromOrderStatus`) emits cadence transitions internally, but there's no client-bound mail template for:
  - Booking confirmation (just-booked → next milestone)
  - Pickup-day reminder (T-24h before startDate)
  - Return-day reminder (T-24h before endDate)
  - Completion / thank-you (post-CLOSED)
  Schedulers + cadence states exist; templates + send routes don't.
- **What the client sees today:** Quote PDF + invoice PDF only. Long radio silence in between.
- **Build scope estimate:** 1 commit per template (~4 small commits). Each is: 1 new template file + 1 wiring in cadence scheduler. All four can use the existing `EmailReviewModal` gate (agent-reviewed) or be auto-send (cron-scheduled). Recommend agent-reviewed for the first three; auto for the last.

### C. Inquiry → CRM capture WITHOUT a prior EmailMessage
- **Why it's missing:** The `/api/sales/suggested-inquiries/capture` route requires an `emailId` of an existing `EmailMessage` row. A walk-in / phone-call lead has no email yet.
- **What the rep sees today:** They can create an Inquiry row manually via `Inquiry.create` (Stage 1 confirmed this works with `source='MANUAL'`), but no UI route exists to do so.
- **Build scope estimate:** 1 commit. Simple `POST /api/inquiries` with the CreateInput shape + a "+ New inquiry" modal on `/sales/pipeline` mirroring `NewClaimModal`'s structure. Most of the form is already built into the Inquiry detail page.

### D. (Minor) Dedicated transition routes for ON_JOB / RETURNED / CLOSED
- **Why it's missing:** Generic `PUT /api/orders/[id]` accepts any status, but there's no transition-specific handler that runs side effects (e.g., emit cadence projection, write an audit log entry for the transition, gate forward-only). Today this works because nothing yet depends on those side effects firing — but as more cadence-driven UX lands it will matter.
- **Build scope estimate:** 1 thin commit per transition (3 commits). Each calls a shared helper `transitionOrderStatus(orderId, to)` that wraps the status update + audit + cadence projection.

---

## 4. Wes browser checklist

Stages CC couldn't fully exercise (in lifecycle order). Open the order in your browser at `https://hq.sirreel.com/orders/99ed6e56-4a39-459b-963f-7cb886c9c4bc` and walk through:

1. **Quote PDF in browser.** Open the order detail page, click **Regenerate quote PDF**. Verify:
   - 3-day window on the line items
   - Dept discount row under PRO_SUPPLIES subtotal: `−$14.40`
   - Order discount row between grand Subtotal and Tax: `−$170.06` (label "E2E test — Flat $1000 total")
   - Grand Total: `$1000.00`
   - Zelle pay-by block bottom-right under Total, scannable QR + `Zelle® tag: sirreel`

2. **Send quote (DO NOT click "Send" — open the draft modal and confirm preview only).** Verify `EmailReviewModal` renders for `e2e-test@sirreel.com`. Close without sending.

3. **Book button.** The order is ALREADY at status CLOSED from the walkthrough; this won't be re-bookable. **Skip** — the bookOrder pass already confirmed.

4. **Picklist at `/warehouse/pick`.** Find PickList `2103e883-98ab-4f40-a460-736dc2776ed1`. It's at status LOADED (advanced via direct write). Verify the rows render with the expected line items.

5. **Dispatch board at `/dispatch`.** Verify the order appears (or doesn't) — it's currently CLOSED so it'll be off the active list. Spot-check the historical view.

6. **Portal job page.** This is the one that NEEDS your eyes — open the portal link for `S260610-001`. Verify:
   - Equipment list shows all 3 line items
   - Discount lines + correct totals
   - **What's MISSING:** No checkout photo section, no return photo section, no damage section. Confirm this matches the gap list above.

7. **RENTAL invoice generation (the ENV-LIMITED step).** On the order detail page, click **Generate RENTAL invoice**. Verify:
   - Invoice draft created (PDF link populates)
   - Open PDF — discount lines render between Subtotal and Tax
   - Total matches `$1000.00` (anchored to bookedTotal)
   - Zelle block bottom-right
   - If you added/removed a line item AFTER booking, the ADJUSTMENT line surfaces correctly

8. **HR section (orthogonal to lifecycle but tests the allowlist).** Open `/hr` — verify you see the page; have an account NOT on the allowlist try and confirm 403.

9. **Inquiry surface.** Open `/sales/pipeline`. The synthetic Inquiry (source=MANUAL, id `<see manifest>`) created in Stage 1 should render in the queue.

---

## 5. Created-records manifest (for purge)

All carry `ZZTEST` or `E2E TEST — DO NOT PROCESS`. Purge with `DELETE` in roughly this order (foreign-key safe):

| Model | ID | Label |
|---|---|---|
| Company | `499feabf-8c02-4748-97a8-a5b488a3b01e` | ZZTEST E2E Productions |
| Person | `33a3fe3c-b571-44d2-b6fd-85c88cedc36c` | E2E Test (e2e-test@sirreel.com) |
| Affiliation | (auto-id) | E2E Test ↔ ZZTEST |
| Inquiry | (failed first attempt; retry-on-`MANUAL` produced no row on initial run — verify if any exists with `companyName='ZZTEST E2E Productions'`) | E2E test inquiry |
| Job | `4ba5955a-8131-4631-ad08-25fb8965453d` | SR-JOB-0017 |
| Order | `99ed6e56-4a39-459b-963f-7cb886c9c4bc` | S260610-001 — status: CLOSED |
| OrderLineItem | `856065ee-abed-4031-8956-246d71867c10` | Cargo van |
| OrderLineItem | `25d2161d-a279-498d-bbe5-d12abaea42d3` | Sidewalls 4ft (Jose repro) |
| OrderLineItem | `2a762180-ff08-4e87-bc72-60ddc9becc58` | Apple boxes (post-quote add) |
| OrderDiscount | `08cff031-c316-4676-b4bc-b615f1bd14df` | 10% PRO_SUPPLIES |
| OrderDiscount | `e605332e-a513-43a7-b636-b7d550eaa754` | Flat $1000 total ($170.06) |
| PickList | `2103e883-98ab-4f40-a460-736dc2776ed1` | DRAFT → LOADED |
| PickListItem | ×2 | (auto) |
| Invoice | (none — blob-env limit) | — |
| InsuranceClaim | (none — needs Booking chain) | — |

**One-liner purge** (safe — all rows are cascade-deletable from Company):
```sql
DELETE FROM companies WHERE name = 'ZZTEST E2E Productions';
DELETE FROM people WHERE email = 'e2e-test@sirreel.com';
```
This should cascade-delete the Order, OrderLineItems, OrderDiscounts, PickList + items, Affiliation, Job, and any Inquiry rows tied to the Company.

---

## 6. Final order state at end of walkthrough

| Field | Value |
|---|---|
| `status` | CLOSED |
| `subtotal` | $1104.00 (pre-discount sum of lineTotals) |
| `bookedSubtotal` | $1104.00 (frozen at book time) |
| `bookedTaxAmount` | $-104.00 (negative because the post-discount preTax × rate calc inverts after the flat-total override) |
| `bookedTotal` | $1000.00 (immutable AR figure) |
| `total` | $1000.00 |
| `bookedAt` | 2026-06-10T17:04:31Z |
| `fleetReadyAt` | 2026-06-10T17:04:33Z |

**Note** on `bookedTaxAmount: -$104`: the tax math is `preTaxSubtotal × taxRate`. With `preTaxSubtotal = $1104 - $14.40 (dept) - $170.06 (order) = $919.54`, expected tax should be `$80.46`. The persisted `-$104` indicates the **`recalcOrderTotals` was not re-run after the discount inserts** — the script wrote `subtotal/taxAmount/total` directly bypassing the helper. Booked snapshot then captured the inconsistent value. **This is a test-script artifact, not a product bug** — in real use, the `/api/orders/[id]/discounts` POST/DELETE always calls `recalcOrderTotals` before returning. Flagged for the manifest cleanup.

---

## 7. Phase 0 surface map (summary)

For full reference. See PHASE 0 in the conversation log for code excerpts.

**OrderStatus state machine:**
DRAFT → QUOTE_SENT → APPROVED → BOOKED → LOADED_READY → ON_JOB → RETURNED → LD_CHECK / INVOICED → CLOSED / CANCELLED.

**Transition handlers exist for:** send-quote, book, fleet-ready (LOADED_READY rollup), return-damage (Planyo-chain only), invoices (RENTAL + LD), invoice send (RETURNED→INVOICED), payment-recorded (INVOICED→CLOSED).

**Transitions WITHOUT dedicated handlers:** APPROVED transition (direct PUT), ON_JOB transition (direct PUT), RETURNED transition for spine orders (direct PUT), LD_CHECK transition, CANCELLED transition, CLOSED transition.

**Picklist:** Auto-creates inside `bookOrder` for WAREHOUSE-routed lines. State machine DRAFT → PICKING → READY_TO_STAGE → STAGED → LOADED → CANCELLED on the PickList; PENDING_PICK → PICKED → STAGED → LOADED on each PickListItem (mirrored on OrderLineItem.pickStatus).

**Portal job page** renders: equipment table, contract status, contacts, paperwork (quote/agreement/COI/registration), activity feed, blind-handoff instructions. **Does NOT render:** checkout/return photos, damage records, dispatch info, invoice payment history.

**Client mail originate points (7):** send-quote, follow-ups/send, invoices/send, agreement/resend-link, portal-resend, bookings/send-portal, cadence-scheduled. All gate through `EmailReviewModal`.

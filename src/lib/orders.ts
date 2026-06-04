import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { computeLineTotal } from "@/lib/orders/billing";

/**
 * Generate the next quote/order number in the date-based format
 * `S{YYMMDD}-{NNN}` — e.g. `S260604-001`.
 *
 * Date + reset boundary are Pacific time (America/Los_Angeles), not
 * UTC — a quote created at 23:50 PT on June 3rd has number S260603-…,
 * not S260604-… (which would surprise a rep reading the audit trail
 * the next morning).
 *
 * The per-day counter lives in `OrderDailyCounter` (one row per
 * YYMMDD). The UPSERT runs INSIDE the caller's transaction so:
 *   - increment is race-safe (the row-level lock on the upserted row
 *     serializes concurrent calls to nextOrderNumber for the same day)
 *   - if the order insert later fails and the tx rolls back, the
 *     counter increment rolls back too — no daily gaps from aborted
 *     creates
 *
 * The 11 pre-existing `SR-ORD-NNNN` orders keep their numbers; this
 * is a forward-only switch. The legacy `sr_order_number_seq` Postgres
 * SEQUENCE remains in place but is no longer called. Sibling
 * sequences (sr_invoice_number_seq, sr_ld_invoice_number_seq,
 * sr_claim_number_seq) are intentionally unchanged.
 */
export async function nextOrderNumber(
  tx: Prisma.TransactionClient,
): Promise<string> {
  const dateKey = pacificDateKey();
  // UPSERT + RETURNING is the atomic per-day increment. The row-level
  // lock on the conflicting row inside the tx prevents two concurrent
  // calls on the same day from racing to the same seq value.
  const rows = await tx.$queryRaw<{ seq: number }[]>`
    INSERT INTO order_daily_counter (date_key, seq)
    VALUES (${dateKey}, 1)
    ON CONFLICT (date_key) DO UPDATE
      SET seq = order_daily_counter.seq + 1
    RETURNING seq
  `;
  const seq = rows[0]?.seq ?? 1;
  return `S${dateKey}-${String(seq).padStart(3, "0")}`;
}

/**
 * Today's date as `YYMMDD` in America/Los_Angeles, regardless of the
 * server's clock zone. Intl.DateTimeFormat with timeZone is the
 * dependency-free way to do this — no date-fns / luxon needed.
 *
 * Exported for tests; not used outside this file in production.
 */
export function pacificDateKey(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}${get("month")}${get("day")}`;
}

/**
 * Phase 5: parameterized by InvoiceType. Two parallel sequences — easier
 * to audit and grep than a single sequence with a type-baked prefix.
 *
 *   RENTAL → SR-INV-NNNN  (existing sr_invoice_number_seq)
 *   LD     → SR-LDI-NNNN  (sr_ld_invoice_number_seq, created in
 *                          Phase 5 commit 4 via raw SQL alongside
 *                          this branch)
 */
export async function nextInvoiceNumber(type: 'RENTAL' | 'LD' = 'RENTAL'): Promise<string> {
  if (type === 'RENTAL') {
    const result = await prisma.$queryRaw<{ nextval: bigint }[]>`
      SELECT nextval('sr_invoice_number_seq')
    `;
    const num = Number(result[0].nextval);
    return `SR-INV-${String(num).padStart(4, "0")}`;
  }
  // LD path
  const result = await prisma.$queryRaw<{ nextval: bigint }[]>`
    SELECT nextval('sr_ld_invoice_number_seq')
  `;
  const num = Number(result[0].nextval);
  return `SR-LDI-${String(num).padStart(4, "0")}`;
}

/**
 * Phase 5 commit 4 — claim number sequence. Format: SR-CLM-NNNN.
 * Differs from the original schema-comment placeholder
 * "SRC-2026-NNNN" — picking a single sequence with no year embed
 * matches the SR-INV / SR-ORD numbering convention already in use.
 * Legacy SRC-2026-style numbers are accepted by the @unique column
 * for any RentalWorks-era data that may land via future migration.
 */
export async function nextClaimNumber(): Promise<string> {
  const result = await prisma.$queryRaw<{ nextval: bigint }[]>`
    SELECT nextval('sr_claim_number_seq')
  `;
  const num = Number(result[0].nextval);
  return `SR-CLM-${String(num).padStart(4, "0")}`;
}

export function computeWeeklyRate(
  dailyRate: number,
  type: "VEHICLE" | "EQUIPMENT" | "EXPENDABLE" | "LABOR" | "FEE" | "DISCOUNT"
): number {
  if (type === "VEHICLE") return dailyRate * 5;
  if (type === "EQUIPMENT" || type === "EXPENDABLE") return dailyRate * 3;
  return dailyRate;
}

export function rentalDays(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime();
  return Math.max(1, Math.ceil(ms / (1000 * 60 * 60 * 24)) + 1);
}

// computeLineTotal moved to src/lib/orders/billing.ts in the May 9 billing
// fix — totals are now department-aware (CAP_PER_WEEK / PERCENT_DISCOUNT /
// PURCHASE) instead of the Phase 1 placeholder ceil(days/5). Callers should
// import { computeLineTotal } from '@/lib/orders/billing'.

// Self-healing recalc: each line's lineTotal is recomputed from its
// canonical source fields (qty, rate, billableDays, rateType, department)
// via the single billing.ts source of truth. Any drift between stored
// lineTotal and the computed value is written back before summing the
// order totals. This means historical rows written by older code paths
// — or any future external write that bypasses the API — converge to
// the correct number the next time anything touches the Order.
export async function recalcOrderTotals(orderId: string) {
  const lineItems = await prisma.orderLineItem.findMany({
    where: { orderId },
  });

  let subtotal = 0;
  for (const li of lineItems) {
    const computed = computeLineTotal({
      quantity: li.quantity,
      rate: li.rate,
      billableDays: li.billableDays,
      rateType: li.rateType,
      department: li.department,
    });
    const rounded = Math.round(computed * 100) / 100;
    if (Number(li.lineTotal) !== rounded) {
      await prisma.orderLineItem.update({
        where: { id: li.id },
        data: { lineTotal: rounded },
      });
    }
    subtotal += rounded;
  }

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  const taxRate = order ? Number(order.taxRate) : 0;
  const taxAmount = subtotal * taxRate;
  const total = subtotal + taxAmount;

  await prisma.order.update({
    where: { id: orderId },
    data: { subtotal, taxAmount, total },
  });

  return { subtotal, taxAmount, total };
}

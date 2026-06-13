import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { computeLineTotal } from "@/lib/orders/billing";
import { computeOrderTotals } from "@/lib/orders/discountedTotals";

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

/**
 * Mint the next SR-INC-NNNN incident number. Backed by the Postgres
 * sequence sr_incident_number_seq (created out-of-band, same pattern
 * as sr_claim_number_seq + sr_order_number_seq). Safe under concurrent
 * Incident creates — nextval is atomic.
 */
export async function nextIncidentNumber(): Promise<string> {
  const result = await prisma.$queryRaw<{ nextval: bigint }[]>`
    SELECT nextval('sr_incident_number_seq')
  `;
  const num = Number(result[0].nextval);
  return `SR-INC-${String(num).padStart(4, "0")}`;
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
  // ── Locked-order guard. Once an order reaches INVOICED or CLOSED its
  // totals are committed to a Payment/Invoice paper trail and must not
  // shift just because a downstream edit (or the new FLAT_TOTAL live
  // derivation) triggered a recalc. Bail before any writes so the
  // persisted subtotal/tax/total stay byte-identical to what was
  // invoiced. New / open orders fall through and recompute normally.
  const lockCheck = await prisma.order.findUnique({
    where: { id: orderId },
    select: { status: true, subtotal: true, taxAmount: true, total: true, taxRate: true },
  });
  if (lockCheck && (lockCheck.status === 'INVOICED' || lockCheck.status === 'CLOSED')) {
    return {
      subtotal: Number(lockCheck.subtotal),
      taxAmount: Number(lockCheck.taxAmount),
      total: Number(lockCheck.total),
      breakdown: null,
      locked: true as const,
    };
  }

  // ── Line-total convergence pass — same contract as before:
  // recompute each row's lineTotal from (quantity × rate × days × kind)
  // semantics; persist only if it drifted. Historical rows + any future
  // external write that bypasses the API converge here.
  const lineItems = await prisma.orderLineItem.findMany({
    where: { orderId },
  });

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
  }

  // ── Pull fresh state + structured discounts; delegate the actual
  // subtotal/tax/total math to the shared util so quote PDF + invoice
  // generator + the order detail API can't drift from this surface.
  const [order, discounts, freshLines] = await Promise.all([
    prisma.order.findUnique({ where: { id: orderId } }),
    prisma.orderDiscount.findMany({ where: { orderId } }),
    prisma.orderLineItem.findMany({ where: { orderId } }),
  ]);
  const taxRate = order ? Number(order.taxRate) : 0;
  const breakdown = computeOrderTotals({
    lines: freshLines.map((l) => ({
      department: l.department,
      type: l.type,
      lineTotal: Number(l.lineTotal),
    })),
    discounts: discounts.map((d) => ({
      id: d.id,
      scope: d.scope,
      departmentKey: d.departmentKey,
      type: d.type,
      value: Number(d.value),
      label: d.label,
    })),
    taxRate,
  });

  await prisma.order.update({
    where: { id: orderId },
    data: {
      // subtotal stays semantically "sum of all OrderLineItem.lineTotal"
      // (incl legacy DISCOUNT rows already negative) — discount-aware
      // math operates on top of it and is reflected in tax + total.
      // Keeping this column's meaning unchanged means external readers
      // that consume Order.subtotal alone don't silently shift.
      subtotal: breakdown.rawSubtotal,
      taxAmount: breakdown.taxAmount,
      total: breakdown.total,
    },
  });

  return {
    subtotal: breakdown.rawSubtotal,
    taxAmount: breakdown.taxAmount,
    total: breakdown.total,
    breakdown,
  };
}

import { prisma } from "@/lib/prisma";
import { computeLineTotal } from "@/lib/orders/billing";

export async function nextOrderNumber(): Promise<string> {
  const result = await prisma.$queryRaw<{ nextval: bigint }[]>`
    SELECT nextval('sr_order_number_seq')
  `;
  const num = Number(result[0].nextval);
  return `SR-ORD-${String(num).padStart(4, "0")}`;
}

export async function nextInvoiceNumber(): Promise<string> {
  const result = await prisma.$queryRaw<{ nextval: bigint }[]>`
    SELECT nextval('sr_invoice_number_seq')
  `;
  const num = Number(result[0].nextval);
  return `SR-INV-${String(num).padStart(4, "0")}`;
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

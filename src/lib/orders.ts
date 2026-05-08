import { prisma } from "@/lib/prisma";

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

/**
 * Phase 2 sales pipeline: per-line rental-days override.
 *
 * - If `rentalDays` is provided, use it directly (the new builder UI lets
 *   users set days per line independent of the order-level start/end).
 * - Otherwise derive from start/end dates (legacy behavior).
 *
 * WEEKLY rate uses a 5-day work week per the Phase 2 brief — total =
 * quantity × rate × ceil(rentalDays / 5). FLAT preserves the existing
 * "rate × quantity" semantics regardless of duration.
 */
export function computeLineTotal(params: {
  rateType: "DAILY" | "WEEKLY" | "FLAT";
  rate: number;
  quantity: number;
  rentalDays?: number | null;
  startDate?: Date | null;
  endDate?: Date | null;
}): { days: number; lineTotal: number } {
  const { rateType, rate, quantity, rentalDays: explicitDays, startDate, endDate } = params;

  if (rateType === "FLAT") {
    return { days: explicitDays && explicitDays > 0 ? explicitDays : 1, lineTotal: rate * quantity };
  }

  let totalDays: number
  if (explicitDays && explicitDays > 0) {
    totalDays = Math.floor(explicitDays);
  } else if (startDate && endDate) {
    totalDays = rentalDays(startDate, endDate);
  } else {
    return { days: 1, lineTotal: 0 };
  }

  if (rateType === "WEEKLY") {
    const weeks = Math.ceil(totalDays / 5);
    return { days: totalDays, lineTotal: rate * weeks * quantity };
  }

  return { days: totalDays, lineTotal: rate * totalDays * quantity };
}

export async function recalcOrderTotals(orderId: string) {
  const lineItems = await prisma.orderLineItem.findMany({
    where: { orderId },
  });

  const subtotal = lineItems.reduce(
    (sum, li) => sum + Number(li.lineTotal),
    0
  );

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

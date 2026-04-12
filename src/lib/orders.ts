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

export function computeLineTotal(params: {
  rateType: "DAILY" | "WEEKLY" | "FLAT";
  rate: number;
  quantity: number;
  startDate?: Date | null;
  endDate?: Date | null;
}): { days: number | null; lineTotal: number } {
  const { rateType, rate, quantity, startDate, endDate } = params;

  if (rateType === "FLAT") {
    return { days: null, lineTotal: rate * quantity };
  }

  if (!startDate || !endDate) {
    return { days: null, lineTotal: 0 };
  }

  const totalDays = rentalDays(startDate, endDate);

  if (rateType === "WEEKLY") {
    const weeks = Math.ceil(totalDays / 7);
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

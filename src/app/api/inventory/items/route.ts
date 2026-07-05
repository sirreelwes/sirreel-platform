import { NextRequest, NextResponse } from "next/server";
import { Prisma, type LineItemDepartment } from "@prisma/client";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseMoney } from "@/lib/pricing/resolveRate";

export const dynamic = "force-dynamic";

const VALID_DEPARTMENTS: LineItemDepartment[] = [
  "VEHICLES",
  "COMMUNICATIONS",
  "STAGES",
  "PRO_SUPPLIES",
  "EXPENDABLES",
  "GE",
  "ART",
];

export async function POST(req: NextRequest) {
  // Auth: any authenticated user — mirrors PUT.
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const {
    code,
    description,
    department,
    categoryId,
    locationId,
    qtyOwned,
    dailyRate,
    weeklyRate,
    replacementCost,
  } = body;

  if (!code || typeof code !== "string" || !code.trim()) {
    return NextResponse.json({ error: "code is required" }, { status: 400 });
  }
  if (!department || !VALID_DEPARTMENTS.includes(department)) {
    return NextResponse.json(
      { error: `department is required (one of: ${VALID_DEPARTMENTS.join(", ")})` },
      { status: 400 },
    );
  }

  try {
    const item = await prisma.inventoryItem.create({
      data: {
        code: code.trim(),
        description: description?.trim() || null,
        department: department as LineItemDepartment,
        categoryId: categoryId || null,
        locationId: locationId || null,
        qtyOwned: qtyOwned != null ? Math.max(0, Math.floor(Number(qtyOwned))) : 0,
        // Decimal-safe money writes (audit §7) — no parseFloat into
        // Decimal columns; parseMoney cent-rounds via Prisma.Decimal.
        dailyRate: parseMoney(dailyRate) ?? 0,
        weeklyRate: parseMoney(weeklyRate) ?? 0,
        replacementCost: parseMoney(replacementCost),
      },
      include: {
        category: { select: { id: true, name: true } },
        locationRef: { select: { id: true, name: true, code: true } },
      },
    });
    return NextResponse.json(item, { status: 201 });
  } catch (err) {
    // P2002 = unique constraint failed. The only @unique field on
    // InventoryItem is `code` so any conflict is a duplicate-code error.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json(
        { error: `An inventory item with code "${code.trim()}" already exists.` },
        { status: 409 },
      );
    }
    console.error("[inventory POST] create failed:", err);
    const message = err instanceof Error ? err.message : "Create failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search") || "";
  const categoryId = searchParams.get("categoryId");
  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("limit") || "50");
  // `?archived=1` flips the list to show only archived (soft-deleted)
  // rows for the Archived view + restore. Default = active only.
  const archived = searchParams.get("archived") === "1";

  const where: Record<string, unknown> = { isActive: !archived };

  if (categoryId) where.categoryId = categoryId;
  if (search) {
    where.OR = [
      { code: { contains: search, mode: "insensitive" } },
      { description: { contains: search, mode: "insensitive" } },
    ];
  }

  const [items, total, categories, locations] = await Promise.all([
    prisma.inventoryItem.findMany({
      where,
      include: {
        category: { select: { id: true, name: true } },
        locationRef: { select: { id: true, name: true, code: true } },
        preferredVendor: { select: { id: true, name: true, website: true, isActive: true } },
      },
      orderBy: [{ category: { sortOrder: "asc" } }, { code: "asc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.inventoryItem.count({ where }),
    prisma.inventoryCategory.findMany({
      where: { isActive: true },
      select: { id: true, name: true, _count: { select: { items: true } } },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.inventoryLocation.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, code: true },
    }),
  ]);

  return NextResponse.json({ items, total, page, limit, categories, locations });
}

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import type { AssetTier } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/permissions";

type Params = { params: Promise<{ assetId: string }> };

const TIERS: readonly AssetTier[] = ["PREMIUM", "STANDARD", "ECONOMY"];
const OPEN_MAINT = new Set(["SCHEDULED", "IN_PROGRESS"]);

/**
 * GET /api/scheduling/assets/[assetId]/summary — the gantt asset-summary panel
 * payload: specs (make/model/year, mileage, VIN, status), condition tier, fleet
 * notes, the category (name + whether a generic image exists), and a concise
 * MaintenanceRecord summary (open/in-progress first, then recent completed).
 *
 * Viewing is any signed-in internal user. The select DELIBERATELY excludes the
 * CRH §6.2 internal-only insurance fields (insurancePolicyNum,
 * insuranceCardUrl) — only what the panel renders is selected.
 *
 * PATCH — FLEET (canAssignAssets) updates Asset.notes and/or Asset.tier. This
 * panel is the canonical tier-setter home (the unit-row "…" menu points here).
 * No schema change anywhere — every field already exists on Asset.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { assetId } = await params;

  const session = await getServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const asset = await prisma.asset.findUnique({
    where: { id: assetId },
    select: {
      id: true,
      unitName: true,
      status: true,
      tier: true,
      vin: true,
      year: true,
      make: true,
      model: true,
      mileage: true,
      notes: true,
      isActive: true,
      category: { select: { id: true, name: true, imageUrl: true } },
      maintenanceRecords: {
        select: {
          id: true,
          type: true,
          title: true,
          status: true,
          startDate: true,
          endDate: true,
          estimatedCost: true,
          actualCost: true,
          vendor: true,
        },
        orderBy: { startDate: "desc" },
        take: 25,
      },
    },
  });
  if (!asset) {
    return NextResponse.json({ error: "asset not found" }, { status: 404 });
  }

  // Featured inspection for the panel hero: the most recent CHECKOUT that HAS
  // photos, else the latest inspection of any type with photos. Only photo IDs
  // are returned — the panel loads bytes through the session-gated
  // /api/fleet/photos/[photoId] proxy, never a raw blob URL.
  const inspectionSelect = {
    id: true,
    type: true,
    inspectionDate: true,
    photos: { select: { id: true }, orderBy: { createdAt: "asc" as const } },
  };
  const featured =
    (await prisma.inspection.findFirst({
      where: { assetId, type: "CHECKOUT", photos: { some: {} } },
      orderBy: { inspectionDate: "desc" },
      select: inspectionSelect,
    })) ??
    (await prisma.inspection.findFirst({
      where: { assetId, photos: { some: {} } },
      orderBy: { inspectionDate: "desc" },
      select: inspectionSelect,
    }));

  // Open/in-progress first (newest first within each group), then a concise
  // tail of recent completed/cancelled records.
  const open = asset.maintenanceRecords.filter((m) => OPEN_MAINT.has(m.status));
  const closed = asset.maintenanceRecords.filter((m) => !OPEN_MAINT.has(m.status)).slice(0, 8);

  const { maintenanceRecords: _all, category, ...fields } = asset;
  return NextResponse.json({
    ok: true,
    asset: {
      ...fields,
      category: {
        id: category.id,
        name: category.name,
        // The raw private-blob URL is never sent — the panel targets the gated
        // category-image stream and uses this flag to know whether to render it.
        hasImage: Boolean(category.imageUrl),
      },
      maintenance: { open, recent: closed },
      featuredInspection: featured
        ? {
            type: featured.type,
            inspectionDate: featured.inspectionDate,
            photoIds: featured.photos.map((p) => p.id),
          }
        : null,
    },
  });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { assetId } = await params;

  const session = await getServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const actor = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { role: true },
  });
  if (!actor || !can(actor.role, "canAssignAssets")) {
    return NextResponse.json(
      { error: "forbidden", reason: "editing fleet notes / condition tier is a fleet action" },
      { status: 403 },
    );
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "JSON body required" }, { status: 400 });
  }
  const data: { notes?: string | null; tier?: AssetTier } = {};
  if ("notes" in body) {
    if (body.notes !== null && typeof body.notes !== "string") {
      return NextResponse.json({ error: "notes must be a string or null" }, { status: 400 });
    }
    data.notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null;
  }
  if ("tier" in body) {
    if (typeof body.tier !== "string" || !TIERS.includes(body.tier as AssetTier)) {
      return NextResponse.json({ error: "tier must be PREMIUM | STANDARD | ECONOMY" }, { status: 400 });
    }
    data.tier = body.tier as AssetTier;
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "nothing to update (notes and/or tier)" }, { status: 400 });
  }

  const exists = await prisma.asset.findUnique({ where: { id: assetId }, select: { id: true } });
  if (!exists) {
    return NextResponse.json({ error: "asset not found" }, { status: 404 });
  }

  const updated = await prisma.asset.update({
    where: { id: assetId },
    data,
    select: { id: true, notes: true, tier: true },
  });
  return NextResponse.json({ ok: true, asset: updated });
}

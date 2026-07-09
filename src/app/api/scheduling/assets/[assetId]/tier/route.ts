import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import type { AssetTier } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/permissions";

type Params = { params: Promise<{ assetId: string }> };

const TIERS: readonly AssetTier[] = ["PREMIUM", "STANDARD", "ECONOMY"];

/**
 * POST /api/scheduling/assets/[assetId]/tier — FLEET sets a unit's condition
 * tier by reusing the existing Asset.tier enum (PREMIUM/STANDARD/ECONOMY →
 * Best/Good/Workhorse dot on the gantt). No schema change. Gated on
 * canAssignAssets — sales cannot change tier. Does NOT affect the
 * available-units "nicest first" sort logic; it only sets the stored tier.
 */
export async function POST(req: NextRequest, { params }: Params) {
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
      { error: "forbidden", reason: "changing a unit tier is a fleet action" },
      { status: 403 },
    );
  }

  const body = await req.json().catch(() => null);
  const tier = body && typeof body.tier === "string" ? (body.tier as AssetTier) : null;
  if (!tier || !TIERS.includes(tier)) {
    return NextResponse.json({ error: "tier must be PREMIUM | STANDARD | ECONOMY" }, { status: 400 });
  }

  const asset = await prisma.asset.findUnique({ where: { id: assetId }, select: { id: true } });
  if (!asset) {
    return NextResponse.json({ error: "asset not found" }, { status: 404 });
  }

  const updated = await prisma.asset.update({
    where: { id: assetId },
    data: { tier },
    select: { id: true, tier: true },
  });
  return NextResponse.json({ ok: true, assetId: updated.id, tier: updated.tier });
}

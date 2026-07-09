import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/prisma";
import { streamPrivateBlobAsResponse } from "@/lib/claims/streamBlob";

type Params = { params: Promise<{ assetId: string }> };

export const dynamic = "force-dynamic";

/**
 * GET /api/scheduling/assets/[assetId]/category-image — streams the asset's
 * CATEGORY-generic picture (AssetCategory.imageUrl, a PRIVATE blob) for the
 * gantt asset-summary panel. Session-gated for any signed-in internal user:
 * the admin proxy (/api/admin/asset-categories/[id]/image) is requireAdmin-only
 * and the public one is gated on public-catalog visibility — neither fits an
 * internal fleet/sales viewer. Reuses the shared streamPrivateBlobAsResponse
 * helper; the raw blob URL is never exposed. 404 when the category has no photo.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { assetId } = await params;

  const session = await getServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const asset = await prisma.asset.findUnique({
    where: { id: assetId },
    select: { category: { select: { imageUrl: true } } },
  });
  if (!asset?.category?.imageUrl) {
    return NextResponse.json({ error: "no image" }, { status: 404 });
  }
  return streamPrivateBlobAsResponse({ fileUrl: asset.category.imageUrl, filename: "category.jpg" });
}

import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { getServerSession } from "next-auth"
import { rwFetch } from "@/lib/rentalworks/rwClient"

async function rwPost(path: string, body: object = {}) {
  // rwFetch raises RwAuthError on 401/403 — this route no longer decides
  // for itself what a rejected token means.
  const res = await rwFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    return { error: `${res.status} ${res.statusText}`, detail: text.substring(0, 200) }
  }
  return res.json()
}

export async function GET(req: NextRequest) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    const { searchParams } = new URL(req.url)
    const page = parseInt(searchParams.get("page") || "1")
    const pageSize = parseInt(searchParams.get("pageSize") || "25")
    const status = searchParams.get("status") || ""
    const search = searchParams.get("search") || ""

    const body: any = { pageNo: page, pageSize }
    if (status) body.searchFields = [{ fieldName: "Status", searchValue: status, searchType: "equals" }]
    if (search) body.searchFields = [...(body.searchFields || []), { fieldName: "Order", searchValue: search, searchType: "contains" }]

    const orders = await rwPost("/api/v1/order/browse", body)
    return NextResponse.json({ success: true, orders })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

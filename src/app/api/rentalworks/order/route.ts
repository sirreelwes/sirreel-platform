import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

const BASE_URL = "https://sirreel.rentalworks.cloud"
const TOKEN = process.env.RENTALWORKS_TOKEN || ""

async function rwGet(path: string) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      "Authorization": `Bearer ${TOKEN}`,
      "Accept": "application/json",
    },
  })
  if (!res.ok) return { error: `${res.status} ${res.statusText}` }
  return res.json()
}

async function rwPost(path: string, body: object = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${TOKEN}`,
      "Accept": "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) return { error: `${res.status} ${res.statusText}` }
  return res.json()
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const orderId = searchParams.get("id")
    if (!orderId) return NextResponse.json({ error: "Missing id" }, { status: 400 })

    const [order, items] = await Promise.allSettled([
      rwGet(`/api/v1/order/${orderId}`),
      rwPost("/api/v1/orderitem/browse", { pageNo: 1, pageSize: 100, searchFields: [{ fieldName: "OrderId", searchValue: orderId, searchType: "equals" }] }),
    ])

    return NextResponse.json({
      success: true,
      order: order.status === "fulfilled" ? order.value : null,
      items: items.status === "fulfilled" ? items.value : null,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

import { NextResponse } from 'next/server'

const BASE_URL = 'https://sirreel.rentalworks.cloud'
const TOKEN = process.env.RENTALWORKS_TOKEN || ''

export async function GET() {
  const res = await fetch(`${BASE_URL}/api/v1/order/A000KV1Q/receipt/browse`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ pageNo: 1, pageSize: 5 }),
  })
  const text = await res.text()
  return NextResponse.json({ status: res.status, body: text })
}

import { NextResponse } from 'next/server'

const BASE_URL = 'https://sirreel.rentalworks.cloud'
const TOKEN = process.env.RENTALWORKS_TOKEN || ''

export async function GET() {
  const orderId = 'A000L115'
  
  const endpoints = [
    `/api/v1/order/${orderId}/item/browse`,
    `/api/v1/order/${orderId}/rentalitem/browse`,
    `/api/v1/order/${orderId}/asset/browse`,
    `/api/v1/order/${orderId}/unit/browse`,
    `/api/v1/order/${orderId}/contract/browse`,
  ]

  const results: any = {}
  for (const ep of endpoints) {
    const res = await fetch(`${BASE_URL}${ep}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageNo: 1, pageSize: 10 }),
    })
    results[ep] = { status: res.status, body: (await res.text()).slice(0, 500) }
  }

  return NextResponse.json(results)
}

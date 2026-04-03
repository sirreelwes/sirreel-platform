import { NextResponse } from 'next/server'

const BASE_URL = 'https://sirreel.rentalworks.cloud'
const TOKEN = process.env.RENTALWORKS_TOKEN || ''

async function rwPost(path: string, body: object = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: await res.text() }
}

export async function GET() {
  const results: any = {}

  // Try different receipt/payment endpoint patterns
  results.receiptBrowse     = await rwPost('/api/v1/receipt/browse', { pageNo: 1, pageSize: 3 })
  results.paymentBrowse     = await rwPost('/api/v1/payment/browse', { pageNo: 1, pageSize: 3 })
  results.invoiceBrowse     = await rwPost('/api/v1/invoice/browse', { pageNo: 1, pageSize: 3 })
  results.orderReceiptV2    = await rwPost('/api/v2/order/A000KV1Q/receipt/browse', { pageNo: 1, pageSize: 3 })
  results.orderPayment      = await rwPost('/api/v1/order/A000KV1Q/payment/browse', { pageNo: 1, pageSize: 3 })
  results.orderInvoice      = await rwPost('/api/v1/order/A000KV1Q/invoice/browse', { pageNo: 1, pageSize: 3 })

  return NextResponse.json(results)
}

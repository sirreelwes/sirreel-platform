import { NextResponse } from 'next/server'
import { google } from 'googleapis'
import { prisma } from '@/lib/prisma'

function getGmailClient(email: string) {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}'
  const creds = JSON.parse(raw)
  const auth = new google.auth.JWT(
    creds.client_email, undefined, creds.private_key,
    ['https://www.googleapis.com/auth/gmail.readonly'], email
  )
  return google.gmail({ version: 'v1', auth })
}

function decodeGmailBody(payload: any): string {
  if (payload?.body?.data) {
    return Buffer.from(payload.body.data, 'base64url').toString('utf-8')
  }
  if (payload?.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return Buffer.from(part.body.data, 'base64url').toString('utf-8')
      }
    }
    for (const part of payload.parts) {
      const text = decodeGmailBody(part)
      if (text) return text
    }
  }
  return ''
}

function extractAmount(text: string, label: string): number {
  const match = text.match(new RegExp(label + '[:\\s]+\\$([\\d,]+\\.?\\d*)', 'i'))
  if (!match) return 0
  return parseFloat(match[1].replace(/,/g, ''))
}

async function backfillInbox(email: string, thisYear: number) {
  const gmail = getGmailClient(email)
  const listRes = await gmail.users.messages.list({
    userId: 'me',
    maxResults: 500,
    q: `subject:EOD after:${thisYear}/01/01`,
  })
  return { gmail, messages: listRes.data.messages || [] }
}

export async function GET() {
  try {
    const thisYear = new Date().getFullYear()
    const results: any[] = []
    let stored = 0, skipped = 0

    // Search both inboxes
    const inboxes = ['ana@sirreel.com', 'christian@sirreel.com']

    for (const email of inboxes) {
      let gmail: any, messages: any[]
      try {
        const res = await backfillInbox(email, thisYear)
        gmail = res.gmail
        messages = res.messages
      } catch {
        continue
      }

      for (const msg of messages) {
        if (!msg.id) continue

        const full = await gmail.users.messages.get({
          userId: 'me', id: msg.id, format: 'full',
        })

        const headers = full.data.payload?.headers || []
        const get = (n: string) => headers.find((h: any) => h.name?.toLowerCase() === n.toLowerCase())?.value || ''
        const subject = get('Subject')
        const sentAt = new Date(parseInt(full.data.internalDate || '0'))

        if (!subject.toLowerCase().includes('eod')) { skipped++; continue }

        const body = decodeGmailBody(full.data.payload)
        if (!body) { skipped++; continue }

        const cardpointe    = extractAmount(body, 'cardpointe')
        const rentalworks   = extractAmount(body, 'rentalworks')
        const ordersCreated = extractAmount(body, 'value of orders created')
        const quotesCreated = extractAmount(body, 'value of quotes created')

        if (cardpointe === 0 && rentalworks === 0) { skipped++; continue }

        const dateOnly = new Date(sentAt.toISOString().slice(0, 10) + 'T00:00:00.000Z')

        await prisma.dailyCollections.upsert({
          where: { date: dateOnly },
          create: { date: dateOnly, cardpointe, rentalworks, ordersCreated, quotesCreated, rawEmail: body.slice(0, 2000) },
          update: { cardpointe, rentalworks, ordersCreated, quotesCreated, rawEmail: body.slice(0, 2000) },
        })

        results.push({ date: dateOnly.toISOString().slice(0, 10), cardpointe, rentalworks, ordersCreated, quotesCreated, source: email })
        stored++
      }
    }

    return NextResponse.json({ ok: true, stored, skipped, results })
  } catch (err: any) {
    console.error('[backfill-collections]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

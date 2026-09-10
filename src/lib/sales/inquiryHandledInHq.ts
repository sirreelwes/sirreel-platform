/**
 * "This lead is already an order in HQ."
 *
 * New inbound judges an inquiry answered by Inquiry.respondedAt, which is
 * stamped only when a staff message lands on the SAME email thread
 * (src/lib/sales/markInquiryResponded.ts). Everything HQ actually does with
 * a lead happens OFF that thread and from notifications@: the job gets
 * created, the quote goes out through Resend, the portal invite follows. So
 * a fully processed lead keeps sitting in the untriaged queue looking like
 * nobody has touched it.
 *
 * Wes, 2026-09-10: "the D&B Doomsday is still showing as incoming and not
 * that Jose actually processed the order through HQ already with them."
 * Joaquin Toranzo wrote in at 11:40; by 13:29 the House of Mack job existed,
 * order S260910-001 was quoted, and the quote email copied him by name. The
 * card still read untriaged.
 *
 * The suggested-inquiries stream solved its half of this by asking whether
 * anything went OUT to the sender's address (`repliedByParticipant`). That
 * is a heuristic. Here there is an exact record: every order-linked send
 * writes an EmailDelivery carrying the orderId and the envelope it went to
 * (recordEmailDelivery, called by send-quote, the on-change resend, portal
 * invites, card-auth requests…). If one of those reached this inquiry's
 * contact AFTER they wrote in, the lead has been worked — and we can name
 * the order rather than just claiming someone replied.
 *
 * This is deliberately NOT a conversion. The inquiry stays open and visible
 * (it drops into the muted responded block); auto-closing it would lose a
 * genuinely new request from a client who happens to have another live job.
 */

import { prisma } from '@/lib/prisma'
import { parseEmailAddress } from '@/lib/email/direction'

/** Minimum shape needed to resolve an inquiry's client contact address. */
export interface InquiryContactRow {
  id: string
  createdAt: Date
  person?: { email: string | null } | null
  sourceMetadata?: unknown
}

/** What HQ did with the lead, ready to render on the card. */
export interface HandledInHq {
  orderId: string
  orderNumber: string
  orderStatus: string
  jobId: string | null
  jobCode: string | null
  jobName: string | null
  /** Subject of the send that reached them — "Your SirReel quote for …". */
  subject: string
  sentAt: Date
  /** Which of the inquiry's addresses the send was aimed at. */
  address: string
}

/**
 * Every client address this inquiry could be reached at. Staff addresses are
 * dropped: a lead whose contact resolved to rentals@ would otherwise match
 * the CC on every order-linked send in the system.
 */
export function inquiryContactAddresses(row: InquiryContactRow): string[] {
  const out = new Set<string>()
  const add = (value: unknown) => {
    if (typeof value !== 'string' || !value.includes('@')) return
    const addr = parseEmailAddress(value)
    if (!addr || addr.endsWith('@sirreel.com')) return
    out.add(addr)
  }

  add(row.person?.email)

  const meta = row.sourceMetadata as Record<string, unknown> | null
  if (meta) {
    add(meta.fromAddress)
    const extracted = meta.extractedData as Record<string, unknown> | null
    const contact = extracted?.contact as Record<string, unknown> | null
    add(contact?.email)
  }

  return [...out]
}

/**
 * For each inquiry, the order-linked send that reached its contact after the
 * inquiry arrived — most recent wins. Inquiries with no client address, or
 * with nothing sent to them, are absent from the map.
 *
 * One EmailDelivery query for the whole batch.
 */
export async function resolveInquiriesHandledInHq(
  rows: InquiryContactRow[],
): Promise<Map<string, HandledInHq>> {
  const handled = new Map<string, HandledInHq>()
  if (rows.length === 0) return handled

  const addressesByInquiry = new Map<string, string[]>()
  const allAddresses = new Set<string>()
  let earliest: Date | null = null
  for (const row of rows) {
    const addrs = inquiryContactAddresses(row)
    if (addrs.length === 0) continue
    addressesByInquiry.set(row.id, addrs)
    for (const a of addrs) allAddresses.add(a)
    if (!earliest || row.createdAt < earliest) earliest = row.createdAt
  }
  if (allAddresses.size === 0 || !earliest) return handled

  const addressList = [...allAddresses]
  const deliveries = await prisma.emailDelivery.findMany({
    where: {
      orderId: { not: null },
      sentAt: { gte: earliest },
      OR: [
        { toAddress: { in: addressList } },
        { ccAddresses: { hasSome: addressList } },
      ],
    },
    orderBy: { sentAt: 'desc' },
    select: {
      orderId: true,
      toAddress: true,
      ccAddresses: true,
      subject: true,
      sentAt: true,
      order: {
        select: {
          id: true,
          orderNumber: true,
          status: true,
          job: { select: { id: true, jobCode: true, name: true } },
        },
      },
    },
  })
  if (deliveries.length === 0) return handled

  // Deliveries are newest-first, so the first hit per inquiry is the latest
  // thing HQ sent that person.
  for (const [inquiryId, addrs] of addressesByInquiry) {
    const row = rows.find((r) => r.id === inquiryId)
    if (!row) continue
    const hit = deliveries.find((d) => {
      if (d.sentAt < row.createdAt) return false
      if (!d.order) return false
      const envelope = [d.toAddress, ...d.ccAddresses].map((a) => a.toLowerCase().trim())
      return addrs.some((a) => envelope.includes(a))
    })
    if (!hit?.order) continue
    const envelope = [hit.toAddress, ...hit.ccAddresses].map((a) => a.toLowerCase().trim())
    handled.set(inquiryId, {
      orderId: hit.order.id,
      orderNumber: hit.order.orderNumber,
      orderStatus: hit.order.status,
      jobId: hit.order.job?.id ?? null,
      jobCode: hit.order.job?.jobCode ?? null,
      jobName: hit.order.job?.name ?? null,
      subject: hit.subject,
      sentAt: hit.sentAt,
      address: addrs.find((a) => envelope.includes(a)) ?? addrs[0],
    })
  }

  return handled
}

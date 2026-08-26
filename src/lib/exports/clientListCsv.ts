/**
 * Client-list CSV — the actual proprietary payload behind an approved
 * DataExportRequest.
 *
 * The filter shape mirrors /api/crm/companies so that what Wes approves is
 * the same scope the requester was looking at. Two deliberate differences
 * from that endpoint:
 *
 *   1. NO take:100. The CRM list shows a slice; an approved export delivers
 *      the whole matched set, because a partial file silently mislabelled as
 *      "the client list" is worse than either extreme.
 *   2. Contacts are flattened to a single cell rather than joined rows, so
 *      the file opens cleanly in Excel/Sheets.
 */

import { prisma } from '@/lib/prisma'
import { QUIET_DAYS } from '@/lib/crm/clientBadges'
import type { Prisma } from '@prisma/client'

export interface ClientListFilters {
  search?: string | null
  tier?: string | null
  segment?: string | null
}

/** Only these segments are honoured; anything else exports unsegmented. */
const KNOWN_SEGMENTS = new Set(['neverOrdered', 'quiet', 'discount'])

/** Normalize untrusted input into the stored snapshot. */
export function normalizeFilters(raw: unknown): ClientListFilters {
  const r = (raw ?? {}) as Record<string, unknown>
  const str = (v: unknown) =>
    typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : null
  const segment = str(r.segment)
  return {
    search: str(r.search),
    tier: str(r.tier),
    segment: segment && KNOWN_SEGMENTS.has(segment) ? segment : null,
  }
}

/**
 * Build the Prisma `where` for a filter snapshot.
 *
 * NOTE: the `topClients` segment from the CRM list is intentionally NOT
 * supported here. It is defined against a live population cutoff that moves
 * with spend, so the set Wes approved could differ from the set delivered
 * minutes later. Callers normalize it away above.
 */
export async function buildWhere(f: ClientListFilters): Promise<Prisma.CompanyWhereInput> {
  const where: Prisma.CompanyWhereInput = {}
  if (f.tier) where.tier = f.tier as Prisma.CompanyWhereInput['tier']
  if (f.search) {
    where.OR = [
      { name: { contains: f.search, mode: 'insensitive' } },
      { billingEmail: { contains: f.search, mode: 'insensitive' } },
    ]
  }
  if (f.segment === 'neverOrdered') {
    where.orders = { none: {} }
  } else if (f.segment === 'quiet') {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - QUIET_DAYS)
    const rollup = await prisma.order.groupBy({
      by: ['companyId'],
      _max: { createdAt: true },
    })
    where.id = {
      in: rollup
        .filter((r) => r._max.createdAt && r._max.createdAt <= cutoff)
        .map((r) => r.companyId),
    }
  } else if (f.segment === 'discount') {
    where.discountTendency = { in: ['FREQUENT', 'ALWAYS'] }
  }
  return where
}

/** How many rows this scope matches right now. Stored on the request. */
export async function countClientRows(f: ClientListFilters): Promise<number> {
  return prisma.company.count({ where: await buildWhere(f) })
}

/**
 * RFC-4180 quoting PLUS spreadsheet-formula neutralization.
 *
 * A company literally named "=cmd|..." is unlikely, but a client NOTE or
 * address is free text an outsider can influence, and Excel executes a
 * leading =/+/-/@ on open. Prefixing with an apostrophe keeps the value
 * readable while stripping its formula-ness.
 */
export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  let s = String(value)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`
  return s
}

const HEADERS = [
  'Company', 'Tier', 'Industry', 'Total Spend', 'Total Bookings', 'Orders',
  'Billing Email', 'Billing Address', 'Website', 'Default Agent',
  'COI On File', 'COI Expiry', 'Discount Tendency', 'Typical Discount %',
  'Primary Contacts', 'Created', 'Last Updated',
]

function isoDay(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : ''
}

export interface ClientListCsvResult {
  csv: string
  rowCount: number
}

export async function buildClientListCsv(
  f: ClientListFilters,
): Promise<ClientListCsvResult> {
  const companies = await prisma.company.findMany({
    where: await buildWhere(f),
    include: {
      _count: { select: { orders: true } },
      defaultAgent: { select: { name: true } },
      affiliations: {
        where: { isCurrent: true },
        include: {
          person: {
            select: { firstName: true, lastName: true, role: true, email: true },
          },
        },
        take: 5,
      },
    },
    orderBy: { name: 'asc' },
  })

  const lines = [HEADERS.map(escapeCsvCell).join(',')]
  for (const co of companies) {
    const contacts = co.affiliations
      .map((a) => {
        const name = `${a.person.firstName} ${a.person.lastName}`.trim()
        return a.person.email ? `${name} <${a.person.email}>` : name
      })
      .join('; ')
    lines.push([
      co.name,
      co.tier,
      co.industry,
      co.totalSpend.toString(),
      co.totalBookings,
      co._count.orders,
      co.billingEmail,
      co.billingAddress,
      co.website,
      co.defaultAgent?.name ?? '',
      co.coiOnFile ? 'yes' : 'no',
      isoDay(co.coiExpiry),
      co.discountTendency,
      co.typicalDiscountPct,
      contacts,
      isoDay(co.createdAt),
      isoDay(co.updatedAt),
    ].map(escapeCsvCell).join(','))
  }

  // Leading BOM so Excel reads UTF-8 company names correctly.
  return { csv: '﻿' + lines.join('\r\n') + '\r\n', rowCount: companies.length }
}

/** Human-readable scope, for the approval screen and the notification email. */
export function describeFilters(f: ClientListFilters): string {
  const parts: string[] = []
  if (f.search) parts.push(`matching "${f.search}"`)
  if (f.tier) parts.push(`tier ${f.tier}`)
  if (f.segment === 'neverOrdered') parts.push('never ordered')
  if (f.segment === 'quiet') parts.push(`no order in ${QUIET_DAYS} days`)
  if (f.segment === 'discount') parts.push('discount-watch')
  return parts.length ? parts.join(', ') : 'all clients'
}

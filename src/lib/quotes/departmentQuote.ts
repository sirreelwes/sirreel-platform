/**
 * Departmental client quotes — "Production Vehicle Quote" and its siblings.
 *
 * Wes, 2026-08-28: vehicles go on one quote; Production Supplies would be a
 * different quote, and walkies another. So a quote is a DEPARTMENT SLICE of an
 * order, not the whole order — one order can produce several, and each reads
 * as its own document to the client.
 *
 * That is why this composes from (orderId, department) rather than from a
 * vehicle. It also fixes the thing the per-vehicle version couldn't do: a
 * quote covering more than one unit.
 *
 * ── Owned and subcontracted look identical ───────────────────────────────────
 * A line is a line. Whether we own the unit or bring it in from a partner is
 * ours to know: no vendor is named, nothing marks a line as a sub-rental, and
 * the per-line "photos & specs" link resolves to whichever surface that
 * vehicle has — the public catalog for a listed one, its unlisted token page
 * for anything else. The client cannot tell the difference, which is the same
 * rule the unlisted pages and the vendor conduit follow.
 *
 * ── Money ────────────────────────────────────────────────────────────────────
 * Line rates are what the client is billed, straight off the order. Nothing
 * here touches SubcontractedVehicle.discountPercent or any derived net cost —
 * neither is selected, so our margin cannot reach this email.
 */
import { prisma } from '@/lib/prisma'
import type { LineItemDepartment } from '@prisma/client'
import {
  fmtMoney,
  formatFeeRate,
  coversHoursNote,
  UNION_SCOPE_LABEL,
  type SubFeeUnit,
  type SubFeeUnionScope,
} from '@/lib/sub-rentals/vehicles'
import { PUBLIC_SITE_ORIGIN } from '@/lib/site/publicUrl'

const ACCENT = '#D4A547'
const HEADER_BG = '#0f172a'
const TEXT = '#1f2937'
const MUTED = '#6b7280'
const CTA_BG = '#D97706'

/** What each department's quote is called in front of a client. */
export const DEPARTMENT_QUOTE_TITLE: Record<string, string> = {
  VEHICLES: 'Production Vehicle Quote',
  PRO_SUPPLIES: 'Production Supplies Quote',
  COMMUNICATIONS: 'Communications Quote',
  EXPENDABLES: 'Expendables Quote',
  STAGES: 'Stage Quote',
  GE: 'Grip & Electric Quote',
  ART: 'Art Department Quote',
}

export function departmentQuoteTitle(d: string): string {
  return DEPARTMENT_QUOTE_TITLE[d] ?? 'Quote'
}

/** "DAILY" → "day". Not a string trim: `'daily'.replace('ly','')` gives "dai". */
const RATE_UNIT: Record<string, string> = {
  DAILY: 'day',
  WEEKLY: 'week',
  MONTHLY: 'month',
  FLAT: 'flat',
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function fmtDay(d: Date | null): string {
  if (!d) return ''
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

function dateRange(a: Date | null, b: Date | null): string {
  if (!a && !b) return ''
  if (a && b && a.getTime() === b.getTime()) return fmtDay(a)
  return [fmtDay(a), fmtDay(b)].filter(Boolean).join(' — ')
}

export interface DepartmentQuoteArgs {
  orderId: string
  department: LineItemDepartment
  message?: string | null
  clientFirstName?: string | null
  agentName: string
  agentPhone?: string | null
}

export interface DepartmentQuoteOk {
  ok: true
  subject: string
  html: string
  text: string
  defaultBody: string
  title: string
  lineCount: number
  total: number
  order: { id: string; orderNumber: string; jobCode: string | null }
}

export type DepartmentQuoteResult =
  | DepartmentQuoteOk
  | { ok: false; status: number; error: string }

/**
 * Where a client can go to look at this line's vehicle, if anywhere.
 * Listed catalog page wins over an unlisted token page; a line with neither
 * simply renders without a link rather than pointing at a 404.
 */
async function vehicleLinkFor(args: {
  assetCategoryId: string | null
  description: string
  subVehicleIds: { id: string; publicSlug: string | null; publiclyListed: boolean; publicToken: string | null; name: string }[]
}): Promise<string | null> {
  if (args.assetCategoryId) {
    const owned = await prisma.vehicleCategory.findFirst({
      where: { assetCategoryId: args.assetCategoryId, published: true, active: true },
      select: { slug: true },
    })
    if (owned) return `${PUBLIC_SITE_ORIGIN}/vehicles/${owned.slug}`
  }
  const sub = args.subVehicleIds.find((s) => args.description.toLowerCase().includes(s.name.toLowerCase()))
  if (sub) {
    if (sub.publiclyListed && sub.publicSlug) return `${PUBLIC_SITE_ORIGIN}/vehicles/${sub.publicSlug}`
    if (sub.publicToken) return `${PUBLIC_SITE_ORIGIN}/unit/${sub.publicToken}`
  }
  return null
}

export async function composeDepartmentQuote(
  args: DepartmentQuoteArgs,
): Promise<DepartmentQuoteResult> {
  const order = await prisma.order.findUnique({
    where: { id: args.orderId },
    select: {
      id: true,
      orderNumber: true,
      startDate: true,
      endDate: true,
      job: { select: { jobCode: true } },
      lineItems: {
        where: { department: args.department },
        select: {
          id: true, description: true, rate: true, rateType: true, quantity: true,
          billableDays: true, lineTotal: true, pickupDate: true, returnDate: true,
          assetCategoryId: true,
        },
        orderBy: { sortOrder: 'asc' },
      },
      // Vendor fees ride along only for sub-rentals actually on this order.
      // Their vendor is never named — to the client these are just the
      // additional charges that come with the unit.
      subRentals: {
        select: {
          vendorId: true,
          subcontractedVehicle: {
            select: { id: true, name: true, publicSlug: true, publiclyListed: true, publicToken: true },
          },
        },
      },
    },
  })
  if (!order) return { ok: false, status: 404, error: 'order not found' }
  if (order.lineItems.length === 0) {
    return {
      ok: false,
      status: 400,
      error: `This order has no ${departmentQuoteTitle(args.department).replace(' Quote', '')} lines to quote.`,
    }
  }

  const title = departmentQuoteTitle(args.department)
  const subVehicles = order.subRentals
    .map((s) => s.subcontractedVehicle)
    .filter((v): v is NonNullable<typeof v> => !!v)

  const lines = await Promise.all(
    order.lineItems.map(async (l) => ({
      description: l.description,
      dates: dateRange(l.pickupDate, l.returnDate),
      qty: l.quantity,
      days: l.billableDays,
      rate: Number(l.rate),
      rateType: l.rateType,
      total: Number(l.lineTotal),
      link: await vehicleLinkFor({
        assetCategoryId: l.assetCategoryId,
        description: l.description,
        subVehicleIds: subVehicles,
      }),
    })),
  )
  const total = lines.reduce((s, l) => s + l.total, 0)

  // Ancillary fees from any vendor whose unit is on this order.
  const vendorIds = [...new Set(order.subRentals.map((s) => s.vendorId))]
  const fees = vendorIds.length
    ? await prisma.subcontractedFee.findMany({
        where: { isActive: true, vendorId: { in: vendorIds } },
        select: { id: true, label: true, amount: true, unit: true, coversHours: true, unionScope: true },
        orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
      })
    : []

  const greetName = args.clientFirstName?.trim() || 'there'
  const window = dateRange(order.startDate, order.endDate)
  const subject = `SirReel — ${title}${window ? ` · ${window}` : ''}`
  const defaultBody =
    `Here's the ${title.toLowerCase()} for your dates. Rates are per the terms below; ` +
    `let me know if anything needs adjusting and I'll get it sorted.`
  const bodyText = args.message?.trim() || defaultBody

  const lineRows = lines
    .map(
      (l, i) => `
              <tr>
                <td style="padding: 11px 16px; font-size: 15px; color: ${TEXT}; ${i ? `border-top: 1px solid #f0f0f0;` : ''}">
                  ${l.link ? `<a href="${l.link}" style="color:${TEXT};text-decoration:none;border-bottom:1px solid ${ACCENT};">${escapeHtml(l.description)}</a>` : escapeHtml(l.description)}
                  <br/><span style="font-size:12px;color:${MUTED};">${escapeHtml(
                    [l.dates, l.days ? `${l.days} day${l.days === 1 ? '' : 's'}` : '', l.qty > 1 ? `×${l.qty}` : '']
                      .filter(Boolean)
                      .join(' · '),
                  )}</span>
                </td>
                <td align="right" valign="top" style="padding: 11px 16px; font-size: 15px; font-weight: 700; color: ${TEXT}; ${i ? `border-top: 1px solid #f0f0f0;` : ''}">
                  ${escapeHtml(fmtMoney(l.total))}
                  <br/><span style="font-size:12px;font-weight:400;color:${MUTED};">${escapeHtml(fmtMoney(l.rate))} / ${RATE_UNIT[l.rateType] ?? l.rateType.toLowerCase()}</span>
                </td>
              </tr>`,
    )
    .join('')

  const feeRows = fees
    .map((f) => {
      const like = { amount: String(f.amount), unit: f.unit as SubFeeUnit, coversHours: f.coversHours ? String(f.coversHours) : null }
      const scope = f.unionScope as SubFeeUnionScope
      const quals = [coversHoursNote(like), scope !== 'ALL' ? UNION_SCOPE_LABEL[scope] : null].filter(Boolean).join(' · ')
      return `
              <tr>
                <td style="padding: 9px 16px; font-size: 14px; color: ${TEXT}; border-top: 1px solid #f0f0f0;">
                  ${escapeHtml(f.label)}
                  ${quals ? `<br/><span style="font-size:12px;color:${MUTED};">${escapeHtml(quals)}</span>` : ''}
                </td>
                <td align="right" valign="top" style="padding: 9px 16px; font-size: 14px; font-weight: 600; color: ${TEXT}; border-top: 1px solid #f0f0f0;">${escapeHtml(formatFeeRate(like))}</td>
              </tr>`
    })
    .join('')

  const bigCap = (c: string) => `<span style="font-size:13px;">${c}</span>`
  const smCap = (c: string) => `<span style="font-size:10px;">${c}</span>`
  const wordGap = '<span style="display:inline-block;width:10px;">&nbsp;</span>'
  const dashGap = `<span style="font-size:11px;color:rgba(212,165,71,0.6);margin:0 6px;">&ndash;</span>`
  const tsxTagline = [
    bigCap('T'), bigCap('S'), bigCap('X'), dashGap,
    bigCap('T'), smCap('H'), smCap('E'), wordGap,
    bigCap('S'), smCap('I'), smCap('R'), bigCap('R'), smCap('E'), smCap('E'), smCap('L'), wordGap,
    bigCap('E'), smCap('X'), smCap('P'), smCap('E'), smCap('R'), smCap('I'), smCap('E'), smCap('N'), smCap('C'), smCap('E'),
  ].join('')

  const html = `<!doctype html>
<html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#f3f4f6;">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width:600px;background-color:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.04);">
        <tr><td style="background-color:${HEADER_BG};padding:20px 32px;">
          <img src="https://hq.sirreel.com/sirreel-logo-white.png" alt="SirReel" style="height:28px;width:auto;display:block;" />
        </td></tr>
        <tr><td style="padding:28px 32px 4px;">
          <p style="font-size:17px;color:${TEXT};margin:0 0 12px;line-height:1.5;">Hi ${escapeHtml(greetName)},</p>
          <p style="font-size:16px;color:${TEXT};margin:0 0 12px;line-height:1.6;">${escapeHtml(bodyText)}</p>
        </td></tr>

        <tr><td style="padding:14px 32px 0;">
          <div style="border-left:3px solid ${ACCENT};padding-left:14px;">
            <p style="font-size:12px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${ACCENT};margin:0 0 2px;">${escapeHtml(title)}</p>
            ${window ? `<p style="font-size:20px;font-weight:800;color:${TEXT};margin:0;">${escapeHtml(window)}</p>` : ''}
            <p style="font-size:13px;color:${MUTED};margin:2px 0 0;">Reference ${escapeHtml(order.job?.jobCode ?? order.orderNumber)}</p>
          </div>
        </td></tr>

        <tr><td style="padding:16px 32px 0;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
            ${lineRows}
            <tr>
              <td style="padding:12px 16px;font-size:14px;font-weight:700;color:${TEXT};border-top:2px solid #e5e7eb;background:#fafafa;">Total</td>
              <td align="right" style="padding:12px 16px;font-size:17px;font-weight:800;color:${TEXT};border-top:2px solid #e5e7eb;background:#fafafa;">${escapeHtml(fmtMoney(total))}</td>
            </tr>
          </table>
        </td></tr>

        ${
          fees.length
            ? `<tr><td style="padding:0 32px 4px;">
          <p style="font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${MUTED};margin:18px 0 8px;">Additional charges</p>
        </td></tr>
        <tr><td style="padding:0 32px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">${feeRows}</table>
        </td></tr>`
            : ''
        }

        <tr><td style="padding:22px 32px 0;">
          <p style="font-size:13px;color:${MUTED};margin:0;line-height:1.6;">
            Quote only &mdash; not a reservation. Rates are subject to availability and confirmation, and exclude applicable taxes. Dates are held once confirmed in writing.
          </p>
        </td></tr>

        <tr><td style="padding:22px 32px 4px;">
          <p style="font-size:16px;color:${TEXT};margin:0;line-height:1.6;">
            ${escapeHtml(args.agentName)}<br/>
            <span style="color:${MUTED};font-size:14px;">&amp; Team SirReel</span>
            ${args.agentPhone ? `<br/><span style="color:${MUTED};font-size:14px;">${escapeHtml(args.agentPhone)}</span>` : ''}
          </p>
        </td></tr>

        <tr><td align="center" style="padding:26px 32px 8px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
            <td style="border-top:1px solid rgba(212,165,71,0.35);padding-top:12px;">
              <span style="color:${ACCENT};letter-spacing:3px;font-family:Georgia,'Times New Roman',serif;">${tsxTagline}</span>
            </td>
          </tr></table>
        </td></tr>
        <tr><td align="center" style="padding:4px 32px 26px;">
          <p style="font-size:12px;color:${MUTED};margin:0;">8500 Lankershim Blvd, Sun Valley CA 91352 &middot; (888) 477-7335</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`

  const textParts: string[] = [
    `Hi ${greetName},`, '', bodyText, '',
    `${title.toUpperCase()}${window ? ` — ${window}` : ''}`,
    `Reference ${order.job?.jobCode ?? order.orderNumber}`, '',
    ...lines.map((l) => {
      const meta = [l.dates, l.days ? `${l.days} day${l.days === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ')
      return `  ${l.description}${meta ? ` (${meta})` : ''}: ${fmtMoney(l.total)}${l.link ? `\n    ${l.link}` : ''}`
    }),
    '', `  Total: ${fmtMoney(total)}`,
  ]
  if (fees.length) {
    textParts.push('', 'Additional charges:')
    for (const f of fees) {
      const like = { amount: String(f.amount), unit: f.unit as SubFeeUnit, coversHours: f.coversHours ? String(f.coversHours) : null }
      textParts.push(`  ${f.label}: ${formatFeeRate(like)}`)
    }
  }
  textParts.push(
    '',
    'Quote only — not a reservation. Rates are subject to availability and confirmation, and exclude applicable taxes.',
    '', `— ${args.agentName}`, '& Team SirReel',
    ...(args.agentPhone ? [args.agentPhone] : []),
    '', 'TSX — The SirReel Experience',
    '8500 Lankershim Blvd, Sun Valley CA 91352 · (888) 477-7335',
  )

  return {
    ok: true,
    subject,
    html,
    text: textParts.join('\n'),
    defaultBody,
    title,
    lineCount: lines.length,
    total,
    order: { id: order.id, orderNumber: order.orderNumber, jobCode: order.job?.jobCode ?? null },
  }
}

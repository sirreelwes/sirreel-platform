/**
 * Requests from utliiz.com — companies that aren't SirReel partners
 * asking for a workspace. Stored as UtliizLead, mailed to VerMar ops,
 * worked from /vermar/workspaces.
 */
import { prisma } from '@/lib/prisma'
import { sendAgreementEmail } from '@/lib/email/sendAgreementEmail'
import { HQ_PRODUCT, vermarOpsEmails } from './product'

export const FLEET_SIZES = ['1-5', '6-15', '16-40', '40+'] as const

const clean = (v: unknown, max: number): string | null => (typeof v === 'string' ? v.trim().slice(0, max) || null : null)
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function createLead(input: Record<string, unknown>, ip: string | null): Promise<{ id: string }> {
  const name = clean(input.name, 120)
  const company = clean(input.company, 160)
  const email = clean(input.email, 200)?.toLowerCase() ?? null
  if (!name) throw Object.assign(new Error('Your name, please.'), { status: 400 })
  if (!company) throw Object.assign(new Error('Your company name, please.'), { status: 400 })
  if (!email || !EMAIL_RE.test(email)) throw Object.assign(new Error('A working email, please — it’s how we send your link.'), { status: 400 })
  const fleetSize = clean(input.fleetSize, 20)
  const row = await prisma.utliizLead.create({
    data: {
      name, company, email,
      phone: clean(input.phone, 30),
      fleetSize: fleetSize && (FLEET_SIZES as readonly string[]).includes(fleetSize) ? fleetSize : null,
      fleetKind: clean(input.fleetKind, 500),
      note: clean(input.note, 2000),
      source: 'site',
      ipAddress: ip,
    },
    select: { id: true },
  })
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://hq.sirreel.com').replace(/\/$/, '')
  const lines = [
    `${name} at ${company} asked for a ${HQ_PRODUCT.name} workspace from utliiz.com.`,
    `Email: ${email}`,
    row && input.phone ? `Phone: ${clean(input.phone, 30)}` : null,
    fleetSize ? `Fleet size: ${fleetSize}` : null,
    input.fleetKind ? `What they run: ${clean(input.fleetKind, 500)}` : null,
    input.note ? `Note: ${clean(input.note, 2000)}` : null,
  ].filter(Boolean) as string[]
  await sendAgreementEmail({
    to: vermarOpsEmails(),
    replyTo: email,
    subject: `${HQ_PRODUCT.name} request — ${company}`,
    html: `<p>${lines.map((l) => l.replace(/&/g, '&amp;').replace(/</g, '&lt;')).join('<br/>')}</p><p><a href="${base}/vermar/workspaces">${base}/vermar/workspaces</a></p>`,
    text: `${lines.join('\n')}\n\n${base}/vermar/workspaces`,
    label: 'utliiz-lead',
  }).catch(() => null)
  return { id: row.id }
}

export interface LeadRow {
  id: string; name: string; company: string; email: string; phone: string | null
  fleetSize: string | null; fleetKind: string | null; note: string | null
  contactedAt: string | null; contactedBy: string | null; createdAt: string
}

export async function listLeads(): Promise<LeadRow[]> {
  const rows = await prisma.utliizLead.findMany({ orderBy: { createdAt: 'desc' }, take: 200 })
  return rows.map((r) => ({
    id: r.id, name: r.name, company: r.company, email: r.email, phone: r.phone,
    fleetSize: r.fleetSize, fleetKind: r.fleetKind, note: r.note,
    contactedAt: r.contactedAt?.toISOString() ?? null, contactedBy: r.contactedBy, createdAt: r.createdAt.toISOString(),
  }))
}

export async function setLeadContacted(id: string, contacted: boolean, by: string): Promise<void> {
  const row = await prisma.utliizLead.findUnique({ where: { id }, select: { id: true } })
  if (!row) throw Object.assign(new Error('Request not found.'), { status: 404 })
  await prisma.utliizLead.update({ where: { id }, data: contacted ? { contactedAt: new Date(), contactedBy: by } : { contactedAt: null, contactedBy: null } })
}

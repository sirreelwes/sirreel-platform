/**
 * THE PEOPLE AT A PARTNER — owner, accounting, dispatch, whoever else.
 *
 * Wes 2026-09-11: "I need to be able to add people on the partner portal.
 * owners and others. let's have a contacts section." Both sides keep the list:
 * HQ from the Portals panel, the partner from their own page.
 *
 * Two flags carry the rules he chose:
 *   isPrimary      the address on file. Mirrored into
 *                  Vendor.contactName/email/phone, so every existing partner
 *                  mail path keeps sending exactly where it sent before.
 *   emailBookings  per-person, OFF by default. Ticked, they are CC'd on
 *                  booking mail (estimate, hold request, it's-a-go, cancel,
 *                  logistics) — never on the introduction or the account link,
 *                  which stay one-to-one with the person who holds the page.
 *
 * The partner's existing contact on file becomes the first row the first time
 * the list is read, so neither side opens on an empty section.
 */
import type { Prisma, PrismaClient } from '@prisma/client'

type Db = PrismaClient | Prisma.TransactionClient

export const VENDOR_CONTACT_ROLES = [
  { key: 'OWNER', label: 'Owner' },
  { key: 'ACCOUNTING', label: 'Accounting' },
  { key: 'DISPATCH', label: 'Dispatch' },
  { key: 'SALES', label: 'Sales' },
  { key: 'OPERATIONS', label: 'Operations' },
  { key: 'OTHER', label: 'Other' },
] as const

export type VendorContactRole = (typeof VENDOR_CONTACT_ROLES)[number]['key']

export function isVendorContactRole(v: unknown): v is VendorContactRole {
  return typeof v === 'string' && VENDOR_CONTACT_ROLES.some((r) => r.key === v)
}

export function contactRoleLabel(key: string): string {
  return VENDOR_CONTACT_ROLES.find((r) => r.key === key)?.label ?? 'Other'
}

export interface VendorContactView {
  id: string
  name: string
  email: string | null
  phone: string | null
  role: VendorContactRole
  roleLabel: string
  notes: string | null
  isPrimary: boolean
  emailBookings: boolean
  addedByPartner: boolean
}

export interface VendorContactInput {
  name?: unknown
  email?: unknown
  phone?: unknown
  role?: unknown
  notes?: unknown
  isPrimary?: unknown
  emailBookings?: unknown
}

export interface CleanContact {
  name: string
  email: string | null
  phone: string | null
  role: VendorContactRole
  notes: string | null
  isPrimary: boolean
  emailBookings: boolean
}

const trim = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null
  const s = v.trim().slice(0, max)
  return s || null
}

/** A workable address, not a full RFC — the point is to catch a typo before it
 *  becomes a booking email nobody receives. */
export function looksLikeEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)
}

/** Pure. Everything both write paths (HQ, partner) must agree on. */
export function cleanContactInput(raw: VendorContactInput): { ok: true; value: CleanContact } | { ok: false; error: string } {
  const name = trim(raw.name, 120)
  if (!name) return { ok: false, error: 'Give the person a name.' }
  const email = trim(raw.email, 200)?.toLowerCase() ?? null
  if (email && !looksLikeEmail(email)) return { ok: false, error: `“${email}” doesn’t look like an email address.` }
  const isPrimary = raw.isPrimary === true
  const emailBookings = raw.emailBookings === true
  if (!email && isPrimary) return { ok: false, error: 'The main contact needs an email address — that is where partner mail goes.' }
  if (!email && emailBookings) return { ok: false, error: 'Add an email address before asking us to copy them on bookings.' }
  return {
    ok: true,
    value: {
      name,
      email,
      phone: trim(raw.phone, 30),
      role: isVendorContactRole(raw.role) ? raw.role : 'OTHER',
      notes: trim(raw.notes, 1000),
      isPrimary,
      emailBookings,
    },
  }
}

const toView = (r: {
  id: string; name: string; email: string | null; phone: string | null; role: string
  notes: string | null; isPrimary: boolean; emailBookings: boolean; addedByPartner: boolean
}): VendorContactView => ({
  id: r.id,
  name: r.name,
  email: r.email,
  phone: r.phone,
  role: isVendorContactRole(r.role) ? r.role : 'OTHER',
  roleLabel: contactRoleLabel(r.role),
  notes: r.notes,
  isPrimary: r.isPrimary,
  emailBookings: r.emailBookings,
  addedByPartner: r.addedByPartner,
})

const SELECT = {
  id: true, name: true, email: true, phone: true, role: true,
  notes: true, isPrimary: true, emailBookings: true, addedByPartner: true,
} as const

/**
 * The partner's people, main contact first. The contact already on the vendor
 * row becomes the first entry the first time this runs, so the section never
 * opens empty on a partner HQ has been emailing for weeks.
 */
export async function listVendorContacts(db: Db, vendorId: string): Promise<VendorContactView[]> {
  const rows = await db.vendorContact.findMany({
    where: { vendorId, isActive: true },
    orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }],
    select: SELECT,
  })
  if (rows.length > 0) return rows.map(toView)

  const v = await db.vendor.findUnique({ where: { id: vendorId }, select: { contactName: true, email: true, phone: true } })
  const name = v?.contactName?.trim() || null
  const email = v?.email?.trim()?.toLowerCase() || null
  if (!name && !email) return []
  const seeded = await db.vendorContact.create({
    data: {
      vendorId,
      name: name ?? email!,
      email,
      phone: v?.phone ?? null,
      role: 'OWNER',
      isPrimary: !!email,
      emailBookings: false,
    },
    select: SELECT,
  })
  return [toView(seeded)]
}

/** The address on file follows the main contact, so every existing mail path
 *  (poEmail ?? email) keeps working without knowing this table exists. */
async function mirrorPrimaryToVendor(db: Db, vendorId: string): Promise<void> {
  const primary = await db.vendorContact.findFirst({
    where: { vendorId, isActive: true, isPrimary: true },
    select: { name: true, email: true, phone: true },
  })
  if (!primary?.email) return
  await db.vendor.update({
    where: { id: vendorId },
    data: { contactName: primary.name, email: primary.email, phone: primary.phone },
  })
}

async function clearOtherPrimaries(db: Db, vendorId: string, keepId: string): Promise<void> {
  await db.vendorContact.updateMany({ where: { vendorId, isPrimary: true, NOT: { id: keepId } }, data: { isPrimary: false } })
}

export async function addVendorContact(
  db: Db,
  vendorId: string,
  input: VendorContactInput,
  opts: { byPartner: boolean },
): Promise<{ ok: true; contact: VendorContactView } | { ok: false; error: string }> {
  const parsed = cleanContactInput(input)
  if (!parsed.ok) return parsed
  const v = parsed.value
  if (v.email) {
    const clash = await db.vendorContact.findFirst({ where: { vendorId, email: v.email }, select: { id: true, isActive: true } })
    if (clash) {
      // Re-adding someone who was removed brings them back rather than failing
      // on the unique index.
      const back = await db.vendorContact.update({
        where: { id: clash.id },
        data: { ...v, isActive: true, addedByPartner: opts.byPartner },
        select: SELECT,
      })
      if (v.isPrimary) { await clearOtherPrimaries(db, vendorId, back.id); await mirrorPrimaryToVendor(db, vendorId) }
      return { ok: true, contact: toView(back) }
    }
  }
  const created = await db.vendorContact.create({ data: { vendorId, ...v, addedByPartner: opts.byPartner }, select: SELECT })
  if (v.isPrimary) { await clearOtherPrimaries(db, vendorId, created.id); await mirrorPrimaryToVendor(db, vendorId) }
  return { ok: true, contact: toView(created) }
}

export async function updateVendorContactRow(
  db: Db,
  vendorId: string,
  contactId: string,
  input: VendorContactInput,
): Promise<{ ok: true; contact: VendorContactView } | { ok: false; error: string }> {
  const existing = await db.vendorContact.findFirst({ where: { id: contactId, vendorId }, select: { id: true } })
  if (!existing) return { ok: false, error: 'That person is not on this partner’s list.' }
  const parsed = cleanContactInput(input)
  if (!parsed.ok) return parsed
  const v = parsed.value
  const updated = await db.vendorContact.update({ where: { id: contactId }, data: v, select: SELECT })
  if (v.isPrimary) { await clearOtherPrimaries(db, vendorId, contactId); await mirrorPrimaryToVendor(db, vendorId) }
  return { ok: true, contact: toView(updated) }
}

/** Removing keeps the row (isActive false) — who we used to email is history,
 *  not a mistake to erase. The main contact cannot be removed; make someone
 *  else primary first, or the partner would have no address on file. */
export async function removeVendorContact(
  db: Db,
  vendorId: string,
  contactId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = await db.vendorContact.findFirst({ where: { id: contactId, vendorId }, select: { id: true, isPrimary: true } })
  if (!row) return { ok: false, error: 'That person is not on this partner’s list.' }
  if (row.isPrimary) return { ok: false, error: 'That is the main contact — make someone else the main contact first.' }
  await db.vendorContact.update({ where: { id: contactId }, data: { isActive: false, emailBookings: false } })
  return { ok: true }
}

/**
 * Who else to CC on booking mail: the people ticked "email about bookings",
 * minus whoever the mail already goes to.
 */
export async function vendorBookingCc(db: Db, vendorId: string, exclude: (string | null | undefined)[] = []): Promise<string[]> {
  const rows = await db.vendorContact.findMany({
    where: { vendorId, isActive: true, emailBookings: true, email: { not: null } },
    select: { email: true },
  })
  const skip = new Set(exclude.filter(Boolean).map((e) => (e as string).toLowerCase()))
  const out: string[] = []
  for (const r of rows) {
    const e = r.email!.toLowerCase()
    if (!skip.has(e) && !out.includes(e)) out.push(e)
  }
  return out
}

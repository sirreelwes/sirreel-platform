/**
 * Partner contacts texting AHA — the PARTNER level.
 *
 * Wes 2026-09-15, on Clifford Fields at California Rent A Car: "can he text
 * Aha and ask info about CRAC reservations incoming and returning? 'When is
 * Suburban coming back?'" Until now a partner's owner or office was a
 * stranger to AHA: identifySender knew staff and production contacts, and
 * identifyNumber knew a partner's DRIVER on a live sub-rental, nobody else.
 * The only way to let one in was a hand-made STAFF grant, which opens the
 * whole book — every client, every production name — to a company the
 * sub-rental conduit is built to keep those away from.
 *
 * So a number is a PARTNER when it sits on a partner's record: a
 * VendorContact phone (either side can add one on the partner page) or the
 * Vendor's own phone (the address on file mirrors the primary contact). It
 * opens exactly one lookup, partnerBookings(), scoped to that vendor's own
 * sub-rentals, never naming the production.
 *
 * "A partner" is the same fact partnerStage.ts reads: Wes has marked them,
 * or they have roster units or bookings. A service vendor (the plumber) with
 * a phone on file is NOT a partner and stays public; a prospect has nothing
 * to ask about yet.
 */
import { prisma } from '@/lib/prisma'
import { phoneTail } from '@/lib/assistant/phoneFactor'

export interface PartnerPhone {
  vendorId: string
  vendorName: string
  /** The person's name when the number is a contact's; else the vendor's contact name. */
  personName: string | null
  tail: string
  phone: string
  /** Which field the number sits in, for the admin roster. */
  field: string
}

export interface PartnerVendorRow {
  id: string
  name: string
  phone: string | null
  contactName: string | null
  contacts: Array<{ name: string; phone: string | null; role: string }>
}

/** Pure: every recognisable number on a set of partner rows, once per vendor per tail. */
export function partnerPhones(vendors: PartnerVendorRow[]): PartnerPhone[] {
  const out: PartnerPhone[] = []
  for (const v of vendors) {
    const seen = new Set<string>()
    for (const c of v.contacts) {
      const tail = phoneTail(c.phone)
      if (!tail || seen.has(tail)) continue
      seen.add(tail)
      out.push({ vendorId: v.id, vendorName: v.name, personName: c.name?.trim() || null, tail, phone: (c.phone ?? '').trim(), field: `Partner contact (${c.role})` })
    }
    const tail = phoneTail(v.phone)
    if (tail && !seen.has(tail)) {
      out.push({ vendorId: v.id, vendorName: v.name, personName: v.contactName?.trim() || null, tail, phone: (v.phone ?? '').trim(), field: 'Partner phone on file' })
    }
  }
  return out
}

/** Partners with a phone anywhere on their record. Throws on a DB failure — callers decide. */
export async function loadPartnerVendors(): Promise<PartnerVendorRow[]> {
  return prisma.vendor.findMany({
    where: {
      isActive: true,
      AND: [
        { OR: [{ partnerMarkedAt: { not: null } }, { subRentals: { some: {} } }, { subcontractedVehicles: { some: {} } }] },
        { OR: [{ phone: { not: null } }, { contacts: { some: { isActive: true, phone: { not: null } } } }] },
      ],
    },
    select: {
      id: true, name: true, phone: true, contactName: true,
      contacts: { where: { isActive: true, phone: { not: null } }, orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }], select: { name: true, phone: true, role: true } },
    },
    orderBy: { name: 'asc' },
  })
}

/** The partner(s) a sender's number belongs to — empty when none. Never throws. */
export async function partnersForNumber(senderPhone: string | null | undefined): Promise<PartnerPhone[]> {
  const tail = phoneTail(senderPhone)
  if (!tail) return []
  try {
    return partnerPhones(await loadPartnerVendors()).filter((p) => p.tail === tail)
  } catch (err) {
    console.error('[partnerIdentity] partner lookup failed:', err)
    return []
  }
}

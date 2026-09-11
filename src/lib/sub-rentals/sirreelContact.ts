/**
 * Who at SirReel a partner calls.
 *
 * Wes 2026-09-11: "each partner and vendor portal needs the contact info for
 * our main contact." The partner's own page carries a "Your SirReel contact"
 * card — name, title, cell, email. Vendor.sirreelContactUserId picks the
 * person; null (or a person who has left) falls back to Wes, who owns every
 * partner relationship today.
 */
import { prisma } from '@/lib/prisma'
import { WES_SIGNATURE_TITLE } from '@/lib/sub-rentals/welcomeSender'

export const DEFAULT_SIRREEL_CONTACT_EMAIL = 'wes@sirreel.com'

export interface SirReelContact {
  name: string
  title: string | null
  phone: string | null
  email: string
}

/** Roles that can be someone's SirReel contact — people who work here. */
export const SIRREEL_CONTACT_ROLES = ['ADMIN', 'MANAGER', 'AGENT', 'BILLING'] as const

export async function sirreelContactFor(userId: string | null | undefined): Promise<SirReelContact | null> {
  const pick = { name: true, email: true, phone: true, isActive: true } as const
  const chosen = userId ? await prisma.user.findUnique({ where: { id: userId }, select: pick }) : null
  const u = chosen?.isActive ? chosen : await prisma.user.findUnique({ where: { email: DEFAULT_SIRREEL_CONTACT_EMAIL }, select: pick })
  if (!u) return null
  const isWes = u.email.toLowerCase() === DEFAULT_SIRREEL_CONTACT_EMAIL
  return { name: u.name, title: isWes ? WES_SIGNATURE_TITLE : null, phone: u.phone, email: u.email }
}

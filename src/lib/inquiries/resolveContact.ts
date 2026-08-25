import { prisma } from '@/lib/prisma'

/**
 * Pull the human out of an inquiry — and make them a real Person.
 *
 * Wes 2026-08-25: "the email should self-populate from the incoming
 * email and the name should populate if associated with the email …
 * right now if you type a name you get the error."
 *
 * The error was "Set the inquiry contact (person with an email) before
 * sending the welcome", and it fired on essentially every inquiry:
 * Inquiry.personId is NULL on all of them, because nothing ever turned
 * the sender into a Person. The data was always there —
 *   GMAIL     → sourceMetadata.fromAddress  ("Durier Ryan <durier@gmail.com>")
 *   WEB_FORM  → sourceMetadata.contact      ({ name, email, phone })
 * — it just had nowhere to go. Typing a name in the resolver created a
 * Job contact, not an inquiry contact, so the precondition stayed unmet.
 *
 * parseInquiryContact() reads it; ensureInquiryContact() finds-or-creates
 * the Person (matched on email, which is the only reliable key) and
 * attaches them. Phone is backfilled onto an existing Person only when
 * that Person has none — never overwritten from a parsed guess.
 */

export interface ParsedContact {
  email: string | null
  firstName: string | null
  lastName: string | null
  phone: string | null
  /** Company NAME only — matching/creating companies stays with the resolver. */
  companyName: string | null
}

/** "Durier Ryan <durier@gmail.com>" | "durier@gmail.com" → parts. */
export function parseFromAddress(raw: string | null | undefined): { name: string | null; email: string | null } {
  const s = (raw ?? '').trim()
  if (!s) return { name: null, email: null }
  const angled = s.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/)
  if (angled) {
    const name = angled[1].trim()
    return { name: name || null, email: angled[2].trim().toLowerCase() || null }
  }
  if (s.includes('@')) return { name: null, email: s.toLowerCase() }
  return { name: s, email: null }
}

function splitName(full: string | null): { firstName: string | null; lastName: string | null } {
  const s = (full ?? '').trim().replace(/\s+/g, ' ')
  if (!s) return { firstName: null, lastName: null }
  const parts = s.split(' ')
  if (parts.length === 1) return { firstName: parts[0], lastName: '' }
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] }
}

const str = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : ''
  return s.length ? s : null
}

/** Read the contact an inquiry arrived with. Pure — no DB, no writes. */
export function parseInquiryContact(inquiry: {
  source: string
  sourceMetadata: unknown
}): ParsedContact {
  const md = (inquiry.sourceMetadata ?? {}) as Record<string, unknown>
  const extracted = (md.extractedData ?? {}) as Record<string, unknown>
  const contact = (md.contact ?? {}) as Record<string, unknown>

  // Web forms carry a structured contact; Gmail carries the raw From header.
  const fromParsed = parseFromAddress(str(md.fromAddress))
  const email = str(contact.email) ?? fromParsed.email ?? str(extracted.email)
  const nameRaw = str(contact.name) ?? fromParsed.name ?? str(extracted.contactName) ?? str(extracted.name)
  const { firstName, lastName } = splitName(nameRaw)

  return {
    email: email ? email.toLowerCase() : null,
    firstName,
    lastName,
    phone: str(contact.phone) ?? str(extracted.phone),
    companyName: str(extracted.company) ?? str(extracted.companyName) ?? str(contact.company),
  }
}

export interface EnsureResult {
  personId: string | null
  email: string | null
  name: string | null
  phone: string | null
  companyName: string | null
  /** 'existing' = already linked; 'matched' = found by email; 'created' = new Person; 'none' = no email to work with. */
  outcome: 'existing' | 'matched' | 'created' | 'none'
}

/**
 * Make sure the inquiry has a Person with an email attached, deriving one
 * from what the inquiry arrived with. Safe to call repeatedly.
 */
export async function ensureInquiryContact(inquiryId: string): Promise<EnsureResult> {
  const inquiry = await prisma.inquiry.findUnique({
    where: { id: inquiryId },
    select: {
      id: true, source: true, sourceMetadata: true, personId: true,
      person: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
    },
  })
  if (!inquiry) throw new Error('Inquiry not found')

  const parsed = parseInquiryContact(inquiry)

  // Already has a usable contact — nothing to do.
  if (inquiry.person?.email) {
    return {
      personId: inquiry.person.id,
      email: inquiry.person.email,
      name: `${inquiry.person.firstName ?? ''} ${inquiry.person.lastName ?? ''}`.trim() || null,
      phone: inquiry.person.phone ?? parsed.phone,
      companyName: parsed.companyName,
      outcome: 'existing',
    }
  }

  if (!parsed.email) {
    // Nothing to key on. Report honestly rather than inventing a Person.
    return { personId: null, email: null, name: null, phone: parsed.phone, companyName: parsed.companyName, outcome: 'none' }
  }

  const existing = await prisma.person.findFirst({
    where: { email: { equals: parsed.email, mode: 'insensitive' } },
    select: { id: true, firstName: true, lastName: true, email: true, phone: true },
  })

  if (existing) {
    // Backfill a missing phone; never overwrite what a human curated.
    if (!existing.phone && parsed.phone) {
      await prisma.person.update({ where: { id: existing.id }, data: { phone: parsed.phone } })
    }
    await prisma.inquiry.update({ where: { id: inquiryId }, data: { personId: existing.id } })
    return {
      personId: existing.id,
      email: existing.email,
      name: `${existing.firstName ?? ''} ${existing.lastName ?? ''}`.trim() || null,
      phone: existing.phone ?? parsed.phone,
      companyName: parsed.companyName,
      outcome: 'matched',
    }
  }

  const created = await prisma.person.create({
    data: {
      firstName: parsed.firstName ?? parsed.email.split('@')[0],
      lastName: parsed.lastName ?? '',
      email: parsed.email,
      phone: parsed.phone,
    },
    select: { id: true, firstName: true, lastName: true, email: true, phone: true },
  })
  await prisma.inquiry.update({ where: { id: inquiryId }, data: { personId: created.id } })
  return {
    personId: created.id,
    email: created.email,
    name: `${created.firstName ?? ''} ${created.lastName ?? ''}`.trim() || null,
    phone: created.phone,
    companyName: parsed.companyName,
    outcome: 'created',
  }
}

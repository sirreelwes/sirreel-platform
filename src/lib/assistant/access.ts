/**
 * AHA access levels — what a person can ask AHA for, and how that is
 * decided.
 *
 * Wes 2026-09-11: "generally, they should be able to access whatever they
 * can from whatever role they have in HQ." So the level FOLLOWS THE HQ
 * ROLE for anyone with an HQ account, and a hand-made grant
 * (/admin/assistant → "Add a number") covers everyone else — and takes a
 * person away (BLOCKED). Resolution, highest first, one winner:
 *
 *   1. BLOCKED grant            → blocked  (nothing; told to call the office)
 *   2. hand-made grant          → its level
 *   3. active HQ user by phone  → levelForRole(role)
 *   4. contact on a current job → contact
 *   5. anyone else              → public
 *
 * Pure. The DB reads live in senderIdentity.ts; the tool sets live in
 * runAssistant.ts and key off `level`.
 */
export type AhaLevel = 'blocked' | 'public' | 'contact' | 'staff' | 'admin'

/** Ordered low → high, for comparisons. */
export const LEVEL_ORDER: AhaLevel[] = ['blocked', 'public', 'contact', 'staff', 'admin']

export function atLeast(level: AhaLevel, floor: AhaLevel): boolean {
  return LEVEL_ORDER.indexOf(level) >= LEVEL_ORDER.indexOf(floor)
}

/** HQ role → AHA level. ADMIN is the only role that gets the platform memory. */
export function levelForRole(role: string | null | undefined): AhaLevel {
  switch ((role ?? '').toUpperCase()) {
    case 'ADMIN':
      return 'admin'
    case 'MANAGER':
    case 'AGENT':
    case 'BILLING':
    case 'DISPATCHER':
      return 'staff'
    default:
      return 'public'
  }
}

/** DB enum value (AhaGrant.level) → level. */
export function levelFromGrant(v: string): AhaLevel {
  const l = v.toLowerCase()
  return l === 'blocked' || l === 'contact' || l === 'staff' || l === 'admin' ? l : 'public'
}

/** What each level can ask AHA for — shown as the legend on /admin/assistant. */
export const LEVEL_CAPABILITIES: Record<AhaLevel, { label: string; can: string[] }> = {
  blocked: { label: 'Blocked', can: ['Nothing — AHA answers STOP/HELP only and tells them to call the office'] },
  public: {
    label: 'Public',
    can: ['Access codes with a job code + a corroborating detail', 'Emergency escalation', 'Gear setup help', 'Office hours, address, where to pay'],
  },
  contact: {
    label: 'Production contact',
    can: [
      'Everything Public can',
      'Their own job: units, dates, delivery, agent, out/back',
      'A message to their agent (any request, not only emergencies)',
      'That job’s truck codes with the unit or VIN last 4, no job code',
    ],
  },
  staff: {
    label: 'Staff',
    can: ['Everything a contact can, for any job', 'Who is on a unit, driver name + number, whether a job came back', 'Job lookups by name or code: dates, contacts, units'],
  },
  admin: {
    label: 'Admin',
    can: [
      'Everything Staff can',
      'Platform memory: how HQ works, what was built and why, from the written record',
      'Recent activity: what the admins have been doing, from the audit log',
      'Continuity: a walkthrough of anything they do not understand',
    ],
  },
}

export interface LevelInputs {
  grantLevel?: AhaLevel | null
  userRole?: string | null
  isContact?: boolean
}

export function resolveLevel(i: LevelInputs): AhaLevel {
  if (i.grantLevel === 'blocked') return 'blocked'
  if (i.grantLevel && i.grantLevel !== 'public') return i.grantLevel
  const byRole = i.userRole ? levelForRole(i.userRole) : 'public'
  if (byRole !== 'public') return byRole
  return i.isContact ? 'contact' : 'public'
}

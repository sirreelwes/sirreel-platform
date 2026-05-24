import type { JobRole } from '@prisma/client'

/**
 * Pick the "primary" contact off a Job's contacts list.
 *
 * Ladder (first match wins):
 *   PM marked primary → PM (any) → PC marked primary → PC (any) →
 *   any marked primary → first contact → null.
 *
 * Generic over whatever extra fields the caller selected (Person
 * subset on the list endpoint, full Person on the detail endpoint).
 */
export function pickPrimaryContact<T extends { role: JobRole; isPrimary: boolean }>(
  contacts: T[],
): T | null {
  return (
    contacts.find((c) => c.role === 'PM' && c.isPrimary) ||
    contacts.find((c) => c.role === 'PM') ||
    contacts.find((c) => c.role === 'PC' && c.isPrimary) ||
    contacts.find((c) => c.role === 'PC') ||
    contacts.find((c) => c.isPrimary) ||
    contacts[0] ||
    null
  )
}

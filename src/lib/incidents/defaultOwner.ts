/**
 * Default Incident.assigneeId on creation — Phase 4a.
 *
 * Every new incident (manual `/api/incidents` POST + the
 * `open-incident` ClaimMail action) gets assigned to the claims-pod
 * default owner unless the caller passes an explicit assigneeId.
 *
 * Today the default is Ana (the only non-admin in the claims pod);
 * Wes / Dani can reassign via the picker. Resolved at runtime by
 * email so the user id never has to be hardcoded into the script —
 * a DB rebuild that re-mints uuids keeps working.
 *
 * Returns null if the configured user isn't found (e.g. account
 * deleted). The create path treats null as "leave unassigned"
 * rather than failing the creation — claims-pod can pick it up
 * from the unassigned slot on the worklist.
 */

import { prisma } from '@/lib/prisma'

const DEFAULT_OWNER_EMAIL = 'ana@sirreel.com'

export async function resolveDefaultIncidentOwnerId(): Promise<string | null> {
  const u = await prisma.user.findUnique({
    where: { email: DEFAULT_OWNER_EMAIL },
    select: { id: true },
  })
  return u?.id ?? null
}

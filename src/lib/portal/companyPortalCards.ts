/**
 * The production company's cards on file, as the CLIENT sees them in the
 * account portal — display fields only, never the token. Shared by the
 * portal page, HQ's "see what they see" preview, and the cards route, so
 * the three can never disagree about what a client is shown.
 */
import { listCompanyCards, type CardOnFileSummary } from '@/lib/payments/companyCards'

export interface ClientCardRow {
  id: string
  last4: string | null
  cardType: string | null
  expiry: string | null
  cardholderName: string | null
  isDefault: boolean
  expired: boolean
  validated: boolean
  label: string | null
  /** 'PORTAL' — typed by the client (job paperwork or the account portal);
   *  'STAFF' — keyed by a rep from a signed authorization. */
  addedBy: 'PORTAL' | 'STAFF'
  authorizedAt: string | null
}

export function toClientCardRow(c: CardOnFileSummary): ClientCardRow {
  return {
    id: c.id,
    last4: c.last4,
    cardType: c.cardType,
    expiry: c.expiry,
    cardholderName: c.cardholderName,
    isDefault: c.isDefault,
    expired: c.expired,
    validated: c.validated,
    label: c.label,
    addedBy: c.source === 'STAFF' ? 'STAFF' : 'PORTAL',
    authorizedAt: c.authorizedAt ? c.authorizedAt.toISOString() : null,
  }
}

export async function listClientCards(companyId: string): Promise<ClientCardRow[]> {
  const cards = await listCompanyCards(companyId)
  // Wallet rows only. A legacy paperwork-only authorization has no wallet
  // row to set as default, and the mirror copies every portal card into the
  // wallet anyway — listing both would show the same card twice.
  return cards.filter((c) => c.origin === 'company').map(toClientCardRow)
}


'use client'

import { CardShell } from './CardShell'
import { PortalBankDetails } from '@/components/portal/PortalBankDetails'

/**
 * "Other ways to pay" — ACH, wire and Zelle, inside the guided portal.
 *
 * The card-authorization email tells a client that if they'd rather not put a
 * card down, the details are in their portal. Its button opens THIS portal,
 * so the details have to be here; before this they only existed in the job
 * portal, which a client who has not been quoted has no link to.
 *
 * Status is 'info', not 'todo'. Nothing here is required of anyone — the card
 * is the default path and this is the alternative — and an "Action needed"
 * chip on an optional card makes a finished portal look unfinished.
 *
 * The panel itself is the job portal's, reused rather than reskinned: these
 * numbers, the copy buttons and the invoice-redirect warning must read the
 * same wherever a client meets them. Only the endpoint differs (this portal
 * authenticates by token, not session), and the A/P share is off because its
 * route needs a job session this portal doesn't have.
 */
export function PaymentOptionsCard({
  token,
  open,
  onToggle,
}: {
  token: string
  open: boolean
  onToggle: () => void
}) {
  return (
    <CardShell
      icon="🏦"
      title="Other ways to pay"
      subtitle="ACH, wire or Zelle — no processing fee"
      status="info"
      statusLabel="No fee"
      open={open}
      onToggle={onToggle}
    >
      <PortalBankDetails
        endpoint={`/api/portal/v2/${token}/payment-details`}
        showShare={false}
      />
    </CardShell>
  )
}

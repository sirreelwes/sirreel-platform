import type { PayPeriodStatus } from '@prisma/client'

/**
 * DRAFT / LOCKED / EXPORTED, in the shared chip palette.
 *
 * The labels say what the status MEANS to the person reading, not what the
 * enum is called: a locked period is "locked — read only", because the first
 * question anyone has is whether they can still type in it.
 */
const LOOK: Record<PayPeriodStatus, { bg: string; fg: string; label: string }> = {
  DRAFT: { bg: 'bg-chip-warn-bg', fg: 'text-chip-warn-fg', label: 'Draft' },
  LOCKED: { bg: 'bg-chip-neutral-bg', fg: 'text-chip-neutral-fg', label: 'Locked' },
  EXPORTED: { bg: 'bg-chip-good-bg', fg: 'text-chip-good-fg', label: 'Exported' },
}

export function PeriodStatusChip({ status }: { status: PayPeriodStatus }) {
  const look = LOOK[status]
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${look.bg} ${look.fg}`}>
      {look.label}
    </span>
  )
}

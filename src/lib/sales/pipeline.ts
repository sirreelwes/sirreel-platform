import type { OrderQuoteStatus, LineItemDepartment } from '@prisma/client'

export type PipelineColumn = 'DRAFT' | 'SENT' | 'WON' | 'LOST'

/**
 * Earliest-unfinished-state rule for placing a Job in the Open Quotes
 * kanban (Phase 1 sales pipeline):
 *   - Any Order in DRAFT                              → DRAFT column
 *   - All Orders ≥ SENT, any Order in SENT            → SENT column
 *   - All Orders terminal, at least one WON           → WON column
 *   - All Orders terminal, no WON (LOST/EXPIRED only) → LOST column
 *
 * Returns null only if the Job has zero Orders.
 */
export function derivePipelineColumn(
  quoteStatuses: OrderQuoteStatus[]
): PipelineColumn | null {
  if (quoteStatuses.length === 0) return null
  if (quoteStatuses.some((s) => s === 'DRAFT')) return 'DRAFT'
  if (quoteStatuses.some((s) => s === 'SENT')) return 'SENT'
  // All Orders are terminal at this point.
  if (quoteStatuses.some((s) => s === 'WON')) return 'WON'
  return 'LOST' // EXPIRED counts toward LOST per the brief.
}

// Short labels for the department-footprint badges on Open Quotes cards.
export const DEPARTMENT_SHORT: Record<LineItemDepartment, string> = {
  VEHICLES: 'VEH',
  COMMUNICATIONS: 'COM',
  STAGES: 'STG',
  PRO_SUPPLIES: 'PRO',
  EXPENDABLES: 'EXP',
  GE: 'GE',
  ART: 'ART',
}

export const DEPARTMENT_LABEL: Record<LineItemDepartment, string> = {
  VEHICLES: 'Vehicles',
  COMMUNICATIONS: 'Communications',
  STAGES: 'Stages',
  PRO_SUPPLIES: 'Pro Supplies',
  EXPENDABLES: 'Expendables',
  GE: 'GE',
  ART: 'Art',
}

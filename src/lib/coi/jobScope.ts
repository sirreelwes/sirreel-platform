/**
 * The ONE "what is actually going out on this job" gather for COI scoping.
 *
 * Two questions scope the checklist, and they scope it in opposite directions:
 *
 *   - vehicleScope.ts        no truck on the job  → the two auto checks go NA
 *   - partnerEquipmentScope  a partner's unit     → the equipment floater
 *                                                   goes ALERT → CRITICAL
 *
 * Both read `subRentals`, so their Prisma selects cannot simply be spread into
 * the same `select` — the second `subRentals` key silently wins and the other
 * deriver gets a shape it never asked for. This composes them once, so a
 * caller loads one object and gets both verdicts, and neither can be
 * half-loaded into a confident wrong answer.
 *
 * Usage:
 *   const job = await prisma.job.findUnique({ where: { id }, select: COI_SCOPE_SELECT })
 *   const scope = deriveCoiScope(job ?? {})
 *   coiFlags(ai, scope.ctx)
 */

import {
  VEHICLE_SCOPE_SELECT,
  deriveVehicleScope,
  type VehicleScopeInput,
} from './vehicleScope'
import {
  derivePartnerEquipmentScope,
  type PartnerEquipmentScopeInput,
} from './partnerEquipmentScope'
import type { CoiCheckContext } from './checks'

export type CoiScopeInput = VehicleScopeInput & PartnerEquipmentScopeInput

/** Everything both derivers need, with `subRentals` merged rather than
 *  clobbered. Keep this the only place the two selects meet. */
export const COI_SCOPE_SELECT = {
  ...VEHICLE_SCOPE_SELECT,
  subRentals: {
    select: {
      ...VEHICLE_SCOPE_SELECT.subRentals.select,
      vendor: { select: { partnerKind: true, name: true } },
    },
  },
} as const

export interface CoiScope {
  hasVehicles: boolean | null
  vehicleReasons: string[]
  hasPartnerEquipment: boolean | null
  partnerEquipmentReasons: string[]
  /** Drop straight into coiFlags / coiChecklist / coiCheckWriteFields. */
  ctx: CoiCheckContext
}

export function deriveCoiScope(input: CoiScopeInput): CoiScope {
  const vehicles = deriveVehicleScope(input)
  const partner = derivePartnerEquipmentScope(input)
  return {
    hasVehicles: vehicles.hasVehicles,
    vehicleReasons: vehicles.reasons,
    hasPartnerEquipment: partner.hasPartnerEquipment,
    partnerEquipmentReasons: partner.reasons,
    ctx: {
      vehiclesOnJob: vehicles.hasVehicles,
      partnerEquipmentOnJob: partner.hasPartnerEquipment,
      partnerEquipmentNote: partner.reasons[0] ?? null,
    },
  }
}

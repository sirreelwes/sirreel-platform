/**
 * "What can SirReel do for my teams?" — the service list on the account
 * portal, and the same list that goes out in the share email.
 *
 * Wes 2026-09-04: "a list of services available at SirReel for their
 * teams."
 *
 * ── Live where it can be, curated where it must ────────────────────────
 * The fleet reads LIVE from the same VehicleCategory rows the public
 * /vehicles page and the order form show, so adding a truck to the
 * catalogue puts it in front of every executive without anyone editing a
 * marketing list. Stages read from the same STAGES constant the public
 * /stages page renders.
 *
 * The remaining lines — expendables, transport, after-hours — have no
 * catalogue behind them yet, so they are stated here as what they are: a
 * short, honest description with the page that explains them. Better a
 * curated line that is true than a "live" list assembled out of a table
 * that was never meant to describe services.
 *
 * NO RATES. An executive's copy of this list gets forwarded to a dozen
 * coordinators and, from there, wherever. The public pages quote list
 * price to anyone who asks; this list points at them rather than
 * embedding a number that may be under a negotiated rate card.
 */

import { getPublicVehicles } from '@/lib/site/vehicleCatalog'
import { STAGES } from '@/lib/site/stages'

export interface ServiceLine {
  /** Stable key for React and for the email template. */
  key: string
  name: string
  blurb: string
  /** Path on hq.sirreel.com / sirreel.com the reader can open. */
  href: string
  /** Concrete examples pulled live, when there are any. */
  examples: string[]
}

export interface ServiceCatalog {
  lines: ServiceLine[]
  vehicleCount: number
  stageCount: number
}

export async function buildServiceCatalog(): Promise<ServiceCatalog> {
  const vehicles = await getPublicVehicles().catch(() => [])

  const vehicleNames = vehicles.map((v) => v.name)
  const stageNames = STAGES.map((s) => s.name)

  const lines: ServiceLine[] = [
    {
      key: 'fleet',
      name: 'Production vehicles',
      blurb:
        'Cargo vans, supercubes, stakebeds, passenger vans, talent trailers and honeywagons — delivered to set or picked up from the yard.',
      href: '/vehicles',
      examples: vehicleNames.slice(0, 8),
    },
    {
      key: 'stages',
      name: 'Stages & standing sets',
      blurb:
        'Gridded sound stage, LED volume and black-box space in North Hollywood, with production offices, green rooms and drive-in access.',
      href: '/stages',
      examples: stageNames,
    },
    {
      key: 'standing-sets',
      name: 'Standing sets',
      blurb:
        'Dressed, camera-ready sets available by the day — walk in and shoot without a build.',
      href: '/standing-sets',
      examples: [],
    },
    {
      key: 'supplies',
      name: 'Expendables & supplies',
      blurb:
        'Restock a truck mid-run. Your team orders online and we deliver to the location — no PA driving to the shop.',
      href: '/order/supplies',
      examples: [],
    },
    {
      key: 'transport',
      name: 'Delivery, pickup & transport',
      blurb:
        'Drivers, delivery to location and return pickup, coordinated with your transpo captain from the same job page.',
      href: '/contact',
      examples: [],
    },
    {
      key: 'after-hours',
      name: 'After-hours yard access',
      blurb:
        'A wrap at 2am does not need to wait for morning. Your coordinator releases a one-night gate code to the driver making the run.',
      href: '/help',
      examples: [],
    },
  ]

  return { lines, vehicleCount: vehicles.length, stageCount: STAGES.length }
}

/**
 * Seed the FeeItem catalog from the RW pick-list fee codes
 * (docs/cleanup/2026-07-04-rw-import-plan.csv fee/labor section) plus
 * the two contract-defined per-day/per-gallon fees in
 * src/lib/contracts/fees.ts (LCDW / fuel / smoking).
 *
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   npx tsx scripts/fee-catalog-seed.ts            # preflight (no writes)
 *   npx tsx scripts/fee-catalog-seed.ts --apply    # upsert by code
 *
 * Idempotent: upserts by FeeItem.code — re-running updates amounts/
 * names in place, never duplicates.
 *
 * PERMANENT EXCLUSIONS (Wes's rulings, 2026-07-05 — do not revisit):
 *   - Hourly VEHICLE RENTAL codes (CUBEPERHR, CARGHRL, CARGLIFT,
 *     CUBEHRLY) — SirReel rents daily only; hourly vehicle rental is
 *     not a product.
 *   - Class A/B labor rates (6 codes) — SirReel no longer provides
 *     drivers. Ever.
 *   - GROUNDLIFT — eliminated.
 *   - 10% admin fee — removed from the business.
 */

import { prisma } from '../src/lib/prisma'
import type { FeeUnit } from '@prisma/client'

const APPLY = process.argv.includes('--apply')

interface SeedFee {
  code: string
  name: string
  amount: number
  unit: FeeUnit
  description?: string
}

const FEES: SeedFee[] = [
  // ── Flat fees (RW pick-list codes) ──────────────────────────────
  { code: 'DEL',        name: 'Delivery Fee',                              amount: 150,   unit: 'FLAT' },
  { code: 'DLUXNCDP',   name: 'Trailer Delivery / Pick-Up',                amount: 325,   unit: 'FLAT' },
  { code: 'DLUXNCS',    name: 'Trailer Service (Pump, Restock, Clean)',    amount: 325,   unit: 'FLAT' },
  { code: 'KEYREPLACE', name: 'Replacement of Missing Key',                amount: 210,   unit: 'FLAT' },
  { code: 'REPLAKEY',   name: 'Smart Key (Replacement & Programming)',     amount: 550,   unit: 'FLAT' },
  { code: 'ANIMALFEE',  name: 'Animal In Vehicle Fee',                     amount: 200,   unit: 'FLAT' },
  { code: 'CORKE',      name: 'Corkage — Electric',                        amount: 1500,  unit: 'FLAT' },
  { code: 'CORKG',      name: 'Corkage — Grip',                            amount: 500,   unit: 'FLAT' },
  { code: 'TRASH',      name: 'Trash Service Fee (per bag)',               amount: 25,    unit: 'FLAT', description: 'Qty = number of bags. RW code 23456.' },
  { code: 'SERVICEFEE', name: 'Toll / Ticket Processing Service Fee',      amount: 25,    unit: 'FLAT' },
  { code: 'COPYC',      name: 'Copies / Prints — Color',                   amount: 0.5,   unit: 'FLAT', description: 'Qty = number of copies.' },
  { code: 'LOGBOOK',    name: 'Daily Driver Logbook',                      amount: 10,    unit: 'FLAT', description: 'RW code 99.' },
  // ── Per-day fees ────────────────────────────────────────────────
  { code: 'LCDW',       name: 'Limited Collision Damage Waiver (LCDW)',    amount: 24,    unit: 'PER_DAY', description: 'Contract §LCDW — waives damage up to $1,000.' },
  { code: 'SMOKING',    name: 'Smoking Fee',                               amount: 250,   unit: 'PER_DAY', description: 'Contract rate — per day of the rental.' },
  { code: 'PARKSPOT',   name: 'Day / Night Parking Spot',                  amount: 50,    unit: 'PER_DAY', description: 'RW code PROD182.' },
  { code: 'PASSDD',     name: 'Passenger Van — Vehicle Repair Days',       amount: 200,   unit: 'PER_DAY' },
  { code: 'CUBEDD',     name: 'Super Cube/Truck — Vehicle Repair Days',    amount: 190,   unit: 'PER_DAY' },
  { code: 'CARGODD',    name: 'Super Cargo Van — Vehicle Repair Days',     amount: 170,   unit: 'PER_DAY' },
  // ── Per-mile fees ───────────────────────────────────────────────
  { code: 'MILEADDL',   name: 'Additional Mileage',                        amount: 0.5,   unit: 'PER_MILE', description: 'Beyond the 100/day · 500/week allowance (RW code MILES). Qty = miles.' },
  { code: 'SOLOM',      name: 'SOLO Trailer — Mileage',                    amount: 1.99,  unit: 'PER_MILE', description: 'Qty = miles.' },
  { code: 'SPOCM',      name: 'SPOC Trailer — Mileage',                    amount: 1.99,  unit: 'PER_MILE', description: 'Qty = miles.' },
  { code: 'SR36M',      name: 'SR-36 Trailer — Mileage',                   amount: 1.99,  unit: 'PER_MILE', description: 'Qty = miles.' },
  // ── Per-gallon fees ─────────────────────────────────────────────
  { code: 'FUEL',       name: 'Refuel (per gallon)',                       amount: 10,    unit: 'PER_GALLON', description: 'Contract rate — vehicle/generator returned below full. Qty = gallons.' },
  // ── Per-hour fees (2026-07-05 follow-up — PER_HOUR unit added) ──
  { code: 'STAGEOT',    name: 'Stage Hourly Overtime',                     amount: 300,   unit: 'PER_HOUR', description: 'Qty = hours.' },
  { code: 'VREPAIRL',   name: 'Vehicle Repair Hourly Labor',               amount: 115,   unit: 'PER_HOUR', description: 'Qty = hours.' },
  { code: 'SOLOG',      name: 'SOLO — Generator (per hour)',               amount: 12,    unit: 'PER_HOUR', description: 'Qty = hours.' },
  { code: 'SPOCG',      name: 'SPOC — Generator (per hour)',               amount: 12,    unit: 'PER_HOUR', description: 'Qty = hours.' },
  { code: 'SR36G',      name: 'SR-36 — Generator (per hour)',              amount: 12,    unit: 'PER_HOUR', description: 'Qty = hours.' },
  { code: 'CLEANING',   name: 'Cleaning Fee',                              amount: 75,    unit: 'PER_HOUR', description: 'Damage-dependent — hours entered at billing time.' },
  // ── Flat (2026-07-05 follow-up) ─────────────────────────────────
  { code: 'OPENFEE',    name: 'Opening Fee',                               amount: 175,   unit: 'FLAT' },
]

async function main() {
  console.log(`fee-catalog seed — ${FEES.length} fees, mode=${APPLY ? 'APPLY' : 'preflight'}`)
  for (const f of FEES) {
    const existing = await prisma.feeItem.findUnique({ where: { code: f.code } })
    const action = existing ? 'update' : 'create'
    console.log(`  [${action}] ${f.code.padEnd(11)} ${f.unit.padEnd(11)} $${f.amount.toFixed(2).padStart(8)}  ${f.name}`)
    if (!APPLY) continue
    await prisma.feeItem.upsert({
      where: { code: f.code },
      create: { code: f.code, name: f.name, amount: f.amount, unit: f.unit, description: f.description ?? null },
      update: { name: f.name, amount: f.amount, unit: f.unit, description: f.description ?? null },
    })
  }
  if (!APPLY) console.log('\npreflight only — re-run with --apply to write')
  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })

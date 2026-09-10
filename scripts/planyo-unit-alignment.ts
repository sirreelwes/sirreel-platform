/**
 * Planyo ↔ HQ unit alignment audit. WRITES NOTHING.
 *
 * WHY THIS EXISTS. HQ can read Planyo but cannot address it. The only
 * unit mapping in the codebase is `resolvePlanyoUnitName`, which runs
 * ONE way (Planyo string → `Asset.unitName`) and is LOSSY: it strips
 * `(A)`, `(Mid Roof)`, `#`, a leading `Super `, a leading `A - ` and a
 * trailing slot letter. You cannot invert it — HQ's "Cargo 20" does not
 * tell you whether Planyo calls that unit `Super Cargo # 20 (A)` or
 * something else. So any question of the form "could HQ write to the
 * right unit in Planyo" has to be answered empirically, and re-answered
 * whenever either side changes.
 *
 * THE AUTHORITATIVE SOURCE IS `unit_names`. `get_resource_info` returns
 * a resource's full unit roster regardless of whether anything was ever
 * booked on those units. An earlier version of this audit inferred
 * identities from `list_reservations` instead and wrongly reported five
 * live SuperCubes (Cube 5, 8, 9, 21, 24) as absent from Planyo — they
 * were simply unbooked in the sampled window. Do not reintroduce that
 * shortcut: booking history is a sample, the roster is the population.
 *
 * PLANYO UNITS ARE HOLD SLOTS, NOT TRUCKS. The roster carries rank
 * variants of the same physical unit (`1 (A)`, `1(2nd Hold)`,
 * `1(3rd Hold)`) plus pure queue placeholders (`Waitlist A01`,
 * `X - 2ND HOLD`, `Van - 3rd Hold B`). HQ keeps rank in
 * `BookingItem.holdRank` instead, so the two models disagree by
 * construction. This script separates a unit's PRIMARY slot from its
 * rank slots, because the primary is the only sane write target — an
 * asset with exactly one primary is unambiguously addressable even when
 * it shows up three times in the roster.
 *
 * WHAT THE THREE FINDINGS MEAN
 *   HQ → Planyo   an HQ asset with no Planyo unit cannot be represented
 *                 there at all. Lankershim rooms are the structural
 *                 case: Planyo files every space under one generic
 *                 "Studios" resource with no room concept.
 *   Planyo → HQ   a REAL Planyo unit with no HQ asset is the dangerous
 *                 direction: the team can book it in Planyo and the
 *                 import lands an unbindable hold, which still subtracts
 *                 from `availableToHold` while reading as free on
 *                 /gantt (Wes, 2026-09-02).
 *   ambiguous     more than one primary slot for one HQ asset — pick
 *                 wrong and you block the wrong thing.
 *
 * Run:
 *   export DATABASE_URL=$(grep DATABASE_URL .env.local | grep -v PRISMA | cut -d'"' -f2)
 *   export $(grep -E "^PLANYO_(API_KEY|SITE_ID)" .env.local | xargs)
 *   npx tsx scripts/planyo-unit-alignment.ts [--md]
 *
 * `--md` also writes a timestamped report under journals/.
 */
import { PrismaClient } from '@prisma/client'
import { mkdirSync, writeFileSync } from 'fs'
import { getResourceInfo, parseUnitNames } from '../src/lib/sync/planyo/planyoClient'
import { buildResourceCrosswalk } from '../src/lib/sync/planyo/resourceCrosswalk'
import { resolvePlanyoUnitName } from '../src/lib/scheduling/planyoNameNormalizer'

const prisma = new PrismaClient()

/**
 * Queue placeholders that name no physical unit. These are EXPECTED in
 * the roster and must not be reported as missing HQ assets — the noise
 * would bury the real ones.
 */
const PSEUDO_UNIT_RE = /wait\s*list|\bwaitlist|\b\d(?:st|nd|rd|th)\s+hold\b|^x\s*-/i

/** A rank variant of another unit ("1(2nd Hold)"), not a primary slot. */
const RANK_SLOT_RE = /\b\d(?:st|nd|rd|th)\s+hold\b/i

interface Slot {
  resourceId: number
  raw: string
  isRankSlot: boolean
}

async function main() {
  const wantMd = process.argv.includes('--md')
  const crosswalk = await buildResourceCrosswalk(prisma)

  const hqToSlots = new Map<string, Slot[]>()
  const orphanReal: string[] = []
  const orphanPseudo: string[] = []
  const rosterLines: string[] = []
  const failures: string[] = []

  for (const [resourceId, entry] of [...crosswalk.entries()].sort((a, b) => a[0] - b[0])) {
    const info = await getResourceInfo(resourceId)
    if (!info.ok) {
      failures.push(`resource ${resourceId} (${entry.name}): ${info.detail}`)
      continue
    }
    const units = parseUnitNames(info.data.unit_names)
    rosterLines.push(
      `res ${String(resourceId).padEnd(7)} "${info.data.name ?? '?'}" → HQ "${entry.name}"  qty=${info.data.quantity ?? '?'}  units=${units.length}`,
    )

    for (const raw of units) {
      const resolved = resolvePlanyoUnitName(raw, entry.name)
      const pseudo = PSEUDO_UNIT_RE.test(raw)
      if (resolved.isUnroutable) {
        orphanPseudo.push(`"${raw}" (res ${resourceId}) — names the facility, not a unit`)
        continue
      }
      const asset = await prisma.asset.findFirst({
        where: { unitName: resolved.lookupName },
        select: { unitName: true },
      })
      if (!asset) {
        const line = `"${raw}" (res ${resourceId}, ${entry.name}) → "${resolved.lookupName}"`
        if (pseudo) orphanPseudo.push(line)
        else orphanReal.push(line)
        continue
      }
      if (!hqToSlots.has(asset.unitName)) hqToSlots.set(asset.unitName, [])
      hqToSlots.get(asset.unitName)!.push({
        resourceId,
        raw,
        isRankSlot: RANK_SLOT_RE.test(raw),
      })
    }
  }

  const assets = await prisma.asset.findMany({
    where: { status: { not: 'RETIRED' } },
    select: { unitName: true, category: { select: { name: true } } },
    orderBy: { unitName: 'asc' },
  })

  const addressable: Array<{ unit: string; slot: Slot; rankSlots: number }> = []
  const ambiguous: Array<{ unit: string; primaries: Slot[] }> = []
  const absent: Array<{ unit: string; category: string }> = []

  for (const a of assets) {
    const slots = hqToSlots.get(a.unitName) ?? []
    if (slots.length === 0) {
      absent.push({ unit: a.unitName, category: a.category?.name ?? '?' })
      continue
    }
    const primaries = slots.filter((s) => !s.isRankSlot)
    if (primaries.length === 1) {
      addressable.push({ unit: a.unitName, slot: primaries[0], rankSlots: slots.length - 1 })
    } else {
      // Zero primaries (only rank slots) is just as unusable as several.
      ambiguous.push({ unit: a.unitName, primaries })
    }
  }

  const out: string[] = []
  const say = (s = '') => { out.push(s); console.log(s) }

  say(`Planyo ↔ HQ unit alignment — ${new Date().toISOString().slice(0, 16).replace('T', ' ')}Z`)
  say(`Source: get_resource_info.unit_names (authoritative roster), ${crosswalk.size} crosswalked resources`)
  say()
  say('=== RESOURCE ROSTERS ===')
  for (const l of rosterLines) say('  ' + l)
  if (failures.length) {
    say()
    say('  !! roster read FAILED — these resources are unaudited:')
    for (const f of failures) say('     ' + f)
  }

  say()
  say('=== HQ → PLANYO ===')
  say(`  HQ assets (non-retired)      : ${assets.length}`)
  say(`  addressable (one primary)    : ${addressable.length}`)
  say(`  ambiguous                    : ${ambiguous.length}`)
  say(`  absent from every roster     : ${absent.length}`)

  if (ambiguous.length) {
    say()
    say('  --- AMBIGUOUS: no single primary slot to write to ---')
    for (const a of ambiguous) {
      const detail = a.primaries.length
        ? a.primaries.map((p) => `${p.resourceId}||${p.raw}`).join(' | ')
        : '(only rank slots — no primary at all)'
      say(`    ${a.unit} → ${detail}`)
    }
  }

  if (absent.length) {
    const byCat = new Map<string, string[]>()
    for (const a of absent) {
      if (!byCat.has(a.category)) byCat.set(a.category, [])
      byCat.get(a.category)!.push(a.unit)
    }
    say()
    say('  --- ABSENT: cannot be represented in Planyo ---')
    for (const [cat, units] of [...byCat.entries()].sort((a, b) => b[1].length - a[1].length)) {
      say(`    ${cat} (${units.length}): ${units.join(', ')}`)
    }
  }

  say()
  say('=== PLANYO → HQ ===')
  say(`  real Planyo units with NO HQ asset : ${orphanReal.length}   <-- bookable there, unbindable here`)
  say(`  queue placeholders (expected)      : ${orphanPseudo.length}`)
  if (orphanReal.length) {
    say()
    say('  --- REAL UNITS HQ CANNOT SEE ---')
    for (const o of orphanReal) say('    ' + o)
  }

  say()
  say(`Addressable coverage: ${addressable.length}/${assets.length} HQ assets have exactly one primary Planyo slot.`)
  if (ambiguous.length || absent.length || orphanReal.length) {
    say('Alignment is INCOMPLETE — see the three sections above before trusting any unit-level write.')
  } else {
    say('Alignment is complete in both directions.')
  }

  if (wantMd) {
    mkdirSync('journals', { recursive: true })
    const path = `journals/planyo-unit-alignment-${new Date().toISOString().replace(/[:.]/g, '-')}.md`
    writeFileSync(path, '```\n' + out.join('\n') + '\n```\n')
    console.log(`\nreport written: ${path}`)
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())

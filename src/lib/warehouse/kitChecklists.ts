/**
 * What the warehouse counts off each unit, out and back.
 *
 * Oliver, 2026-09-14, via Wes: "trying to update so that every item that
 * goes out that is made up of multiple parts has some sort of
 * accountability checklist for the warehouse when they're checking it out
 * and in. We will continue to build more of these."
 *
 * That last sentence is why this is a table and not a pile of one-off
 * scripts: adding the next package should be one entry here, then a
 * re-run of scripts/seed-kit-unit-checks.ts.
 *
 * ── Checks, not kit pieces ─────────────────────────────────────────
 * Wes, 2026-09-14: "they are not billed separately." So every part below
 * is an `InventoryItem.unitChecks` entry, never an `InventoryKitPiece`.
 * The difference is the whole design:
 *
 *   - a KIT PIECE resolves to a real catalog row and becomes its own
 *     order line, with a price and a quantity the client can see;
 *   - a per-unit CHECK is a tick on the paper and a chip at the desk. It
 *     needs no catalog row, no price, and cannot touch a quote.
 *
 * Most of these parts have no catalog row and should not get one —
 * nobody rents a 9420 power cable on its own. The walkie battery and
 * charging bank ARE kit pieces (seed-radio-parts-kit.ts) because Wes's
 * RW sheet prints them as their own lines and the floor counts them that
 * way. These are the other kind.
 *
 * ── Oliver's labels, verbatim ──────────────────────────────────────
 * The names below are his, down to the "9420" prefix and the Milwaukee
 * dash. They are what is written on the shelf and what the floor says
 * out loud, and a checklist that renames things is a checklist people
 * stop trusting.
 *
 * ── Every twin, not one ────────────────────────────────────────────
 * The catalog carries the same machine more than once — an RW import
 * (numeric codes, hidden from the public site) beside a hand-entered
 * public row (EFX-*). A check attaches to ONE row, so listing a single
 * twin means an order built off the other gets no checklist and nobody
 * finds out. Where both are certain, both are listed. Where a row only
 * MIGHT be the same item, it goes in `unconfirmed` rather than `codes`:
 * seeding a checklist onto the wrong item is its own quiet failure.
 */

export interface KitChecklist {
  /** What the package is called in conversation. */
  label: string
  /**
   * Every catalog code that IS this item. Codes, not names — names
   * drift, and several of these rows were imported with their name AS
   * their code, so the spelling is load-bearing.
   */
  codes: string[]
  /** The attached parts, in Oliver's words. */
  checks: string[]
  /**
   * Rows that look like the same item but were not confirmed. NOT
   * seeded. Listed so the next person can confirm or dismiss them
   * rather than rediscovering them.
   */
  unconfirmed?: string[]
  /** Anything a maintainer needs to know. Printed nowhere. */
  note?: string
}

/**
 * THE BULB COLOUR IS NOT IN THE CHECK.
 *
 * Oliver listed the bulbs as 2700K Warm White (10x) OR 5000K Daylight
 * (10x) — a choice, not two things that both ship. Wes, 2026-09-14:
 * "just globe bulbs but indicate color as selected by client."
 *
 * So the check counts ten bulbs and says nothing about colour, because a
 * check is a fixed list printed on every order and a colour is a
 * per-order fact. The colour rides on the ORDER LINE, and the pull sheet
 * prints that line's note directly beneath this row — so the picker reads
 * "Each unit: ( ) Globe Light Bulbs (10)" with the client's colour on the
 * line above it.
 *
 * What does NOT exist yet is anywhere structured for the rep to record
 * that choice: today it is free text in the line note. Making it a real
 * field the rep picks from is a separate change, and a bigger one.
 */
const MIRROR_NOTE =
  'Bulb colour is deliberately absent from the check: 2700K vs 5000K is ' +
  "the client's choice, recorded on the order line, while a check is the " +
  'same on every order. The sheet prints the line note right under this row.'

export const KIT_CHECKLISTS: KitChecklist[] = [
  {
    label: 'DF-50 Hazer (water and oil)',
    codes: ['EFX-DF50-HAZER', '104417', '104418'],
    checks: ['Remote controller', 'Power cord', 'Case'],
    note:
      'Oliver wrote "remote controller, remote" — Wes confirmed 2026-09-14 ' +
      'that is a doubled phrase, one item, so three checks and not four. ' +
      'The DF-50 goes out pre-juiced; extra fluid is a client request and ' +
      'is not part of this list.',
  },
  {
    label: 'Leaf Blower - Battery Powered (Milwaukee M18)',
    codes: ['104432'],
    checks: ['Milwaukee - Rapid Charger', 'Milwaukee - 12.0 Ah Forge Battery'],
    unconfirmed: ['Leaf Blower - Battery Powered'],
    note:
      'The Rapid Charger exists as its own catalog row (104997) and is ' +
      'still a check here, not a kit piece — Wes: not billed separately.',
  },
  {
    label: 'Worklight - Battery Powered (Dewalt)',
    codes: ['104457'],
    checks: ['Dewalt Flexvolt Battery', 'Dewalt Flexvolt Charger'],
    unconfirmed: [
      'Worklight - Battery Powered Worklight (Dewalt)',
      'UTAH - WORKLIGHT, DEWALT',
    ],
    note:
      'Flexvolt Charger exists as 104458 (plus Dual 104459 and 4-Port ' +
      '105141). Which charger ships is a floor decision; the check just ' +
      'says one has to.',
  },
  {
    label: 'Worklight - Battery Powered (Pelican)',
    codes: ['104456'],
    checks: [
      '9420 Spare Battery',
      '9420 Battery Charger',
      '9420 Power Supply',
      '9420 Power Cable',
      '9420 Pelican Case',
    ],
    unconfirmed: ['Worklight - Battery Powered Worklight PELICAN', 'Battery Pwr Worklight'],
    note: 'None of the five exist as catalog rows, and none should — nobody rents them alone.',
  },
  {
    label: 'Wardrobe Steamer',
    codes: ['103856'],
    checks: ['Steamer Bottle'],
    unconfirmed: ['WAR-JIFFY-STEAMER'],
  },
  {
    label: 'Make Up Mirror, Half (Table Top)',
    codes: ['104434'],
    checks: ["Extension Cord - 25'", 'Globe Light Bulbs (10)'],
    unconfirmed: ['UTAH - TABLE TOP MAKE UP MIRROR'],
    note: MIRROR_NOTE,
  },
  {
    label: 'Make Up Mirror - Rolling',
    codes: ['104433'],
    checks: ["Extension Cord - 25'", 'Globe Light Bulbs (10)'],
    note: MIRROR_NOTE,
  },
]

/** Every code this registry would seed, for a caller that wants to look them up in one query. */
export function allChecklistCodes(): string[] {
  return [...new Set(KIT_CHECKLISTS.flatMap((c) => c.codes))]
}

/** The checklist covering a catalog code, or null. */
export function checklistForCode(code: string): KitChecklist | null {
  return KIT_CHECKLISTS.find((c) => c.codes.includes(code)) ?? null
}

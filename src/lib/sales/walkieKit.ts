/**
 * The walkie kit — what goes out with every radio order whether or not the
 * client thought to ask for it.
 *
 * SUPERSEDED (2026-08-24) by InventoryKitPiece + src/lib/inventory/kitPieces.ts,
 * which holds the same idea as per-item data and emits lines linked to real
 * catalog rows. This module is now the FALLBACK for the one case that
 * replacement can't serve: a quote where nothing matched the catalog, so
 * there is no parent row to hang a kit off. Its lines stay text-only —
 * nothing to scan, nothing to count back in. Don't add items here; add a
 * kit piece in the inventory drawer.
 *
 * Radios are useless on day two without power, so SirReel has always sent
 * charging banks and spare batteries alongside them, at no charge. That was
 * knowledge living in Hugo's and Julian's heads: nothing in a parsed quote
 * carried it, so the accessories reached the warehouse only when someone
 * remembered, and the pick list was short whenever they didn't.
 *
 * The ratios are Wes's, 2026-08-17:
 *   - spare batteries = 50% of the radio count
 *   - one charging bank per 12 radios, rounded down
 *
 * Two judgment calls the ratios don't cover, both erring toward the truck
 * leaving with enough gear:
 *   - a fractional battery rounds UP (15 radios → 8 spares, not 7)
 *   - fewer than 12 radios still gets one bank, since floor() would
 *     otherwise send a crew out with no way to charge anything
 *
 * These lines are quoted at $0. They exist for the pick list, not the
 * invoice — PickList membership follows the line's department, so a $0
 * COMMUNICATIONS line reaches the floor exactly like a paid one.
 */

export const WALKIE_KIT = {
  /** Spare batteries per radio. */
  sparesPerRadio: 0.5,
  /** Radios covered by a single charging bank. */
  radiosPerChargingBank: 12,
} as const

export interface KitLineSpec {
  description: string
  quantity: number
  /** Shown to the rep so an auto-added line never looks like a parse error. */
  note: string
}

/** The shape this module needs from a resolved line — nothing more. */
export interface KitInputLine {
  description: string
  quantity: number
  matchedProductName?: string | null
}

/**
 * Head noun of a description, singularized. "Multi-bank walkie chargers" →
 * "charger". The head is what distinguishes a radio line from an accessory
 * line that merely says "walkie" in passing.
 */
function headNoun(description: string): string {
  const words = description
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  const last = words[words.length - 1] ?? ''
  return last.endsWith('s') && last.length > 3 ? last.slice(0, -1) : last
}

const RADIO_HEADS = new Set([
  'walkie', 'talkie', 'radio', 'handheld', 'cp200', 'cp200d', 'motorola',
])

/** A base-radio line — the thing the kit is sized against. */
export function isRadioLine(line: KitInputLine): boolean {
  // A catalog match is the strongest signal: the row is a radio or it isn't.
  const matched = line.matchedProductName?.toLowerCase() ?? ''
  if (matched) return /cp200|uhf radio/.test(matched)
  // Unmatched line — go by what the client asked FOR, not what they mentioned.
  // "Spare walkie batteries" says walkie and is not a radio.
  return RADIO_HEADS.has(headNoun(line.description))
}

const CHARGER_RE = /\bcharg(?:er|ers|ing)\b/i
const BATTERY_RE = /\bbatter(?:y|ies)\b/i

/** Already on the quote — the client asked, so leave their line alone. */
function hasCharger(lines: KitInputLine[]): boolean {
  return lines.some((l) => CHARGER_RE.test(l.description) || CHARGER_RE.test(l.matchedProductName ?? ''))
}

function hasBattery(lines: KitInputLine[]): boolean {
  return lines.some((l) => BATTERY_RE.test(l.description) || BATTERY_RE.test(l.matchedProductName ?? ''))
}

export function spareBatteryCount(radioCount: number): number {
  return Math.ceil(radioCount * WALKIE_KIT.sparesPerRadio)
}

export function chargingBankCount(radioCount: number): number {
  return Math.max(1, Math.floor(radioCount / WALKIE_KIT.radiosPerChargingBank))
}

/**
 * What's missing from this quote's radio kit. Returns [] when there are no
 * radios, or when the client already listed the accessories themselves.
 */
export function deriveWalkieKit(lines: KitInputLine[]): KitLineSpec[] {
  const radios = lines
    .filter(isRadioLine)
    .reduce((sum, l) => sum + Math.max(0, Math.floor(l.quantity || 0)), 0)
  if (radios <= 0) return []

  const out: KitLineSpec[] = []
  if (!hasCharger(lines)) {
    const qty = chargingBankCount(radios)
    out.push({
      description: 'Walkie charging bank',
      quantity: qty,
      note: `Included with ${radios} radios — 1 per ${WALKIE_KIT.radiosPerChargingBank}, no charge`,
    })
  }
  if (!hasBattery(lines)) {
    const qty = spareBatteryCount(radios)
    out.push({
      description: 'Spare walkie batteries',
      quantity: qty,
      note: `Included with ${radios} radios — 50% spares, no charge`,
    })
  }
  return out
}

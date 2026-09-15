/**
 * Who counted what on a check sheet done in PASSES — the pure half.
 *
 * Wes, 2026-09-15: "When an order goes out or comes back, sometimes
 * warehouse workers have to start on one part of the order (for
 * instance, walkies) and move on somewhere else. They need to complete
 * the portion that they did, and then another warehouse employee might
 * take over and do the other stuff on the order ... notating who did
 * what."
 *
 * The report is one row per (order, edge), replaced in place on every
 * filing, so a second person finishing the sheet used to overwrite the
 * first person's name. Attribution therefore lives on the LINE, and this
 * module decides, per line, whether a filing is a new count (this pass
 * takes it) or the same count re-submitted (whoever counted it keeps it).
 *
 * The rule is deliberately about the FACTS on the line, not about which
 * lines the form "touched": the second person's screen re-submits the
 * first person's lines verbatim, and a re-submission is not a re-count.
 * Change the count, the swap, the note or the line name and it is yours.
 *
 * No prisma, no session — imported by the client form and the test.
 */

export interface PassStamp {
  /** The name on the floor. Never empty by the time it gets here. */
  name: string
  /** The HQ session that filed the pass. */
  userId: string | null
  at: Date
}

/** A line as the PREVIOUS filing left it. */
export interface PriorCountedLine {
  orderLineItemId: string | null
  description: string
  actualQty: number
  substituteFor: string | null
  note: string | null
  onSheet: boolean
  countedBy: string | null
  countedById: string | null
  countedAt: Date | null
}

/** A line as THIS filing says it. */
export interface NextCountedLine {
  orderLineItemId: string | null
  description: string
  actualQty: number
  substituteFor?: string | null
  note?: string | null
  onSheet: boolean
}

export interface LineAttribution {
  countedBy: string | null
  countedById: string | null
  countedAt: Date | null
  /** True when this filing counted (or re-counted) the line. */
  thisPass: boolean
}

const norm = (s: string | null | undefined) => (s ?? '').trim()

/** Same count, same swap, same note, same name → not a new count. */
export function sameCount(prior: PriorCountedLine, next: NextCountedLine): boolean {
  return (
    prior.onSheet &&
    next.onSheet &&
    prior.actualQty === next.actualQty &&
    norm(prior.description) === norm(next.description) &&
    norm(prior.substituteFor) === norm(next.substituteFor) &&
    norm(prior.note) === norm(next.note)
  )
}

/**
 * One attribution per `next` line, in order.
 *
 * `legacy` is the previous REPORT's own name and time: rows filed before
 * lines carried a name read as that, so the first multi-pass filing on an
 * old sheet does not strip its only record of who prepped it.
 *
 * Added rows (no order line) are matched by description + count, first
 * match wins and is consumed — two identical "Sandbag" rows are two rows.
 */
export function attributeLines(
  prior: PriorCountedLine[],
  next: NextCountedLine[],
  pass: PassStamp,
  legacy: { name: string | null; userId: string | null; at: Date | null } | null,
): LineAttribution[] {
  const byLine = new Map<string, PriorCountedLine>()
  const extras: PriorCountedLine[] = []
  for (const p of prior) {
    if (p.orderLineItemId) byLine.set(p.orderLineItemId, p)
    else extras.push(p)
  }

  return next.map((n) => {
    if (!n.onSheet) return { countedBy: null, countedById: null, countedAt: null, thisPass: false }

    let match: PriorCountedLine | undefined
    if (n.orderLineItemId) {
      const p = byLine.get(n.orderLineItemId)
      if (p && sameCount(p, n)) match = p
    } else {
      const i = extras.findIndex((p) => sameCount(p, n))
      if (i >= 0) match = extras.splice(i, 1)[0]
    }

    if (match) {
      // Carried: whoever counted it keeps it — falling back to the old
      // report-level name for a row filed before lines carried one.
      const name = match.countedBy ?? legacy?.name ?? null
      if (name) {
        return {
          countedBy: name,
          countedById: match.countedBy ? match.countedById : legacy?.userId ?? null,
          countedAt: match.countedAt ?? legacy?.at ?? null,
          thisPass: false,
        }
      }
    }
    return { countedBy: pass.name, countedById: pass.userId, countedAt: pass.at, thisPass: true }
  })
}

export interface PassSummary {
  name: string
  /** ISO — the earliest count this person has on the sheet. */
  at: string | null
  lines: number
}

/**
 * The people on a sheet, in the order they counted. One entry per NAME,
 * not per filing: Carlos doing walkies, Pedro doing cable, then Carlos
 * coming back for the truck pack is still "Carlos, Pedro" — the per-line
 * byline carries the detail.
 */
export function summarizePasses(
  lines: Array<{ onSheet: boolean; countedBy: string | null; countedAt: Date | string | null }>,
): PassSummary[] {
  const by = new Map<string, { name: string; at: number | null; lines: number }>()
  for (const l of lines) {
    if (!l.onSheet || !l.countedBy) continue
    const key = l.countedBy.trim().toLowerCase()
    const t = l.countedAt ? new Date(l.countedAt).getTime() : null
    const cur = by.get(key)
    if (!cur) {
      by.set(key, { name: l.countedBy.trim(), at: t, lines: 1 })
    } else {
      cur.lines++
      if (t !== null && (cur.at === null || t < cur.at)) cur.at = t
    }
  }
  return [...by.values()]
    .sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity))
    .map((p) => ({ name: p.name, at: p.at === null ? null : new Date(p.at).toISOString(), lines: p.lines }))
}

/** The report-level `preppedBy`: every name on the sheet, first counter
 *  first. Lists, the history search and the yard board all read it. */
export function rollupPreppedBy(passes: PassSummary[]): string | null {
  return passes.length ? passes.map((p) => p.name).join(', ') : null
}

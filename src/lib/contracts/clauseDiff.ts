/**
 * Word-level diff between our standard clause and the amended one.
 *
 * Exists so an operator can SEE what a redline actually did before it goes
 * to a client for signature. Reading two paragraphs side by side and
 * spotting that "owned," left the list is not review — it is a memory test,
 * and the thing being tested is contract language.
 *
 * Deliberately word-level, not character-level: a character diff on prose
 * shreds words into fragments ("re|placement| |cost") that read as noise.
 * Punctuation rides with its word so "value," -> "value" shows as one
 * change rather than a mysterious lone comma.
 */

export type DiffOp = 'same' | 'del' | 'ins'

export interface DiffSegment {
  op: DiffOp
  text: string
}

/** Split on whitespace, KEEPING the whitespace so output can be rejoined verbatim. */
function tokenize(s: string): string[] {
  return s.match(/\s+|[^\s]+/g) ?? []
}

function isSpace(t: string): boolean {
  return /^\s+$/.test(t)
}

/**
 * Longest common subsequence over word tokens.
 *
 * O(n*m) in a full table. Clause bodies run 150-350 words, so the largest
 * table is ~120k cells — trivial, and worth the exactness over a heuristic
 * that might mis-align a repeated phrase in a contract.
 */
function lcsTable(a: string[], b: string[]): Uint32Array {
  const w = b.length + 1
  const table = new Uint32Array((a.length + 1) * w)
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * w + j] =
        a[i] === b[j]
          ? table[(i + 1) * w + (j + 1)] + 1
          : Math.max(table[(i + 1) * w + j], table[i * w + (j + 1)])
    }
  }
  return table
}

export function diffClause(original: string, amended: string): DiffSegment[] {
  const a = tokenize(original)
  const b = tokenize(amended)
  const w = b.length + 1
  const table = lcsTable(a, b)

  const out: DiffSegment[] = []
  const push = (op: DiffOp, text: string) => {
    const last = out[out.length - 1]
    if (last && last.op === op) last.text += text
    else out.push({ op, text })
  }

  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push('same', a[i])
      i++
      j++
    } else if (table[(i + 1) * w + j] >= table[i * w + (j + 1)]) {
      push('del', a[i])
      i++
    } else {
      push('ins', b[j])
      j++
    }
  }
  while (i < a.length) push('del', a[i++])
  while (j < b.length) push('ins', b[j++])

  return coalesce(out)
}

/**
 * Group each changed region into "what went, then what came".
 *
 * The raw diff alternates token by token, which on contract prose renders as
 * `replacement`actual` cost`cash value` — legible only to whoever already
 * knows the answer. A client reading the agreement they are about to sign
 * needs the struck phrase whole and the added phrase whole, in that order.
 *
 * Whitespace inside a region is collapsed (it belongs to no side), and a
 * separator is re-inserted where trimming would otherwise weld the group to
 * the words around it.
 */
function coalesce(segments: DiffSegment[]): DiffSegment[] {
  const out: DiffSegment[] = []
  const push = (op: DiffOp, text: string) => {
    if (!text) return
    const last = out[out.length - 1]
    if (last && last.op === op) last.text += text
    else out.push({ op, text })
  }

  let i = 0
  while (i < segments.length) {
    if (segments[i].op === 'same') {
      push('same', segments[i].text)
      i++
      continue
    }

    let removed = ''
    let added = ''
    while (i < segments.length) {
      const seg = segments[i]
      if (seg.op === 'del') {
        removed += seg.text
        i++
        continue
      }
      if (seg.op === 'ins') {
        added += seg.text
        i++
        continue
      }
      // A run of changed words is nearly always stitched together by spaces
      // the LCS matched on both sides — "replacement cost" -> "actual cash
      // value" comes back as del|space|ins|del|space|ins. Treat a space
      // BETWEEN two changes as part of the region, or nothing ever groups.
      if (isSpace(seg.text) && segments[i + 1] && segments[i + 1].op !== 'same') {
        removed += seg.text
        added += seg.text
        i++
        continue
      }
      break
    }

    const leading = /^\s/.test(removed) || /^\s/.test(added)
    const trailing = /\s$/.test(removed) || /\s$/.test(added)
    const del = removed.replace(/\s+/g, ' ').trim()
    const ins = added.replace(/\s+/g, ' ').trim()
    if (!del && !ins) continue

    const prev = out[out.length - 1]
    if (leading && prev && !/\s$/.test(prev.text)) push('same', ' ')
    push('del', del)
    if (del && ins) push('same', ' ')
    push('ins', ins)
    if (trailing) push('same', ' ')
  }

  return out
}

/** True when the amendment actually changes wording (not just whitespace). */
export function hasRealChange(original: string, amended: string): boolean {
  return diffClause(original, amended).some((s) => s.op !== 'same' && !isSpace(s.text))
}

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

  // Whitespace that only moved is not a change worth showing in red. A
  // deleted or inserted run of pure whitespace, with unchanged text on both
  // sides, is re-wrapping — it reads as a phantom edit otherwise.
  return out
    .map((seg, idx) => {
      if (seg.op === 'same' || !isSpace(seg.text)) return seg
      const prev = out[idx - 1]
      const next = out[idx + 1]
      const isolated = (!prev || prev.op === 'same') && (!next || next.op === 'same')
      return isolated ? { op: 'same' as DiffOp, text: seg.text } : seg
    })
    .filter((seg) => seg.text.length > 0)
}

/** True when the amendment actually changes wording (not just whitespace). */
export function hasRealChange(original: string, amended: string): boolean {
  return diffClause(original, amended).some((s) => s.op !== 'same' && !isSpace(s.text))
}

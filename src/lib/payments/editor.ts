/**
 * Who may CHANGE SirReel's banking details.
 *
 * Wes, 2026-09-03 (after a call with Billing): "payment information
 * should not be changeable by anyone except Wes."
 *
 * Why this is an email allowlist and NOT `role === 'ADMIN'` — the
 * load-bearing reason, do not "simplify" it back:
 *
 *   ADMIN is held by BOTH wes@sirreel.com and dani@sirreel.com. The
 *   route guarded these writes with requireAdmin, which made Dani a
 *   second editor of the account and routing numbers every client
 *   wires to. That is exactly what the rule excludes. Changing this
 *   list takes a PR and a deploy, where a per-user column could be
 *   flipped by any future "edit user" form.
 *
 * Same shape and rationale as src/lib/exports/approver.ts, env override
 * included: PAYMENT_INFO_EDITOR_EMAILS ADDS to the base list (it never
 * replaces it), so Wes cannot lock himself out by setting it, and he can
 * delegate during a genuine absence without shipping code.
 *
 * READING is a separate, wider question and is NOT decided here — the
 * route still answers GET to any ADMIN.
 */

const PAYMENT_INFO_EDITORS_BASE: ReadonlyArray<string> = [
  'wes@sirreel.com',
]

function editorSet(): Set<string> {
  const set = new Set<string>(PAYMENT_INFO_EDITORS_BASE.map((e) => e.toLowerCase()))
  const envRaw = process.env.PAYMENT_INFO_EDITOR_EMAILS
  if (envRaw) {
    for (const e of envRaw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)) {
      set.add(e)
    }
  }
  return set
}

/** True only for the human(s) permitted to edit banking details. */
export function isPaymentInfoEditor(email: string | null | undefined): boolean {
  if (!email) return false
  return editorSet().has(email.toLowerCase())
}

/**
 * Approver addresses for NOTIFICATION only.
 *
 * Split from src/lib/exports/approver.ts on purpose: that module answers
 * "may this person release data?" and is security-critical. This one answers
 * "who should be told?" and is not. Keeping the authorization predicate free
 * of a mailing list means nobody can widen access by editing an email array.
 */

export const EXPORT_APPROVERS_DISPLAY: string[] = (
  process.env.EXPORT_APPROVER_EMAILS || 'wes@sirreel.com'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

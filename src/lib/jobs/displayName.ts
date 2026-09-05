/**
 * What to CALL a job on a client-facing surface.
 *
 * Origin (Wes, 2026-09-03): "A lot of the jobs being imported into HQ
 * have the name Planyo and some went to clients with that name."
 *
 * The Planyo cart importer minted `Planyo import — cart 5772289` when
 * the cart carried no `Job_Name` property, and that string is the
 * headline on the client paperwork portal — which reads
 * `Booking.jobName`, not `Job.name`. On 2026-09-02 a portal went to a
 * real client with that as the title of their production.
 *
 * Two separate defects fed it:
 *   1. The importer invented a fake name instead of recording that the
 *      job HAS no name yet. HQ already has a convention for that —
 *      empty string, see lib/scheduling/infoGaps — and a placeholder
 *      that looks like a real name defeats every "what's missing" check
 *      built on it.
 *   2. Renaming the job in HQ did not reach the client. `Job.name` and
 *      `Booking.jobName` are separate columns and nothing synced them,
 *      so the Supplying Demand portal still said "Planyo import — cart
 *      5772289" after a human had already renamed the job "Retirement".
 *
 * `Job.name` leads the precedence here because it is the field a human
 * edits in HQ — that is what makes a rename show up on the portal.
 *
 * A client never sees a cart id, and never sees a blank headline: an
 * unnamed job falls back to the production company, which is at least
 * true and recognizable to the person reading it.
 */

/** The exact shape the importer used to mint. Anchored so a real show
 *  called something like "Planyo import" (never seen, but the check is
 *  free) is not swallowed by the fallback. */
const PLACEHOLDER_RE = /^planyo import\s*[—–-]\s*cart\s*\d+$/i

/** "Music Video (TBD)", "TBD", "Untitled — TBD". Word-bounded so a real
 *  title that happens to contain those letters mid-word is untouched. */
const TBD_RE = /\bTBD\b/i

/** True for a value that is not actually a name: blank, the importer's
 *  invented cart placeholder, or a name the rep left as TBD (Wes
 *  2026-09-05: "treat TBD as unnamed" — it prompts for a real name before
 *  paperwork goes out, and client-facing surfaces fall through to the
 *  company rather than headline a show as "TBD"). */
export function isPlaceholderJobName(name: string | null | undefined): boolean {
  const t = (name ?? '').trim()
  return t === '' || PLACEHOLDER_RE.test(t) || TBD_RE.test(t)
}

export interface JobNameSources {
  /** `Job.name` — the field a human edits in HQ. Wins when it is real. */
  jobName?: string | null
  /** `Booking.jobName` — Planyo's `Job_Name` at import. */
  bookingJobName?: string | null
  /** `Company.name` — the last resort before a generic word. */
  companyName?: string | null
}

/**
 * The name to render. Returns the first source that is a real name;
 * falls back to the company, then to a generic noun so no surface ever
 * prints an empty heading.
 */
export function resolveDisplayJobName(src: JobNameSources): string {
  for (const candidate of [src.jobName, src.bookingJobName, src.companyName]) {
    const t = (candidate ?? '').trim()
    if (t && !isPlaceholderJobName(t)) return t
  }
  return 'Reservation'
}

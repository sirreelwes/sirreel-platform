// Unit N/A record titles. Title tags let the gantt N/A display distinguish a
// sales referral (pending fleet review) from a fleet-confirmed out-of-service
// record — there's no dedicated schema field. Kept in a lib module (not the
// route file) because Next.js route files may only export HTTP methods + route
// config; any other named export fails `next build`. Keep in lockstep with the
// /referral|pending fleet review/i classifier in timeline-native's naByAsset.
export const NA_REFERRAL_TITLE = "Unit N/A — sales referral (pending fleet review)";
export const NA_FLEET_TITLE = "Unit N/A — out of service (fleet)";

// Boilerplate the maintenance route prefixes onto a record's description so
// provenance (who greyed the unit) survives alongside the symptom. Kept here
// with the titles because the display side has to strip exactly what the
// write side prepends — see naSummary below.
export const NA_REFERRAL_BOILERPLATE =
  "Flagged by sales as needing maintenance review. Greys the unit pending fleet triage.";
export const NA_FLEET_BOILERPLATE = "Marked out of service by fleet.";

const BOILERPLATE = [NA_REFERRAL_BOILERPLATE, NA_FLEET_BOILERPLATE];
const NA_TITLES = [NA_REFERRAL_TITLE, NA_FLEET_TITLE];

/**
 * What is actually WRONG with the unit, in one line — the text the gantt
 * prints on the grey N/A bar (Wes, 2026-08-24: "the summary of the problem
 * should show in gantt chart").
 *
 * Three shapes of MaintenanceRecord reach this:
 *   1. Greyed from the gantt WITH a symptom → description is
 *      "<boilerplate> — driver-side mirror cracked". Strip the boilerplate,
 *      return the symptom.
 *   2. Greyed from the gantt BEFORE the symptom prompt shipped → description
 *      is boilerplate only, title is one of NA_TITLES. Nothing to say;
 *      returns null and the caller falls back to its generic wording.
 *   3. A real record from the maintenance module ("Brake job", "Oil change")
 *      → the title IS the summary; description may add detail.
 *
 * Returns null when there is genuinely nothing beyond the boilerplate, so
 * callers can keep their own default rather than print an empty string.
 */
export function naSummary(
  title: string | null | undefined,
  description: string | null | undefined,
): string | null {
  let d = (description ?? "").trim();
  for (const b of BOILERPLATE) {
    if (d === b) { d = ""; break; }
    if (d.startsWith(b)) {
      // The write side joins with " — "; tolerate any dash/whitespace run so
      // a hand-edited record still reads cleanly.
      d = d.slice(b.length).replace(/^[\s—–-]+/, "").trim();
      break;
    }
  }
  if (d) return d;
  const t = (title ?? "").trim();
  if (t && !NA_TITLES.includes(t)) return t;
  return null;
}

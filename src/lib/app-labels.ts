/**
 * Tenant-relabelable display strings.
 *
 * Single source of truth for UI labels that white-label tenants want
 * to change without touching the routes, internal identifiers, file
 * names, or storage layer.
 *
 * Rule of thumb for what belongs here:
 *   - It's user-visible text (nav, page header, breadcrumb, button).
 *   - A different tenant might call the same concept by a different
 *     name (e.g. SirReel's "Reservations" vs another shop's
 *     "Schedule" / "Bookings" / "Calendar").
 *   - The internal identifier — route path, file name, prop name,
 *     URL segment, database column — STAYS as it is.
 *
 * Do NOT put domain values here (status enums, role names, type
 * tags). Those are part of the data model, not the brand. Renaming
 * "BOOKED" to something else would break filters, not just labels.
 *
 * To re-label for a tenant, override these at module-load time
 * (e.g. via env or a tenant-config import that re-exports). Today
 * everything is hard-coded; the white-label switch lands when the
 * first tenant needs it.
 */

/** The operator-facing name for the global reservation overview —
 *  nav item + page header on /gantt and /calendar. Internal id stays
 *  `'schedule'`; the file path stays `src/app/(dashboard)/gantt/...`;
 *  only the display label here changes per tenant. */
export const SCHEDULE_LABEL = 'Reservations'

/**
 * /claims top-level redirector. The nav entry renamed Claims →
 * Incidents in STEP 4 of the Incidents build, and the unified list
 * lives at /incidents. The Claims tab is reachable from there via
 * the in-page view switcher; legacy bookmarks to /claims land on
 * that tab so no link breaks.
 *
 * /claims/[id] (the existing claim detail page) is unchanged — only
 * the top-level list page redirects.
 */

import { redirect } from 'next/navigation'

export default function ClaimsRedirect() {
  redirect('/incidents?view=claims')
}

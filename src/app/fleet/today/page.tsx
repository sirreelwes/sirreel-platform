/**
 * /fleet/today — retired 2026-09-02, kept as a redirect.
 *
 * The trucks-only board merged into /yard, which shows vehicles AND
 * pick lists grouped by show. This route stays because it is bookmarked
 * on crew phones and linked from the fleet-readiness digest; the
 * redirect is permanent in intent but temporary in HTTP so a future
 * move isn't cached into every browser in the yard.
 */

import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default function FleetTodayPage() {
  redirect('/yard')
}

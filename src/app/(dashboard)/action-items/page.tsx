/**
 * /action-items → /jobs (2026-08-27, Wes: "fold Action Items into the
 * Jobs page. No need for a separate page").
 *
 * The list itself is ActionItemsPanel, rendered on the /jobs landing
 * under the Today strip. Redirect kept for bookmarks and notification
 * links.
 */
import { redirect } from 'next/navigation'

export default function ActionItemsRedirect() {
  redirect('/jobs')
}

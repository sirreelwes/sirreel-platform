/**
 * /inquiries → /jobs (2026-08-27, Wes: "combine the jobs and inquiries
 * pages … one stop shop for jobs — incoming, active and wrapped").
 *
 * The whole workspace this page carried — NewInboundColumn, QuotesOut,
 * reservations widget, signals strip, the scope toggle — moved intact to
 * the /jobs landing panel, where the left rail holds the active and
 * wrapped book. Same consolidation move /sales/pipeline → /inquiries was
 * in 2026-08-21; this is the second and final hop.
 *
 * The redirect stays (rather than deleting the route) because the queue
 * is linked from notification emails and muscle memory. /inquiries/[id]
 * remains a real page — inquiry deep links keep working.
 */
import { redirect } from 'next/navigation'

export default function InquiriesRedirect() {
  redirect('/jobs')
}

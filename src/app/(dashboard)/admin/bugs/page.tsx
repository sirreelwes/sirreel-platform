/**
 * /admin/bugs → /admin/improvements.
 *
 * The board was called Reported Issues for a day and escalation emails
 * already went out carrying /admin/bugs?id=… links. Those links must keep
 * working; a dead link in a mail telling Wes something is blocking is the
 * worst possible one to break.
 */
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default function LegacyBugsRedirect({
  searchParams,
}: {
  searchParams: { id?: string }
}) {
  redirect(searchParams.id ? `/admin/improvements?id=${searchParams.id}` : '/admin/improvements')
}

import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { defaultLandingPath } from '@/lib/permissions';
import type { UserRole } from '@prisma/client';

/**
 * The root routes by ROLE, server-side.
 *
 * Wes, 2026-08-31: "whenever you click back to hq.sirreel.com … it
 * should always go to Jobs if anything."
 *
 * This used to be a hardcoded `redirect('/dashboard')` for everyone,
 * with the dashboard LAYOUT then bouncing sales, yard and billing roles
 * onward with a client-side router.replace. So those users loaded a
 * page that was not theirs, rendered it, and got moved — a visible flash
 * on every launch, and the manifest's start_url ("/" — the role router")
 * describing behaviour that lived somewhere else entirely.
 *
 * Deciding it here means one hop, no flash, and one place that answers
 * "where does this person start". The layout's bounces stay as a
 * backstop for anyone who navigates to /dashboard directly.
 *
 * Signed out, `redirect` still lands on /login through the usual guard.
 */
export default async function Home() {
  const session = await getServerSession(authOptions);
  const role = (session?.user as { role?: UserRole } | undefined)?.role;
  redirect(role ? defaultLandingPath(role) : '/dashboard');
}

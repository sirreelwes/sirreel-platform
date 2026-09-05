/**
 * /guides — HQ Help: every how-to page, grouped by department, filtered
 * to what this person's role is for.
 *
 * Wes 2026-09-05: "fold each department's instruction pages into a HQ
 * Help tab for them." One nav entry replaces the five scattered "How
 * to…" links; the registry (src/lib/guides/registry.ts) decides what each
 * role sees, so adding a guide is one line there, not a nav edit per
 * branch.
 */

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { ArrowRight, BookOpen } from 'lucide-react'
import { UserRole } from '@prisma/client'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { guidesFor } from '@/lib/guides/registry'

export const dynamic = 'force-dynamic'

const DEPARTMENT_BLURB: Record<string, string> = {
  Sales: 'Starting, sending and finishing a job.',
  Yard: 'Pull sheets, check-out and check-in.',
  Billing: 'Invoices, payments and the collections desk.',
}

export default async function HqHelpPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) redirect('/login')
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { role: true },
  })
  const groups = guidesFor(user?.role ?? UserRole.AGENT)

  return (
    <div className="max-w-[900px] mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-lt-fg">HQ Help</h1>
        <p className="text-sm text-lt-fg2 mt-1 max-w-[70ch]">
          Plain-English instructions for the work in HQ, by department. Each one is short enough to
          read while you do the thing.
        </p>
      </div>

      {groups.length === 0 ? (
        <div className="bg-lt-card border border-lt-hairline rounded-xl p-8 text-center">
          <BookOpen className="w-6 h-6 text-lt-fg3 mx-auto mb-2" />
          <p className="text-sm text-lt-fg2">No guides are written for your role yet.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {groups.map((g) => (
            <section key={g.department}>
              <div className="flex items-baseline gap-3 mb-3">
                <h2 className="text-[11px] uppercase font-semibold tracking-[1.6px] text-lt-fg3">
                  {g.department}
                </h2>
                <span className="text-xs text-lt-fg3">{DEPARTMENT_BLURB[g.department]}</span>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                {g.guides.map((guide) => (
                  <Link
                    key={guide.slug}
                    href={`/guides/${guide.slug}`}
                    className="group block bg-lt-card border border-lt-hairline rounded-xl p-4 hover:border-lt-fg3 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <BookOpen className="w-4 h-4 text-lt-fg3 shrink-0" />
                          <span className="text-[15px] font-semibold text-lt-fg">{guide.title}</span>
                        </div>
                        <p className="text-sm text-lt-fg2 mt-1.5 leading-relaxed">{guide.summary}</p>
                      </div>
                      <ArrowRight className="w-4 h-4 text-lt-fg3 group-hover:text-lt-fg shrink-0 mt-1" />
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

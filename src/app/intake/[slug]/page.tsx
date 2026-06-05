import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { IntakeForm } from '@/components/intake/IntakeForm'

/**
 * Agent-attributed public intake page (/intake/<slug>). Resolves the
 * URL slug to a User row server-side — if it matches an active
 * AGENT, the visitor is greeted with that agent's name and the slug
 * is passed through to the form so the submit endpoint can stamp
 * Inquiry.assignedToId.
 *
 * An unknown / inactive / non-AGENT slug falls back to the generic
 * copy (still functional, just unattributed). This keeps stale links
 * working — a former agent's URL still submits successfully to the
 * triage queue rather than 404'ing the visitor.
 *
 * No auth shell — lives outside (dashboard) per the public surface
 * convention.
 */

export const metadata: Metadata = {
  title: 'SirReel · Get a quote',
  description: 'Tell us about your production — name, phone, email, job.',
}

// Next 15 typegen wants this Promise-of-params shape; matches the
// /api/crm/people/[id] etc patterns already in the repo.
type PageProps = { params: Promise<{ slug: string }> }

export default async function AgentIntakePage({ params }: PageProps) {
  const { slug } = await params
  // Sales-rep only: intake links are a sales tool. Accounting agents
  // (salesOnly=false, e.g. Ana) don't get attribution — a stale slug
  // for a non-sales user falls back to the generic copy.
  const agent = await prisma.user.findFirst({
    where: { publicSlug: slug, isActive: true, role: 'AGENT', salesOnly: true },
    select: { name: true, publicSlug: true },
  })

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
        <header className="mb-5">
          <h1 className="text-xl font-semibold text-gray-900">Get a quote</h1>
          <p className="text-sm text-gray-500 mt-1">
            {agent
              ? `${agent.name} will follow up shortly.`
              : 'A SirReel agent will follow up shortly.'}
          </p>
        </header>
        <IntakeForm
          agentName={agent?.name ?? null}
          agentSlug={agent?.publicSlug ?? slug}
        />
      </div>
    </main>
  )
}

import type { Metadata } from 'next'
import { IntakeForm } from '@/components/intake/IntakeForm'

/**
 * Generic public intake page. No agent attribution — submissions land
 * as Inquiry(WEB_FORM, NEW) with assignedToId=null and triage assigns
 * a rep. Lives OUTSIDE the (dashboard) route group so the auth shell
 * doesn't gate this surface.
 *
 * The agent-attributed variant lives at /intake/[slug] — same form,
 * resolves the slug server-side to greet the visitor with the
 * agent's name.
 */

export const metadata: Metadata = {
  title: 'SirReel · Get a quote',
  description: 'Tell us about your production — name, phone, email, job. A SirReel agent will follow up.',
}

export default function PublicIntakePage() {
  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
        <header className="mb-5">
          <h1 className="text-xl font-semibold text-gray-900">Get a quote</h1>
          <p className="text-sm text-gray-500 mt-1">
            A SirReel agent will follow up shortly.
          </p>
        </header>
        <IntakeForm />
      </div>
    </main>
  )
}

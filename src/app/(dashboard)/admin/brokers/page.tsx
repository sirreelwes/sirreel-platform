import { listBrokers } from '@/lib/coi/brokerDirectory'
import { BrokerDirectory } from '@/components/coi/BrokerDirectory'

export const dynamic = 'force-dynamic'

/**
 * /admin/brokers — the list of insurance brokers (Wes 2026-09-17: "Please
 * start keeping a list of brokers").
 *
 * Mostly it fills itself: every certificate we review records the broker its
 * PRODUCER box names, and every review link we send records who we wrote to
 * (src/lib/coi/brokerDirectory.ts). This page is where you read it, correct
 * it, and add the ones we knew before the code did.
 *
 * Light shell, `lt-*` tokens — the dashboard content area is cream
 * (CLAUDE.md UI conventions). The COI review modal is the one dark surface
 * in this area and it paints its own background.
 */
export default async function BrokersPage() {
  const { brokers, missingTables } = await listBrokers({ includeInactive: true })

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-lt-fg">Brokers</h1>
        <p className="text-sm text-lt-fg2 mt-0.5">
          The insurance brokers behind our clients&rsquo; certificates. Filled automatically from every
          certificate we review and every review link we send &mdash; add one here when you know it first.
        </p>
      </div>

      {missingTables ? (
        <div className="rounded-lg border border-chip-warn-bg bg-chip-warn-bg px-4 py-3 text-sm text-chip-warn-fg">
          <p className="font-semibold">The broker directory isn&rsquo;t in the database yet.</p>
          <p className="mt-1">
            Run <span className="font-semibold">&ldquo;Create the broker directory tables&rdquo;</span> on{' '}
            <a href="/admin/maintenance" className="underline font-semibold">
              Run a Task
            </a>
            , then <span className="font-semibold">&ldquo;File the brokers we already know&rdquo;</span>. Nothing
            else is affected until then &mdash; COI review works exactly as it does today.
          </p>
        </div>
      ) : (
        <BrokerDirectory initial={brokers} />
      )}
    </div>
  )
}

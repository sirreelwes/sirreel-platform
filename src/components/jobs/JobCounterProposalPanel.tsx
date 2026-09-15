'use client'

/**
 * Counter-proposal card on the Job page.
 *
 * Wes 2026-09-15: once the clauses are decided and the counter-PDF is
 * generated, "that PDF is not easily placed in the portal nor is it easy to
 * reply to the client … it should be sent to the portal — the job portal as
 * well as our agent's job detail portal — and in the portal we can also
 * choose to send to the client."
 *
 * Generating the PDF posts it: the client's job portal shows it under
 * Paperwork from that moment, and this card shows it here. "Send to client"
 * is the job page's own composer, opened pre-written with the cover note,
 * addressed and CC'd off the job's email thread, with the PDF attached. It
 * never sends on its own. Renders nothing on a job with no counter-proposal.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { ExternalLink, FileText } from 'lucide-react'
import { JobEmailButton } from '@/components/jobs/JobEmailButton'

interface Counter {
  reviewId: string
  generatedAt: string | null
  generatedBy: string | null
  counts: { accept: number; counter: number; reject: number }
  agreement: { status: string; orderNumber: string | null } | null
  lastSent: { at: string; to: string | null; by: string | null; beforeRegenerate: boolean } | null
  preset: { subject: string; body: string }
}

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

export function JobCounterProposalPanel({
  jobId,
  reviewId,
  fallback,
}: {
  jobId: string
  /** On the review desk: render only when THIS review is the job's current
   *  counter-proposal, so the card never offers to send a different one. */
  reviewId?: string
  /** Shown instead once loaded, when there is nothing to post here. */
  fallback?: ReactNode
}) {
  const [counter, setCounter] = useState<Counter | null>(null)
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/jobs/${jobId}/counter-proposal`)
      const j = await r.json()
      setCounter(r.ok ? (j.counter ?? null) : null)
    } catch {
      setCounter(null)
    } finally {
      setLoaded(true)
    }
  }, [jobId])

  useEffect(() => {
    void load()
  }, [load])

  if (!counter || (reviewId && counter.reviewId !== reviewId)) return loaded ? <>{fallback ?? null}</> : null

  const negotiatedOut =
    counter.agreement?.status === 'NEGOTIATED_READY' || counter.agreement?.status === 'SIGNED_NEGOTIATED'
  const { accept, counter: countered, reject } = counter.counts

  return (
    <div
      id="counter-proposal"
      className="scroll-mt-4 bg-gradient-to-b from-white to-zinc-50 border border-zinc-200 rounded-2xl p-4 transition-colors duration-200 hover:border-zinc-400"
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-zinc-900 flex items-center gap-2.5 before:content-[''] before:w-1 before:h-4 before:rounded-full before:bg-amber-500/80">
            Counter-proposal
          </h2>
          <p className="mt-1 text-[13px] text-zinc-600">
            Our answer to the client&rsquo;s redline — {accept} accepted · {countered} countered · {reject} kept as written.
          </p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {counter.generatedAt ? `Generated ${fmtWhen(counter.generatedAt)}` : 'Generated'}
            {counter.generatedBy ? ` by ${counter.generatedBy}` : ''}
            {negotiatedOut
              ? ' · the negotiated agreement is out to sign, so the portal now shows that instead.'
              : ' · on the client’s job portal under Paperwork.'}
          </p>
          <p className={`mt-0.5 text-xs ${counter.lastSent?.beforeRegenerate ? 'text-chip-warn-fg' : 'text-zinc-500'}`}>
            {counter.lastSent
              ? `Emailed to ${counter.lastSent.to ?? 'the client'} ${fmtWhen(counter.lastSent.at)}${counter.lastSent.by ? ` by ${counter.lastSent.by}` : ''}${
                  counter.lastSent.beforeRegenerate ? ' — before the latest regenerate, so they have an older copy.' : '.'
                }`
              : 'Not emailed to the client yet.'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <a
            href={`/api/tools/contract-review/${counter.reviewId}/counter-pdf`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-lt-hairline px-3 py-1.5 text-xs font-semibold text-lt-fg2 hover:text-lt-fg hover:border-lt-fg3"
          >
            <FileText className="w-3.5 h-3.5" /> View PDF
          </a>
          {reviewId ? (
            <Link
              href={`/jobs/${jobId}#counter-proposal`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-lt-hairline px-3 py-1.5 text-xs font-semibold text-lt-fg2 hover:text-lt-fg hover:border-lt-fg3"
            >
              <ExternalLink className="w-3.5 h-3.5" /> Job page
            </Link>
          ) : (
            <Link
              href={`/tools/contract-review/${counter.reviewId}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-lt-hairline px-3 py-1.5 text-xs font-semibold text-lt-fg2 hover:text-lt-fg hover:border-lt-fg3"
            >
              <ExternalLink className="w-3.5 h-3.5" /> Open review
            </Link>
          )}
          <JobEmailButton
            jobId={jobId}
            label={counter.lastSent ? 'Send again' : 'Send to client'}
            onSent={() => void load()}
            buttonClassName="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white"
            preset={{
              title: 'Send the counter-proposal',
              subject: counter.preset.subject,
              body: counter.preset.body,
              counterReviewId: counter.reviewId,
              attachmentLabel: 'The counter-proposal PDF is attached — the same copy that is on their job portal.',
            }}
          />
        </div>
      </div>
    </div>
  )
}

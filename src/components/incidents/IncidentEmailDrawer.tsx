'use client'

/**
 * IncidentEmailDrawer — single-email side drawer for the incident
 * workspace. Renders ONE EmailMessage at a time (not the surrounding
 * Gmail thread). The detail page's email-summary row drives `emailId`
 * and the drawer lazily fetches body via GET /api/incidents/email/[id].
 *
 * Layout:
 *   - Header: subject + from/to/date + "Open in Gmail ↗"
 *   - Parse summary card: carrier / claim# / adjuster / loss desc /
 *     money fields / statusGuess (driven by the ClaimMail.parse the
 *     parent already has — passed via props, no extra fetch).
 *   - EmailBody (HTML/Text toggle, sandboxed iframe — REUSE).
 *   - Attachments link (count + jump to documents section).
 *
 * Gmail deep-link precedence: gmailMessageId → rfc822MessageId
 * search → hide.
 */

import { useEffect, useState } from 'react'

import { EmailBody } from '@/components/email/EmailBody'

interface ParseShape {
  clientCompanyName: string | null
  carrierName: string | null
  carrierClaimNumber: string | null
  policyNumber: string | null
  adjusterName: string | null
  adjusterEmail: string | null
  adjusterPhone: string | null
  lossDescription: string | null
  dateOfLoss: string | null
  lossAmount: number | null
  acvReceived: number | null
  depreciationApplied: number | null
  deductibleAmount: number | null
  totalDemand: number | null
  amountOffered: number | null
  amountSettled: number | null
  statusGuess: string | null
}

interface EmailDetail {
  id: string
  gmailMessageId: string
  rfc822MessageId: string | null
  threadId: string | null
  fromAddress: string
  toAddresses: string[]
  subject: string
  snippet: string | null
  bodyText: string | null
  bodyHtml: string | null
  bodySource: string | null
  attachmentCount: number
  direction: string
  sentAt: string
  emailAccount: { emailAddress: string } | null
}

export interface IncidentEmailDrawerProps {
  /** EmailMessage.id — drives the lazy body fetch. null closes the drawer. */
  emailId: string | null
  /** Parse JSON from the parent's ClaimMail row — already fetched, no
   *  second call needed. */
  parse: Record<string, unknown> | null
  /** Cached inbox from ClaimMail.inbox if present. The drawer also
   *  reads emailAccount.emailAddress from its own fetch as a fallback. */
  inbox: string | null
  onClose: () => void
}

function fmtAbsolute(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

function fmtMoney(n: number | null | undefined): string | null {
  if (n == null) return null
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
}

function buildGmailLink(args: {
  inbox: string | null
  gmailMessageId: string | null | undefined
  rfc822MessageId: string | null | undefined
}): string | null {
  const inbox = args.inbox
  if (!inbox) return null
  if (args.gmailMessageId) {
    return `https://mail.google.com/mail/u/${encodeURIComponent(inbox)}/#all/${encodeURIComponent(args.gmailMessageId)}`
  }
  if (args.rfc822MessageId) {
    return `https://mail.google.com/mail/u/${encodeURIComponent(inbox)}/#search/rfc822msgid:${encodeURIComponent(args.rfc822MessageId)}`
  }
  return null
}

export function IncidentEmailDrawer({
  emailId, parse, inbox, onClose,
}: IncidentEmailDrawerProps) {
  const [email, setEmail] = useState<EmailDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!emailId) {
      setEmail(null)
      return
    }
    setLoading(true)
    setError(null)
    setEmail(null)
    fetch(`/api/incidents/email/${emailId}`, { cache: 'no-store' })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}))
        if (!r.ok) {
          if (!cancelled) setError(j?.error || `HTTP ${r.status}`)
          return
        }
        if (!cancelled) setEmail(j.email as EmailDetail)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'fetch failed')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [emailId])

  if (!emailId) return null

  // Esc-to-close: scoped to this component's mount so we don't conflict
  // with other open drawers (none today; defensive).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const p = parse as (ParseShape | null)
  const gmailHref = buildGmailLink({
    inbox: inbox ?? email?.emailAccount?.emailAddress ?? null,
    gmailMessageId: email?.gmailMessageId,
    rfc822MessageId: email?.rfc822MessageId,
  })

  // Parse-summary pills — render only the non-null fields so we don't
  // get a row of "—" dashes for sparse parses.
  const moneyEntries: Array<[label: string, value: string]> = []
  if (p) {
    const push = (label: string, v: number | null | undefined) => {
      const f = fmtMoney(v ?? null)
      if (f) moneyEntries.push([label, f])
    }
    push('Loss amount', p.lossAmount)
    push('Total demand', p.totalDemand)
    push('Amount offered', p.amountOffered)
    push('Amount settled', p.amountSettled)
    push('ACV received', p.acvReceived)
    push('Deductible', p.deductibleAmount)
  }

  return (
    <div className="fixed inset-0 z-50 flex" aria-modal="true" role="dialog">
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close email drawer"
        className="flex-1 bg-black/30"
        onClick={onClose}
      />
      {/* Panel — sits on the right, fixed width */}
      <div className="w-[640px] max-w-[100vw] bg-white border-l border-lt-hairline overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-lt-hairline px-5 py-4 z-10">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[10px] uppercase tracking-wider text-lt-fg3 font-semibold">
                Incident email
              </div>
              <h2 className="text-base font-semibold text-lt-fg mt-0.5 break-words">
                {email?.subject || (loading ? 'Loading…' : '—')}
              </h2>
              {email && (
                <div className="text-[11px] text-lt-fg3 mt-1 break-words">
                  <span className="text-lt-fg2">from</span>{' '}
                  <span className="font-mono">{email.fromAddress}</span>
                  {' · '}
                  {fmtAbsolute(email.sentAt)}
                </div>
              )}
              {email && email.toAddresses.length > 0 && (
                <div className="text-[11px] text-lt-fg3 mt-0.5 break-words">
                  <span className="text-lt-fg2">to</span>{' '}
                  <span className="font-mono">{email.toAddresses.join(', ')}</span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {gmailHref && (
                <a
                  href={gmailHref}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-xs font-semibold px-2.5 py-1 rounded border border-lt-fg/30 bg-lt-card hover:bg-lt-fg hover:text-white text-lt-fg transition-colors"
                  title="Open this message in Gmail (new tab)"
                >
                  Open in Gmail ↗
                </a>
              )}
              <button
                type="button"
                onClick={onClose}
                className="text-lt-fg3 hover:text-lt-fg text-xl leading-none"
                aria-label="Close"
              >
                ×
              </button>
            </div>
          </div>
        </div>

        <div className="px-5 py-4 space-y-4">
          {error && (
            <div className="text-xs text-chip-bad-fg bg-chip-bad-bg/30 rounded px-3 py-2">
              {error}
            </div>
          )}

          {/* Parse-summary card */}
          {p && (
            <div className="bg-lt-inner/30 border border-lt-hairline rounded-lg p-4 space-y-2">
              <div className="text-[10px] uppercase tracking-wider text-lt-fg3 font-semibold">
                AI parse summary
              </div>
              <div className="flex flex-wrap gap-1.5">
                {p.carrierName && (
                  <Pill label="Carrier" value={p.carrierName} />
                )}
                {p.carrierClaimNumber && (
                  <Pill label="Claim #" value={p.carrierClaimNumber} mono />
                )}
                {p.policyNumber && (
                  <Pill label="Policy #" value={p.policyNumber} mono />
                )}
                {p.adjusterName && (
                  <Pill label="Adjuster" value={p.adjusterName} />
                )}
                {p.statusGuess && (
                  <Pill label="Status" value={p.statusGuess} />
                )}
                {p.dateOfLoss && (
                  <Pill label="Loss date" value={p.dateOfLoss} mono />
                )}
              </div>
              {p.lossDescription && (
                <div className="text-xs text-lt-fg leading-relaxed">
                  {p.lossDescription}
                </div>
              )}
              {(p.adjusterEmail || p.adjusterPhone) && (
                <div className="text-[11px] text-lt-fg2">
                  {p.adjusterEmail && (
                    <a href={`mailto:${p.adjusterEmail}`} className="text-lt-fg hover:underline mr-3">
                      {p.adjusterEmail}
                    </a>
                  )}
                  {p.adjusterPhone && (
                    <a href={`tel:${p.adjusterPhone}`} className="text-lt-fg hover:underline">
                      {p.adjusterPhone}
                    </a>
                  )}
                </div>
              )}
              {moneyEntries.length > 0 && (
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] pt-1 border-t border-lt-hairline/60">
                  {moneyEntries.map(([label, v]) => (
                    <div key={label} className="flex justify-between">
                      <span className="text-lt-fg3">{label}</span>
                      <span className="text-lt-fg font-mono">{v}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Body */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-lt-fg3 font-semibold mb-1.5">
              Body
            </div>
            {loading ? (
              <div className="text-xs text-lt-fg3 italic px-3 py-6 text-center">Loading body…</div>
            ) : email ? (
              <EmailBody
                bodyText={email.bodyText}
                bodyHtml={email.bodyHtml}
                snippet={email.snippet}
                height={420}
                iframeLabel={`Email ${email.subject}`}
              />
            ) : null}
          </div>

          {/* Attachments hint */}
          {email && email.attachmentCount > 0 && (
            <div className="text-[11px] text-lt-fg2 italic border-t border-lt-hairline/60 pt-3">
              {email.attachmentCount} attachment{email.attachmentCount === 1 ? '' : 's'}{' '}
              persisted to this incident — see the Documents section on the page.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Pill({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] bg-lt-card border border-lt-hairline rounded px-1.5 py-0.5">
      <span className="text-lt-fg3 uppercase tracking-wider font-semibold">{label}</span>
      <span className={`text-lt-fg ${mono ? 'font-mono' : ''}`}>{value}</span>
    </span>
  )
}

'use client'

/**
 * SourceMailPanel — read the mail this contact came from, and set their
 * role from what you read.
 *
 * Wes, 2026-08-26: "it would be great to be able to look at the emails
 * that extracted a contact so that I can discern role, etc."
 *
 * The point of the panel is the last three words. Reading is only half
 * of it — the role selector sits at the TOP of the panel, not buried in
 * the separate Edit form, so the loop is: open contact → read email →
 * set role → done, without ever leaving the page or losing the sentence
 * you just read.
 *
 * Each message shows what the capture pipeline made of it: the parsed
 * title/company/project, and `verdictReason`, which is the pipeline
 * explaining itself. On Emmett Tekstra that string said
 * "production_title:art director" while his role said OTHER — seeing
 * those two next to each other is how the whole bug got found, so it is
 * rendered prominently rather than tucked into a tooltip.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  PERSON_ROLE_VALUES,
  PERSON_ROLE_LABELS,
  type PersonRoleValue,
} from '@/lib/crm/roleMapping'

interface CaptureInfo {
  verdict: string
  verdictReason: string
  resolution: string
  inbox: string
  parsedTitle: string | null
  parsedCompanyString: string | null
  parsedProject: string | null
  parsedPhone: string | null
}

interface SourceMessage {
  id: string
  subject: string
  sentAt: string
  fromAddress: string
  toAddresses: string[]
  cc: string | null
  inbox: string
  body: string
  truncated: boolean
  hasBody: boolean
  capture: CaptureInfo | null
}

interface Payload {
  currentRole: string
  rawTitle: string | null
  captureCount: number
  orphanCaptures: number
  messages: SourceMessage[]
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

export function SourceMailPanel({
  personId,
  personName,
  currentRole,
  onRoleSaved,
}: {
  personId: string
  personName: string
  currentRole: string
  onRoleSaved: (role: string) => void
}) {
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [openIds, setOpenIds] = useState<Set<string>>(new Set())
  const [role, setRole] = useState(currentRole)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => { setRole(currentRole) }, [currentRole])

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const res = await fetch(`/api/crm/people/${personId}/source-emails`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as Payload
      setData(json)
      // Open the newest message by default — with one message the
      // panel should just show it, not make you click again.
      if (json.messages.length > 0) setOpenIds(new Set([json.messages[0].id]))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed to load')
    } finally {
      setLoading(false)
    }
  }, [personId])

  useEffect(() => { load() }, [load])

  const toggle = (id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const saveRole = async (next: string) => {
    setRole(next)
    setSaving(true)
    setSaved(false)
    try {
      const res = await fetch(`/api/crm/people/${personId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: next }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      onRoleSaved(next)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed to save role')
      setRole(currentRole)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-lt-card border border-lt-hairline rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-lt-hairline flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-lt-fg">Source mail</h2>
          <p className="text-xs text-lt-fg3 mt-0.5">
            {loading
              ? 'Loading…'
              : data
                ? `${data.messages.length} message${data.messages.length === 1 ? '' : 's'} on file`
                  + (data.captureCount > 0 ? ` · ${data.captureCount} capture${data.captureCount === 1 ? '' : 's'}` : '')
                  + (data.orphanCaptures > 0 ? ` · ${data.orphanCaptures} capture record${data.orphanCaptures === 1 ? '' : 's'} whose email is no longer stored` : '')
                : ''}
          </p>
        </div>

        {/* Set the role from what you just read. Deliberately here and
            not in the Edit form — the whole point is to decide while
            the email is in front of you. */}
        <div className="flex items-center gap-2">
          <label htmlFor="role-from-mail" className="text-xs text-lt-fg3">Role</label>
          <select
            id="role-from-mail"
            value={role}
            disabled={saving}
            onChange={(e) => saveRole(e.target.value)}
            className="px-2 py-1.5 bg-lt-inner border border-lt-hairline rounded-lg text-xs text-lt-fg disabled:opacity-60"
          >
            {PERSON_ROLE_VALUES.map((r: PersonRoleValue) => (
              <option key={r} value={r}>{PERSON_ROLE_LABELS[r]}</option>
            ))}
          </select>
          {saving && <span className="text-xs text-lt-fg3">Saving…</span>}
          {saved && <span className="text-xs text-chip-good-fg">Saved</span>}
        </div>
      </div>

      {err && (
        <div className="px-4 py-3 text-xs text-chip-bad-fg border-b border-lt-hairline">
          {err}{' '}
          <button onClick={load} className="underline hover:opacity-70">Retry</button>
        </div>
      )}

      {!loading && data && data.messages.length === 0 && (
        <div className="px-4 py-8 text-center text-sm text-lt-fg3">
          No mail on file for {personName}.
          <div className="text-xs mt-1">
            Contacts harvested from a CC line have no message of their own —
            their role has to come from you, or from the next email they send.
          </div>
        </div>
      )}

      <div className="divide-y divide-lt-hairline/60">
        {data?.messages.map((m) => {
          const open = openIds.has(m.id)
          return (
            <div key={m.id}>
              <button
                type="button"
                onClick={() => toggle(m.id)}
                aria-expanded={open}
                className="w-full text-left px-4 py-3 hover:bg-lt-inner/50 transition-colors"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm text-lt-fg font-medium truncate">{m.subject || '(no subject)'}</span>
                  <span className="text-xs text-lt-fg3 shrink-0 font-mono">{fmtDate(m.sentAt)}</span>
                </div>
                <div className="text-xs text-lt-fg3 mt-1 truncate">
                  {m.fromAddress} → {m.inbox}
                  {m.cc && <span className="text-lt-fg3"> · cc {m.cc}</span>}
                </div>

                {/* What the pipeline extracted from THIS message. */}
                {m.capture && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {m.capture.parsedTitle && (
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-chip-warn-bg text-chip-warn-fg">
                        title: {m.capture.parsedTitle}
                      </span>
                    )}
                    {m.capture.parsedCompanyString && (
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-lt-inner text-lt-fg2">
                        company: {m.capture.parsedCompanyString}
                      </span>
                    )}
                    {m.capture.parsedProject && (
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-lt-inner text-lt-fg2">
                        project: {m.capture.parsedProject}
                      </span>
                    )}
                    <span className="text-[11px] px-1.5 py-0.5 rounded bg-lt-inner text-lt-fg3">
                      {m.capture.verdict}
                    </span>
                  </div>
                )}
              </button>

              {open && (
                <div className="px-4 pb-4">
                  {m.capture?.verdictReason && (
                    <p className="text-[11px] text-lt-fg3 mb-2 font-mono break-words">
                      why it was captured: {m.capture.verdictReason}
                    </p>
                  )}
                  {m.hasBody ? (
                    <pre className="text-xs text-lt-fg2 whitespace-pre-wrap break-words bg-lt-inner rounded-lg p-3 max-h-[28rem] overflow-y-auto font-sans">
                      {m.body}
                    </pre>
                  ) : (
                    <p className="text-xs text-lt-fg3 italic bg-lt-inner rounded-lg p-3">
                      Only a preview snippet was stored for this message, not the full body.
                      {m.body ? ` — “${m.body}”` : ''}
                    </p>
                  )}
                  {m.truncated && (
                    <p className="text-[11px] text-lt-fg3 mt-1">
                      Long message — the middle was trimmed. The start and the signature block are both shown.
                    </p>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

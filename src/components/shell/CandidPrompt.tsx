'use client'

/**
 * CandidPrompt — the "take this week's candid" nudge, in the staff shell.
 *
 * Wes 2026-09-16: "prompt a candid to be taken somewhere prominent." The
 * WeeklyCandidWidget has always been on the dashboard, but mid-page and only
 * on the page nobody stays on. This sits at the top of the content area on
 * EVERY page, right under the role-preview banner, which is the one slot in
 * this shell already proven to be unmissable.
 *
 * It is quiet by design:
 *   - only when the candid has somewhere to GO for this viewer, which the
 *     server decides (`candidUse.wanted`): a client-facing role AND the
 *     thank-you actually open to them. Since the welcome email's rep card
 *     switched to the published "Who we are" photo (Wes 2026-09-16), the
 *     thank-you is the candid's only destination — and while that is held
 *     behind the rollout switch, only a tester sees this. Nagging the team
 *     for a photo with nowhere to go is asking them to pose for an audience
 *     that does not exist.
 *   - only when the candid is missing or from a previous week
 *   - dismissable, and the dismissal holds while the shell stays mounted,
 *     which covers a whole working session of navigating around HQ
 *
 * Dismissal is component state, NOT localStorage — banned by CLAUDE.md, and
 * an override that survives a reload is exactly the kind of thing that went
 * unnoticed for days the last time.
 *
 * Light shell: lt-* / chip-* tokens, never raw zinc (CLAUDE.md).
 */

import { useCallback, useEffect, useRef, useState } from 'react'

interface Resp {
  current: { fileUrl: string; capturedAt: string } | null
  isThisWeek: boolean
  ageDays: number | null
  candidUse?: {
    wanted: boolean
    destination: string
  }
}

export function CandidPrompt() {
  const [resp, setResp] = useState<Resp | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/users/me/weekly-candid')
      if (!r.ok) return
      setResp((await r.json()) as Resp)
    } catch {
      /* a nudge must never break the shell */
    }
  }, [])

  useEffect(() => { load() }, [load])

  const upload = async (file: File) => {
    setUploading(true)
    setErr(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const r = await fetch('/api/users/me/weekly-candid', { method: 'POST', body: fd })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        setErr(d?.error || `Upload failed (${r.status})`)
        return
      }
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  if (!resp || dismissed) return null
  if (!resp.candidUse?.wanted) return null
  if (resp.current && resp.isThisWeek) return null

  const age = resp.ageDays
  const headline = resp.current
    ? `Your candid is ${age ?? '?'} days old`
    : "You don't have a candid yet"

  // Where it actually goes. The welcome email uses your Who-we-are photo;
  // this one is for the thank-you a client gets after their job wraps.
  const destination = 'It goes on the thank-you a client gets after their job wraps.'

  return (
    <div className="mb-3 rounded-lg border border-lt-hairline bg-lt-card px-3 py-2.5">
      <div className="flex items-center gap-3 flex-wrap">
        {resp.current ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={resp.current.fileUrl}
            alt=""
            className="h-10 w-10 rounded-md object-cover border border-lt-hairline flex-none"
          />
        ) : (
          <div className="h-10 w-10 rounded-md bg-chip-warn-bg text-chip-warn-fg grid place-items-center text-[10px] font-semibold flex-none">
            No
            <br />
            photo
          </div>
        )}

        <div className="flex-1 min-w-[12rem]">
          <div className="text-[13px] font-semibold text-lt-fg">{headline}</div>
          <div className="text-[12px] text-lt-fg2 leading-snug">{destination}</div>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) upload(f)
            e.target.value = ''
          }}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="rounded-md bg-amber-600 hover:bg-amber-500 px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50"
        >
          {uploading ? 'Uploading…' : resp.current ? 'Take a fresh one' : 'Take this week’s candid'}
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="text-[12px] text-lt-fg3 hover:text-lt-fg px-1"
          aria-label="Dismiss until next sign-in"
        >
          Later
        </button>
      </div>

      {err && <div className="mt-1.5 text-[12px] text-chip-bad-fg">{err}</div>}

      <div className="mt-1.5 text-[11px] text-lt-fg3 leading-snug">
        Aim for the SirReel sign, warehouse crew, a fleet vehicle or a piece of
        gear behind you &middot; candid beats posed.
      </div>
    </div>
  )
}

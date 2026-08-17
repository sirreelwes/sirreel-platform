'use client'

/**
 * /admin/rw-invoice-sync — why the RentalWorks balances in HQ are stale, and
 * what to do about it.
 *
 * This page is the destination of the `rw_sync_failure` and
 * `rw_token_expiring` Action-Queue alerts raised in
 * `src/lib/rentalworks/syncAlert.ts`. Those alerts have linked here since they
 * were written; the page did not exist, so the one click someone makes at the
 * exact moment they need remediation instructions landed on a 404.
 *
 * Ordered around the question the arriving reader has, which is never "what is
 * the mirror row count" — it is "can I quote this balance to a client, and if
 * not, who fixes it and how". So: a verdict first, the two facts behind it
 * second, the affected surfaces third, and the rotation procedure last.
 *
 * The token is a bearer JWT with no refresh mechanism — rotation is a manual
 * 10-minute procedure, not a button, and the steps here are a summary of
 * `docs/runbooks/rentalworks-token-rotation.md` rather than a second source of
 * truth.
 *
 * That runbook used to guess at an "Admin → API → Tokens" page. There isn't
 * one: RentalWorks has no token-issuance UI at all, and the working token is
 * the bearer its own web app sends. Both were corrected on 2026-08-16 after a
 * rotation was done for real. If they drift again, the runbook wins — but a
 * page that tells someone mid-incident to visit a screen that does not exist
 * costs more than one that says nothing.
 *
 * No token countdown is shown. It was derived from the JWT `exp` claim, which
 * RW stamps at 300 seconds and does not enforce, so it read EXPIRED forever —
 * including on tokens working fine. What a reader can actually rely on is
 * whether the mirror refreshed.
 */

import { useCallback, useEffect, useState } from 'react'

interface SyncStatus {
  count: number
  syncedAt: string | null
  tokenExpiresAt: string | null
  /** Negative once lapsed; null when the JWT carries no readable `exp`. */
  tokenDaysLeft: number | null
}

interface SyncResult {
  ok: boolean
  pulled: number
  pages: number
  error?: string
}

type Tone = 'ok' | 'warn' | 'bad'

/** Cron is `0 11 * * *` in vercel.json — 11:00 UTC, i.e. 4am Pacific. */
const CRON_LABEL = '4:00am Pacific'

/**
 * A healthy mirror is at most ~24h old. 26h allows for cron jitter without
 * crying wolf; past 50h at least two nightly runs have been missed, which is
 * no longer ambiguous.
 */
const AGING_HOURS = 26
const STALE_HOURS = 50

/** Matches RW_TOKEN_WARN_DAYS in syncAlert.ts — the alert and the page should
 *  not disagree about when a token counts as expiring. */
const TOKEN_WARN_DAYS = 14

function hoursSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 3_600_000
}

function relTime(iso: string): string {
  const h = hoursSince(iso)
  if (h < 1) return 'less than an hour ago'
  if (h < 24) {
    const n = Math.floor(h)
    return `${n} hour${n === 1 ? '' : 's'} ago`
  }
  const d = Math.floor(h / 24)
  return `${d} day${d === 1 ? '' : 's'} ago`
}

function absTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/* These banners sit on the dashboard's LIGHT content area, not on a dark
 * surface. They used to carry dark-theme values (a translucent dark fill with
 * text-*-200 over it), which on white rendered as pale text on a pale wash —
 * legible only if you already knew what it said.
 *
 * Note this is the opposite of BADGE_STYLES below, which is correct as-is:
 * badges render INSIDE the bg-zinc-900 cards. Same page, two surfaces. */
const TONE_STYLES: Record<Tone, string> = {
  ok: 'bg-emerald-50 border-emerald-300 text-emerald-900',
  warn: 'bg-amber-50 border-amber-300 text-amber-900',
  bad: 'bg-red-50 border-red-300 text-red-900',
}

const BADGE_STYLES: Record<Tone, string> = {
  ok: 'bg-emerald-900/40 text-emerald-300 border-emerald-800/60',
  warn: 'bg-amber-900/40 text-amber-300 border-amber-800/60',
  bad: 'bg-red-900/40 text-red-300 border-red-800/60',
}

function Badge({ tone, label }: { tone: Tone; label: string }) {
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${BADGE_STYLES[tone]}`}
    >
      {label}
    </span>
  )
}

/**
 * The single verdict line. An expired token outranks a stale mirror even
 * though both are true, because the token is the thing a human can act on —
 * staleness is the symptom and gets reported in the mirror card underneath.
 */
function verdict(s: SyncStatus): { tone: Tone; headline: string; detail: string } {
  const { syncedAt, tokenDaysLeft, tokenExpiresAt } = s
  const age = syncedAt ? hoursSince(syncedAt) : null
  const frozen = syncedAt
    ? `Balances are frozen at ${absTime(syncedAt)} and every RW figure in HQ is that old.`
    : 'No RW balances have ever loaded.'

  if (tokenDaysLeft != null && tokenDaysLeft < 0) {
    const n = Math.abs(tokenDaysLeft)
    return {
      tone: 'bad',
      headline: `The RentalWorks token expired ${n} day${n === 1 ? '' : 's'} ago.`,
      detail: `The nightly sync cannot run until someone mints a new token. ${frozen} Do not quote an RW balance to a client until this is resolved.`,
    }
  }

  if (!syncedAt) {
    return {
      tone: 'bad',
      headline: 'The invoice mirror has never been populated.',
      detail:
        'No sync has ever completed, so Collections, Receivables (RW) and Reconcile RW have no RW figures to show.',
    }
  }

  if (age != null && age > STALE_HOURS) {
    return {
      tone: 'bad',
      headline: `The mirror has not refreshed since ${relTime(syncedAt)}.`,
      detail: `At least two nightly runs have been missed and the token is not the cause. ${frozen} Check the cron logs for /api/admin/rw-invoice-sync, then try a manual sync below.`,
    }
  }

  if (tokenDaysLeft != null && tokenDaysLeft <= TOKEN_WARN_DAYS) {
    return {
      tone: 'warn',
      headline:
        tokenDaysLeft === 0
          ? 'The RentalWorks token expires today.'
          : `The RentalWorks token expires in ${tokenDaysLeft} day${tokenDaysLeft === 1 ? '' : 's'}.`,
      detail:
        'The mirror is current for now. There is no refresh mechanism, so rotate the token before it lapses — once it does, every RW balance in HQ goes stale silently.',
    }
  }

  if (age != null && age > AGING_HOURS) {
    return {
      tone: 'warn',
      headline: `Last night's sync did not land — the mirror is ${relTime(syncedAt)}.`,
      detail: `One run has been missed. ${frozen} A manual sync below will confirm whether this is a transient failure or the start of an outage.`,
    }
  }

  return {
    tone: 'ok',
    headline: `The mirror is current as of ${relTime(syncedAt)}.`,
    detail: `Collections, Receivables (RW) and Reconcile RW are serving balances from ${absTime(syncedAt)}. A current mirror is itself the proof the token works — RW stamps a 300-second expiry it does not enforce, so there is no countdown to show. Rotate on the ~50-day cadence in the runbook.`,
  }
}

function Card({
  label,
  tone,
  badge,
  rows,
}: {
  label: string
  tone: Tone
  badge: string
  rows: { label: string; value: string }[]
}) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
      <div className="flex items-start justify-between mb-3">
        <h3 className="text-sm font-semibold text-white">{label}</h3>
        <Badge tone={tone} label={badge} />
      </div>
      <div className="text-xs text-zinc-400 space-y-1.5">
        {rows.map((r) => (
          <div key={r.label} className="flex justify-between gap-4">
            <span className="text-zinc-500 shrink-0">{r.label}</span>
            <span className="text-right break-words">{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Pages that read the mirror. Listed when it is stale so the reader knows
 *  exactly which numbers not to trust, rather than "RW balances" in general. */
const AFFECTED = [
  { href: '/collections', label: 'Collections' },
  { href: '/rentalworks/invoices', label: 'Receivables (RW)' },
  { href: '/rentalworks/reconcile', label: 'Reconcile RW' },
  { href: '/jobs', label: 'Jobs (RW balance column)' },
]

export default function RwInvoiceSyncPage() {
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [result, setResult] = useState<SyncResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/rw-invoice-sync', { cache: 'no-store' })
      if (res.status === 401) {
        setError('Sign in required.')
        return
      }
      if (res.status === 403) {
        setError('Admin access required.')
        return
      }
      if (!res.ok) {
        setError(`Could not load sync status (HTTP ${res.status}).`)
        return
      }
      setStatus(await res.json())
      setError(null)
    } catch (e) {
      setError(`Could not load sync status: ${(e as Error).message}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  /**
   * A manual pull. This is the "I have just rotated the token" button — it
   * re-runs the same sync the cron does, so a successful click is proof the
   * new credential works, without waiting until tomorrow morning to find out.
   */
  const syncNow = useCallback(async () => {
    setSyncing(true)
    setResult(null)
    try {
      const res = await fetch('/api/admin/rw-invoice-sync', { method: 'POST' })
      const data = (await res.json().catch(() => ({}))) as SyncResult
      setResult(
        res.ok
          ? data
          : { ok: false, pulled: 0, pages: 0, error: data.error ?? `HTTP ${res.status}` },
      )
      await load()
    } catch (e) {
      setResult({ ok: false, pulled: 0, pages: 0, error: (e as Error).message })
    } finally {
      setSyncing(false)
    }
  }, [load])

  if (error) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="bg-red-900/20 border border-red-800 text-red-200 rounded-xl p-4 text-sm">
          {error}
        </div>
      </div>
    )
  }

  const v = status ? verdict(status) : null
  const age = status?.syncedAt ? hoursSince(status.syncedAt) : null
  const mirrorTone: Tone =
    !status?.syncedAt || (age != null && age > STALE_HOURS)
      ? 'bad'
      : age != null && age > AGING_HOURS
        ? 'warn'
        : 'ok'
  // The token's health is only observable through use: a mirror that refreshed
  // last night proves the token worked last night. Deriving it from the JWT
  // `exp` claim showed EXPIRED permanently, including on working tokens.
  const tokenTone: Tone = mirrorTone
  const needsRotation = tokenTone !== 'ok'
  const showAffected = mirrorTone !== 'ok'

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900">RentalWorks Invoice Sync</h1>
          <p className="text-sm text-zinc-600 mt-1">
            The nightly job ({CRON_LABEL}) that refreshes the invoice mirror behind Collections,
            Receivables (RW) and Reconcile RW. When it stops, those balances quietly go stale.
          </p>
        </div>
        <button
          onClick={syncNow}
          disabled={syncing || loading}
          className="shrink-0 px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {syncing ? 'Syncing…' : 'Sync now'}
        </button>
      </div>

      {loading && !status ? (
        <div className="text-zinc-600 text-sm">Loading…</div>
      ) : !status || !v ? (
        <div className="text-zinc-600 text-sm">No status available.</div>
      ) : (
        <>
          <div className={`border rounded-xl p-4 mb-4 ${TONE_STYLES[v.tone]}`}>
            <div className="text-sm font-semibold">{v.headline}</div>
            <div className="text-xs mt-1.5 leading-relaxed">{v.detail}</div>
          </div>

          {result && (
            <div
              className={`border rounded-xl p-4 mb-4 text-xs ${TONE_STYLES[result.ok ? 'ok' : 'bad']}`}
            >
              {result.ok ? (
                <>
                  <span className="font-semibold">Sync succeeded.</span> Pulled{' '}
                  {result.pulled.toLocaleString()} invoices across {result.pages}{' '}
                  {result.pages === 1 ? 'page' : 'pages'}.
                </>
              ) : (
                <>
                  <span className="font-semibold">Sync failed.</span> {result.error}
                  <div className="mt-1">
                    The mirror was left untouched — a failed pull never overwrites good data.
                  </div>
                </>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <Card
              label="Invoice mirror"
              tone={mirrorTone}
              badge={
                mirrorTone === 'ok' ? 'CURRENT' : mirrorTone === 'warn' ? 'AGING' : 'STALE'
              }
              rows={[
                {
                  label: 'Last successful sync',
                  value: status.syncedAt ? absTime(status.syncedAt) : 'never',
                },
                {
                  label: 'Age',
                  value: status.syncedAt ? relTime(status.syncedAt) : '—',
                },
                { label: 'Invoices mirrored', value: status.count.toLocaleString() },
                { label: 'Scheduled', value: `daily, ${CRON_LABEL}` },
              ]}
            />
            <Card
              label="RENTALWORKS_TOKEN"
              tone={tokenTone}
              badge={mirrorTone === 'ok' ? 'WORKING' : 'UNVERIFIED'}
              rows={[
                {
                  label: 'Last proven',
                  value: status.syncedAt
                    ? `${absTime(status.syncedAt)} — a sync completed`
                    : 'never — no sync has succeeded',
                },
                {
                  label: 'Expiry',
                  value: 'not knowable — RW stamps 300s and ignores it',
                },
                { label: 'Refresh', value: 'manual — no refresh mechanism' },
                { label: 'Rotation cadence', value: 'every ~50 days' },
              ]}
            />
          </div>

          {showAffected && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 mb-6">
              <h2 className="text-sm font-semibold text-white mb-1">
                Serving out-of-date numbers right now
              </h2>
              <p className="text-xs text-zinc-500 mb-3">
                These read the mirror. Until it refreshes, treat every RW figure on them as
                {status.syncedAt ? ` ${relTime(status.syncedAt)}` : ' missing'} — not current.
              </p>
              <div className="flex flex-wrap gap-2">
                {AFFECTED.map((a) => (
                  <a
                    key={a.href}
                    href={a.href}
                    className="px-2.5 py-1 text-xs rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors"
                  >
                    {a.label}
                  </a>
                ))}
              </div>
            </div>
          )}

          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <h2 className="text-sm font-semibold text-white mb-1">
              {needsRotation ? 'Rotate the token' : 'Rotating the token'}
            </h2>
            <p className="text-xs text-zinc-500 mb-4">
              About 10 minutes, and it has to be done by hand — RentalWorks has no
              token-issuance UI and no auth API, so the token is the bearer its own web app uses.
              Full procedure:{' '}
              <code className="text-zinc-400">docs/runbooks/rentalworks-token-rotation.md</code>
            </p>

            <ol className="text-xs text-zinc-400 space-y-3 list-decimal ml-4">
              <li>
                <span className="text-zinc-300">Copy the bearer from the RW web app.</span> Log into{' '}
                <a
                  href="https://sirreel.rentalworks.cloud/"
                  target="_blank"
                  rel="noreferrer"
                  className="text-amber-500 hover:text-amber-400 underline"
                >
                  sirreel.rentalworks.cloud
                </a>{' '}
                with the admin account (1Password → &ldquo;RentalWorks Admin&rdquo;) and open any
                module that loads data. Then DevTools → Network → Fetch/XHR → click a{' '}
                <code>browse</code> request → Headers → Request Headers, and copy{' '}
                <code>authorization</code> without the leading <code>Bearer </code>.
                <div className="text-zinc-500 mt-1">
                  There is no Generate-Token page — the whole Administrator menu was checked on
                  2026-08-16 and has no API or Token entry. Clear the Network filter box first or
                  the request list stays empty. Stay logged in until step 5 passes: the token is
                  tied to that session. It is a bearer credential with full read/write access to
                  the tenant, so do not save it to a file or paste it into chat.
                </div>
              </li>
              <li>
                <span className="text-zinc-300">Verify it before deploying.</span> One cheap API
                call, and it never logs the token. Quote the value and do not type angle brackets —
                an unquoted <code>&lt;</code> is shell redirection and fails with &ldquo;File name
                too long&rdquo;:
                <pre className="mt-1.5 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-[11px] text-zinc-300 overflow-x-auto">
                  RENTALWORKS_TOKEN=&apos;eyJ…&apos; npx tsx scripts/verify-rw-token.ts
                </pre>
              </li>
              <li>
                <span className="text-zinc-300">Set it in Vercel production.</span>
                <pre className="mt-1.5 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-[11px] text-zinc-300 overflow-x-auto">
                  {'vercel env rm RENTALWORKS_TOKEN production\nvercel env add RENTALWORKS_TOKEN production'}
                </pre>
                <div className="text-zinc-500 mt-1">Choose Production only, not Preview or Dev.</div>
              </li>
              <li>
                <span className="text-zinc-300">Redeploy.</span> Env-var changes do not reach
                running functions until a new deploy — push to <code>main</code> (an empty commit is
                fine) and let the Vercel integration build it. Do not run{' '}
                <code>vercel --prod</code>; it races the auto-deploy.
              </li>
              <li>
                <span className="text-zinc-300">Come back here and hit Sync now.</span> A green
                result is proof the new token works and the mirror is current again. Then set a
                calendar reminder for 50 days out.
              </li>
            </ol>
          </div>
        </>
      )}
    </div>
  )
}

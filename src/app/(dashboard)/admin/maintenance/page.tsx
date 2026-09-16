'use client'

/**
 * /admin/maintenance — run a seed or backfill from whatever device is to
 * hand (Wes 2026-09-16: "I need to be able to run these scripts from my
 * iPad with no access to my actual laptop").
 *
 * Built for a phone held one-handed: one card per task, full-width controls,
 * and the output as a scrolling log rather than a table. Dry run is the
 * primary button and the only one you can press without a second step —
 * "Run for real" reveals a confirm, because the undo for a seed is a
 * cleanup, and the cleanup rule is by-captured-id only.
 *
 * The page never names a script or a path: it posts a task id from the
 * registry. See maintenanceTasks.ts for why that distinction matters.
 */

import { useState } from 'react'
import { MAINTENANCE_TASKS, type MaintenanceTaskMeta } from '@/lib/admin/maintenanceTasks'

interface RunResult {
  ok?: boolean
  dryRun?: boolean
  headline?: string
  log?: string[]
  createdIds?: string[]
  error?: string
  fix?: string
}

function TaskCard({ task }: { task: MaintenanceTaskMeta }) {
  const [params, setParams] = useState<Record<string, string>>(() =>
    Object.fromEntries((task.params ?? []).map((p) => [p.key, p.options ? p.options[0] : ''])),
  )
  const [busy, setBusy] = useState<false | 'dry' | 'real'>(false)
  const [result, setResult] = useState<RunResult | null>(null)
  const [armed, setArmed] = useState(false)
  const [open, setOpen] = useState(false)

  async function run(dryRun: boolean) {
    setBusy(dryRun ? 'dry' : 'real')
    setResult(null)
    try {
      const r = await fetch(`/api/admin/maintenance/${task.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun, params, ...(dryRun ? {} : { confirm: task.id }) }),
      })
      setResult(await r.json())
      if (!dryRun) setArmed(false)
    } catch (e) {
      setResult({ error: e instanceof Error ? e.message : 'Request failed.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-lt-card border border-lt-hairline rounded-xl overflow-hidden">
      <div className="px-4 py-4">
        <h2 className="text-[17px] font-semibold text-lt-fg leading-snug">{task.title}</h2>
        <p className="mt-1 text-[14px] text-lt-fg2 leading-relaxed">{task.summary}</p>

        <button
          onClick={() => setOpen(!open)}
          className="mt-2 text-[13px] font-medium text-amber-700 hover:text-amber-600"
        >
          {open ? 'Hide details' : 'What exactly does this do?'}
        </button>
        {open && (
          <div className="mt-2 rounded-lg bg-lt-inner border border-lt-hairline px-3 py-3 space-y-2">
            <p className="text-[13px] text-lt-fg2 leading-relaxed">{task.detail}</p>
            <p className="text-[12px] text-lt-fg3 leading-relaxed">
              <span className="font-semibold text-lt-fg2">Writes:</span> {task.writes}
            </p>
            <p className="text-[12px] text-lt-fg3 leading-relaxed">
              <span className="font-semibold text-lt-fg2">On a laptop:</span>{' '}
              <code className="font-mono">{task.cliEquivalent}</code>
            </p>
          </div>
        )}

        {(task.params ?? []).length > 0 && (
          <div className="mt-4 space-y-3">
            {(task.params ?? []).map((p) => (
              <div key={p.key}>
                <label className="block text-[13px] font-medium text-lt-fg" htmlFor={`${task.id}-${p.key}`}>
                  {p.label}
                </label>
                {p.options ? (
                  <select
                    id={`${task.id}-${p.key}`}
                    value={params[p.key] ?? ''}
                    onChange={(e) => setParams({ ...params, [p.key]: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-lt-hairline bg-lt-card px-3 py-2.5 text-[16px] text-lt-fg"
                  >
                    {p.options.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input
                    id={`${task.id}-${p.key}`}
                    value={params[p.key] ?? ''}
                    onChange={(e) => setParams({ ...params, [p.key]: e.target.value })}
                    placeholder={p.placeholder}
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    /* 16px: anything smaller makes iOS Safari zoom the page
                       on focus, which on a phone reads as the layout
                       breaking. */
                    className="mt-1 w-full rounded-lg border border-lt-hairline bg-lt-card px-3 py-2.5 text-[16px] text-lt-fg"
                  />
                )}
                {p.help && <p className="mt-1 text-[12px] text-lt-fg3 leading-relaxed">{p.help}</p>}
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 flex flex-col sm:flex-row gap-2">
          <button
            onClick={() => run(true)}
            disabled={busy !== false}
            className="flex-1 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 px-4 py-3 text-[15px] font-semibold text-white"
          >
            {busy === 'dry' ? 'Checking…' : 'Dry run — change nothing'}
          </button>
          {!armed ? (
            <button
              onClick={() => setArmed(true)}
              disabled={busy !== false}
              className="flex-1 rounded-lg border border-lt-hairline hover:bg-lt-inner disabled:opacity-50 px-4 py-3 text-[15px] font-semibold text-lt-fg2"
            >
              Run for real…
            </button>
          ) : (
            <div className="flex-1 flex gap-2">
              <button
                onClick={() => run(false)}
                disabled={busy !== false}
                className="flex-1 rounded-lg bg-chip-bad-fg hover:opacity-90 disabled:opacity-50 px-4 py-3 text-[15px] font-semibold text-white"
              >
                {busy === 'real' ? 'Writing…' : 'Yes — write it'}
              </button>
              <button
                onClick={() => setArmed(false)}
                disabled={busy !== false}
                className="rounded-lg border border-lt-hairline px-4 py-3 text-[15px] text-lt-fg2"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
        {armed && (
          <p className="mt-2 text-[12px] text-chip-bad-fg leading-relaxed">
            This writes to the live database. There is no undo button — a mistake is cleaned up by the ids
            this run reports, which are also written to the audit log.
          </p>
        )}
      </div>

      {result && (
        <div className="border-t border-lt-hairline">
          {result.error ? (
            <div className="px-4 py-3 bg-chip-bad-bg">
              <div className="text-[14px] font-semibold text-chip-bad-fg">{result.error}</div>
              {result.fix && <div className="mt-1 text-[13px] text-chip-bad-fg/90 leading-relaxed">{result.fix}</div>}
            </div>
          ) : (
            <div className={`px-4 py-3 ${result.dryRun ? 'bg-chip-neutral-bg' : 'bg-chip-good-bg'}`}>
              <div className={`text-[14px] font-semibold ${result.dryRun ? 'text-chip-neutral-fg' : 'text-chip-good-fg'}`}>
                {result.dryRun ? 'Dry run · nothing written' : 'Done'} — {result.headline}
              </div>
            </div>
          )}
          {result.log && result.log.length > 0 && (
            <pre className="px-4 py-3 text-[12px] leading-relaxed font-mono text-lt-fg2 whitespace-pre-wrap break-words max-h-[420px] overflow-auto">
              {result.log.join('\n')}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

export default function MaintenancePage() {
  return (
    <div className="max-w-[760px] mx-auto px-4 py-6">
      <h1 className="text-[24px] font-bold text-lt-fg">Run a task</h1>
      <p className="mt-1.5 text-[14px] text-lt-fg2 leading-relaxed">
        Seeds and backfills that used to need a laptop and a terminal. Every one is safe to run twice, and
        every one offers a dry run first. Schema changes are deliberately not here — those still want a
        keyboard.
      </p>

      <div className="mt-5 space-y-4">
        {MAINTENANCE_TASKS.map((t) => <TaskCard key={t.id} task={t} />)}
      </div>
    </div>
  )
}

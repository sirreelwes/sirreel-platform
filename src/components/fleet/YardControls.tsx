'use client';

/**
 * Interactive controls for the yard screens — the client half of
 * yard-ui.tsx. Same rules: 48px targets, 16px type in inputs (anything
 * smaller makes iOS zoom the page on focus), no dropdowns. A tech with
 * gloves off in the cold taps big pills; nobody scrolls a <select>.
 */

import type { ReactNode } from 'react';

/** Text input / textarea. 16px on purpose — see the module note. */
export const yardInput =
  'w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3.5 py-3 text-[16px] text-white placeholder:text-zinc-600 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/40';

export function YardField({
  label,
  optional,
  aside,
  hint,
  children,
}: {
  label: ReactNode;
  optional?: boolean;
  aside?: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <label className="text-zinc-300 text-[14px] font-semibold">
          {label}
          {optional && <span className="text-zinc-500 font-normal"> · optional</span>}
        </label>
        {aside}
      </div>
      {children}
      {hint && <div className="mt-2 text-[13px]">{hint}</div>}
    </div>
  );
}

/**
 * Big tap pills. `columns` pins a grid (fuel: five equal cells);
 * otherwise pills wrap and share the row.
 */
export function TapSelector({
  options,
  value,
  onChange,
  format,
  columns,
}: {
  options: readonly string[];
  value: string;
  onChange: (v: string) => void;
  format?: (v: string) => string;
  columns?: number;
}) {
  return (
    <div
      role="radiogroup"
      className={columns ? 'grid gap-2' : 'flex flex-wrap gap-2'}
      style={columns ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}
    >
      {options.map((opt) => {
        const selected = value === opt;
        return (
          <button
            key={opt}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(opt)}
            className={`min-h-[48px] px-3 rounded-xl border text-[15px] font-semibold capitalize transition-colors ${
              columns ? '' : 'flex-1 basis-[30%]'
            } ${
              selected
                ? 'bg-amber-600 border-amber-500 text-white shadow-[0_0_0_1px_rgba(77,177,198,0.35)]'
                : 'bg-zinc-900 border-zinc-700 text-zinc-300 active:bg-zinc-800'
            }`}
          >
            {format ? format(opt) : opt}
          </button>
        );
      })}
    </div>
  );
}

/** A one-line notice under a field or above the submit. */
export function YardNote({ tone = 'muted', children }: { tone?: 'muted' | 'warn' | 'bad' | 'good'; children: ReactNode }) {
  const cls = {
    muted: 'text-zinc-500',
    warn: 'text-yellow-300',
    bad: 'text-rose-300',
    good: 'text-emerald-300',
  }[tone];
  return <p className={`text-[13px] leading-snug ${cls}`}>{children}</p>;
}

/** A boxed notice — the walk-around gap, a submit error. */
export function YardAlert({ tone, children }: { tone: 'warn' | 'bad' | 'info'; children: ReactNode }) {
  const cls = {
    warn: 'border-yellow-800/70 bg-yellow-950/30 text-yellow-200',
    bad: 'border-rose-800/70 bg-rose-950/40 text-rose-200',
    info: 'border-amber-800/60 bg-amber-950/30 text-amber-100',
  }[tone];
  return <div className={`rounded-xl border px-3.5 py-3 text-[14px] leading-snug ${cls}`}>{children}</div>;
}

/**
 * The submit, pinned to the bottom of the phone above the home
 * indicator. The status line above the button says what the button is
 * waiting for, so "Waiting for 2 photos" is never a mystery.
 */
export function StickyBar({
  status,
  children,
}: {
  status?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="max-w-md mx-auto">
        {status && <div className="mb-2 text-center text-[13px] text-zinc-400">{status}</div>}
        {children}
      </div>
    </div>
  );
}

export const yardSubmit =
  'w-full min-h-[56px] rounded-2xl bg-amber-600 text-white text-[17px] font-bold active:bg-amber-500 disabled:opacity-40 disabled:active:bg-amber-600';

'use client';

/**
 * "Who's doing this?" — one big button per regular, plus "Someone else".
 *
 * Starts EMPTY on purpose and is never filled from the login: Andy and
 * Frankie share fleet@sirreel.com, and a yard phone stays signed in as
 * whoever used it last. See src/lib/fleet/walkaroundCrew.ts.
 */

import { useState } from 'react';
import { Check } from 'lucide-react';
import { WALKAROUND_CREW } from '@/lib/fleet/walkaroundCrew';

export function WalkaroundCrewPicker({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (name: string) => void;
  label: string;
}) {
  const isCrew = WALKAROUND_CREW.includes(value);
  const [other, setOther] = useState(false);
  const showOther = other || (value !== '' && !isCrew);

  return (
    <section
      className={`rounded-xl border p-3 ${value.trim() ? 'border-zinc-700 bg-zinc-800/40' : 'border-amber-600 bg-zinc-800'}`}
    >
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <span className="text-white text-base font-semibold">{label}</span>
        {value.trim() ? (
          <span className="text-emerald-400 text-[13px] font-medium inline-flex items-center gap-1">
            <Check size={13} aria-hidden />
            {value.trim()}
          </span>
        ) : (
          <span className="text-amber-400 text-[13px] font-medium">Required</span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2" role="group" aria-label={label}>
        {WALKAROUND_CREW.map((name) => {
          const selected = value === name;
          return (
            <button
              key={name}
              type="button"
              aria-pressed={selected}
              onClick={() => {
                setOther(false);
                onChange(name);
              }}
              className={`min-h-[52px] rounded-lg border text-base font-semibold ${
                selected
                  ? 'bg-amber-600 border-amber-500 text-white'
                  : 'bg-zinc-800 border-zinc-700 text-zinc-200 active:bg-zinc-700'
              }`}
            >
              {name}
            </button>
          );
        })}
        <button
          type="button"
          aria-pressed={showOther}
          onClick={() => {
            setOther(true);
            if (isCrew) onChange('');
          }}
          className={`min-h-[52px] rounded-lg border text-base font-semibold ${
            showOther
              ? 'bg-amber-600 border-amber-500 text-white'
              : 'bg-zinc-800 border-zinc-700 text-zinc-200 active:bg-zinc-700'
          }`}
        >
          Someone else
        </button>
      </div>
      {showOther && (
        <input
          autoFocus
          value={isCrew ? '' : value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Your name"
          aria-label="Your name"
          maxLength={60}
          className="mt-2 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-3 text-white text-base focus:outline-none focus:border-amber-600"
        />
      )}
    </section>
  );
}

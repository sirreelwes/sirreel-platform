'use client';

/**
 * Controlled <select> for picking a ProductionTypeProfile.
 *
 * Fetches the eight profile rows from /api/production-type-profiles
 * once on mount (cached in-component — re-mounting refetches, which
 * is fine for a list this small). Empty value = "no profile picked";
 * the calling form should treat that as null when submitting.
 *
 * Surfaces the tier inline in the option label so the agent sees
 * what gear pool they're routing this Job toward (tier 5 = newest
 * gear pool, tier 1 = oldest).
 *
 * Two visual sizes:
 *   - 'compact' for tight grid cells (new-quote)
 *   - 'normal' for standalone form fields (/jobs/[id])
 */

import { useEffect, useState } from 'react';

interface Profile {
  id: string;
  name: string;
  slug: string;
  tier: number;
  upsellPropensity: number;
  priceSensitivity: number;
  salesMode: string;
}

interface Props {
  /** Selected profile id, or '' / null for unset. */
  value: string | null;
  /** Called with the new id, or null when the agent clears the picker. */
  onChange: (id: string | null) => void;
  /** When true, the picker is read-only (e.g. while a parent form is
   *  submitting). Doesn't gate fetch. */
  disabled?: boolean;
  size?: 'normal' | 'compact';
  /** Optional "(none)" label when the picker can be cleared. Set
   *  false on forms where a profile is required. */
  allowNone?: boolean;
}

export function ProductionTypeProfilePicker({
  value,
  onChange,
  disabled = false,
  size = 'normal',
  allowNone = true,
}: Props) {
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/production-type-profiles', { cache: 'no-store' })
      .then(async (r) => {
        const json = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (!r.ok) {
          setError(json?.error || `HTTP ${r.status}`);
          setProfiles([]);
        } else {
          setProfiles((json.profiles as Profile[]) ?? []);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'fetch failed');
        setProfiles([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const compact = size === 'compact';
  const cls = compact
    ? 'w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-[12px] text-white disabled:opacity-50'
    : 'w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-sm text-white disabled:opacity-50';

  return (
    <div>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        disabled={disabled || profiles === null}
        className={cls}
      >
        {allowNone && <option value="">— None —</option>}
        {profiles === null
          ? <option value="" disabled>Loading…</option>
          : profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} (tier {p.tier})
              </option>
            ))}
      </select>
      {error && (
        <div className="text-[10px] text-red-400 mt-1">Couldn&rsquo;t load profiles: {error}</div>
      )}
    </div>
  );
}

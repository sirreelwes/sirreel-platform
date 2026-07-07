'use client';

/**
 * /admin/home-tiles — images for the Home diagonal service-nav tiles
 * (requireAdmin on every API call). One image slot per tile. Each is
 * duotone-tinted to its tile color on the Home page; an unset tile falls
 * back to the solid color (graceful empty state). Reuses the
 * site-settings upload pattern; served via /api/public/site-media/tile-*.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

type Slot = 'trucking' | 'stages' | 'standing-sets' | 'led-wall' | 'supplies' | 'radios-wifi' | 'grip-electric';

interface TilesState {
  trucking: boolean;
  stages: boolean;
  standingSets: boolean;
  ledWall: boolean;
  supplies: boolean;
  radiosWifi: boolean;
  gripElectric: boolean;
  updatedAt: string | null;
}

const SLOTS: { slot: Slot; title: string; color: string; stateKey: keyof TilesState }[] = [
  { slot: 'trucking', title: 'Trucking', color: '#d99a2b', stateKey: 'trucking' },
  { slot: 'stages', title: 'Stages', color: '#c0392b', stateKey: 'stages' },
  { slot: 'standing-sets', title: 'Standing Sets', color: '#2b7fd9', stateKey: 'standingSets' },
  { slot: 'led-wall', title: 'LED Wall', color: '#4caf50', stateKey: 'ledWall' },
  { slot: 'supplies', title: 'Supplies & Equipment', color: '#7e57c2', stateKey: 'supplies' },
  { slot: 'radios-wifi', title: 'Radios & WiFi', color: '#0e9db0', stateKey: 'radiosWifi' },
  { slot: 'grip-electric', title: 'Grip & Electric', color: '#e0701f', stateKey: 'gripElectric' },
];

export default function AdminHomeTilesPage() {
  const [tiles, setTiles] = useState<TilesState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Slot | null>(null);
  const [rev, setRev] = useState(0);
  const inputs = {
    trucking: useRef<HTMLInputElement>(null),
    stages: useRef<HTMLInputElement>(null),
    'standing-sets': useRef<HTMLInputElement>(null),
    'led-wall': useRef<HTMLInputElement>(null),
    supplies: useRef<HTMLInputElement>(null),
    'radios-wifi': useRef<HTMLInputElement>(null),
    'grip-electric': useRef<HTMLInputElement>(null),
  };

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/home-tiles');
      if (res.status === 401 || res.status === 403) { setError('Admin access required.'); return; }
      setTiles(await res.json());
      setError(null);
    } catch {
      setError('Failed to load tiles.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const upload = async (slot: Slot, file: File) => {
    setBusy(slot);
    setError(null);
    try {
      const fd = new FormData();
      fd.set('slot', slot);
      fd.set('file', file);
      const res = await fetch('/api/admin/home-tiles', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || `HTTP ${res.status}`); return; }
      setRev((r) => r + 1);
      await load();
    } finally {
      setBusy(null);
    }
  };

  const clear = async (slot: Slot, title: string) => {
    if (!confirm(`Remove the ${title} photo? The tile falls back to its solid color.`)) return;
    setBusy(slot);
    try {
      const res = await fetch(`/api/admin/home-tiles?slot=${slot}`, { method: 'DELETE' });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error || `HTTP ${res.status}`); return; }
      setRev((r) => r + 1);
      await load();
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <div className="p-6 text-lt-fg2">Loading…</div>;

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-lt-fg">Home Tiles</h1>
        <p className="text-sm text-lt-fg2 mt-1">
          Photos for the Home page&rsquo;s five diagonal service tiles. Each is tinted to its tile color.
        </p>
      </div>

      {error && <div className="px-4 py-2 rounded-lg bg-chip-bad-bg text-chip-bad-fg text-sm">{error}</div>}

      <div className="space-y-4">
        {SLOTS.map(({ slot, title, color, stateKey }) => {
          const isSet = !!tiles?.[stateKey];
          return (
            <div key={slot} className="bg-lt-card border border-lt-hairline rounded-xl p-5">
              <div className="flex items-center gap-3">
                <span className="w-4 h-4 rounded-full flex-none border border-black/10" style={{ backgroundColor: color }} />
                <h2 className="font-semibold text-lt-fg flex-1">{title}</h2>
                <span className={`text-xs px-2 py-1 rounded ${isSet ? 'bg-chip-good-bg text-chip-good-fg' : 'bg-chip-neutral-bg text-chip-neutral-fg'}`}>
                  {isSet ? 'set' : 'not set'}
                </span>
              </div>
              {isSet && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={rev}
                  src={`/api/public/site-media/tile-${slot}?v=${rev}`}
                  alt={`${title} tile`}
                  className="mt-3 w-full max-h-52 object-cover rounded-lg border border-lt-hairline bg-lt-inner"
                />
              )}
              <input
                ref={inputs[slot]}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(slot, f); e.target.value = ''; }}
              />
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => inputs[slot].current?.click()}
                  disabled={busy === slot}
                  className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold rounded-lg disabled:opacity-40 transition-colors"
                >
                  {busy === slot ? 'Uploading…' : isSet ? 'Replace image' : 'Upload image'}
                </button>
                {isSet && (
                  <button
                    onClick={() => clear(slot, title)}
                    disabled={busy === slot}
                    className="px-3 py-1.5 border border-lt-hairline text-chip-bad-fg text-sm rounded-lg hover:bg-lt-inner transition-colors"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-lt-fg3">
        Photos are shown black-and-color (duotone) on the Home tiles. An unset tile shows its solid color and
        deepens on hover. Changes may take up to an hour to propagate through the CDN cache.
      </p>
    </div>
  );
}

'use client';

/**
 * /admin/site-settings — public marketing site config (requireAdmin on
 * every API call). Currently: the Home hero media.
 *
 *   Hero poster (required)      — JPG fallback + <video poster>.
 *   Hero video (optional)       — muted autoplay loop, desktop.
 *   Hero video · mobile (opt.)  — lighter loop served under ~768px.
 *
 * All upload to the PRIVATE Blob store and are served publicly through
 * /api/public/site-media/[slot]. Empty state → the Home hero falls back
 * to the plain dark band.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { PAGE_TITLE_DEFAULTS } from '@/lib/site/pageTitleDefaults';

interface PageTitlesState {
  standingSets: string;
  vehicles: string;
  contact: string;
}

interface SettingsState {
  heroPoster: boolean;
  heroVideo: boolean;
  heroVideoMobile: boolean;
  updatedAt: string | null;
  titles?: PageTitlesState;
}

type Slot = 'hero-poster' | 'hero-video' | 'hero-video-mobile';

const TITLE_ROWS: { key: keyof PageTitlesState; label: string; placeholder: string }[] = [
  { key: 'standingSets', label: 'Standing Sets page', placeholder: PAGE_TITLE_DEFAULTS.standingSets },
  { key: 'vehicles', label: 'Vehicles page', placeholder: PAGE_TITLE_DEFAULTS.vehicles },
  { key: 'contact', label: 'Contact page', placeholder: PAGE_TITLE_DEFAULTS.contact },
];

export default function SiteSettingsPage() {
  const [settings, setSettings] = useState<SettingsState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Slot | null>(null);
  const [rev, setRev] = useState(0); // cache-buster for previews after a swap
  const [titleDraft, setTitleDraft] = useState<PageTitlesState>({ standingSets: '', vehicles: '', contact: '' });
  const [savingTitles, setSavingTitles] = useState(false);
  const [titleMsg, setTitleMsg] = useState<string | null>(null);
  const inputs = {
    'hero-poster': useRef<HTMLInputElement>(null),
    'hero-video': useRef<HTMLInputElement>(null),
    'hero-video-mobile': useRef<HTMLInputElement>(null),
  };

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/site-settings');
      if (res.status === 401 || res.status === 403) { setError('Admin access required.'); return; }
      const data: SettingsState = await res.json();
      setSettings(data);
      setTitleDraft({
        standingSets: data.titles?.standingSets ?? '',
        vehicles: data.titles?.vehicles ?? '',
        contact: data.titles?.contact ?? '',
      });
      setError(null);
    } catch {
      setError('Failed to load settings.');
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
      const res = await fetch('/api/admin/site-settings', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || `HTTP ${res.status}`); return; }
      setRev((r) => r + 1);
      await load();
    } finally {
      setBusy(null);
    }
  };

  const clear = async (slot: 'hero-video' | 'hero-video-mobile', label: string) => {
    if (!confirm(`Remove the ${label}? The poster image stays.`)) return;
    setBusy(slot);
    try {
      const res = await fetch(`/api/admin/site-settings?slot=${slot}`, { method: 'DELETE' });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error || `HTTP ${res.status}`); return; }
      setRev((r) => r + 1);
      await load();
    } finally {
      setBusy(null);
    }
  };

  const saveTitles = async () => {
    setSavingTitles(true);
    setTitleMsg(null);
    setError(null);
    try {
      const res = await fetch('/api/admin/site-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(titleDraft),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d.error || `HTTP ${res.status}`); return; }
      setTitleMsg('Saved. Live pages update within a moment.');
      await load();
    } catch {
      setError('Failed to save titles.');
    } finally {
      setSavingTitles(false);
    }
  };

  if (loading) return <div className="p-6 text-lt-fg2">Loading…</div>;

  const Card = ({
    slot, title, required, desc, accept, isSet, isVideo, mediaSlot, clearable, clearLabel,
  }: {
    slot: Slot; title: string; required?: boolean; desc: string; accept: string;
    isSet: boolean; isVideo: boolean; mediaSlot: string; clearable?: 'hero-video' | 'hero-video-mobile'; clearLabel?: string;
  }) => (
    <div className="bg-lt-card border border-lt-hairline rounded-xl p-5 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold text-lt-fg">
            {title}{' '}
            {required
              ? <span className="text-chip-bad-fg text-xs align-middle ml-1">required</span>
              : <span className="text-lt-fg3 text-xs align-middle ml-1">optional</span>}
          </h2>
          <p className="text-xs text-lt-fg3 mt-0.5">{desc}</p>
        </div>
        <span className={`text-xs px-2 py-1 rounded ${isSet ? 'bg-chip-good-bg text-chip-good-fg' : 'bg-chip-neutral-bg text-chip-neutral-fg'}`}>
          {isSet ? 'set' : 'not set'}
        </span>
      </div>
      {isSet && (isVideo ? (
        <video
          key={rev}
          src={`/api/public/site-media/${mediaSlot}?v=${rev}`}
          muted loop playsInline autoPlay
          className="w-full max-h-64 object-cover rounded-lg border border-lt-hairline bg-black"
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={rev}
          src={`/api/public/site-media/${mediaSlot}?v=${rev}`}
          alt="Current hero poster"
          className="w-full max-h-64 object-cover rounded-lg border border-lt-hairline bg-lt-inner"
        />
      ))}
      <input
        ref={inputs[slot]}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(slot, f); e.target.value = ''; }}
      />
      <div className="flex gap-2">
        <button
          onClick={() => inputs[slot].current?.click()}
          disabled={busy === slot}
          className={`px-3 py-1.5 text-white text-sm font-semibold rounded-lg disabled:opacity-40 transition-colors ${required ? 'bg-amber-600 hover:bg-amber-500' : 'bg-lt-fg hover:bg-black'}`}
        >
          {busy === slot ? 'Uploading…' : isSet ? 'Replace' : 'Upload'}
        </button>
        {clearable && isSet && (
          <button
            onClick={() => clear(clearable, clearLabel || 'video')}
            disabled={busy === slot}
            className="px-3 py-1.5 border border-lt-hairline text-chip-bad-fg text-sm rounded-lg hover:bg-lt-inner transition-colors"
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-lt-fg">Site Settings</h1>
        <p className="text-sm text-lt-fg2 mt-1">Editable page titles and Home hero media for the public marketing site.</p>
      </div>

      {error && <div className="px-4 py-2 rounded-lg bg-chip-bad-bg text-chip-bad-fg text-sm">{error}</div>}

      <div className="bg-lt-card border border-lt-hairline rounded-xl p-5 space-y-4">
        <div>
          <h2 className="font-semibold text-lt-fg">Page titles</h2>
          <p className="text-xs text-lt-fg3 mt-0.5">
            The big headline (H1) at the top of each public page. Leave a field blank to use the built-in default (shown as the placeholder).
          </p>
        </div>
        {TITLE_ROWS.map((row) => (
          <label key={row.key} className="block space-y-1">
            <span className="text-xs font-medium text-lt-fg2">{row.label}</span>
            <input
              type="text"
              value={titleDraft[row.key]}
              onChange={(e) => setTitleDraft((t) => ({ ...t, [row.key]: e.target.value }))}
              placeholder={row.placeholder}
              maxLength={200}
              className="w-full px-3 py-2 rounded-lg border border-lt-hairline bg-lt-inner text-lt-fg text-sm placeholder:text-lt-fg3 focus:outline-none focus:border-amber-600"
            />
          </label>
        ))}
        <div className="flex items-center gap-3">
          <button
            onClick={saveTitles}
            disabled={savingTitles}
            className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold rounded-lg disabled:opacity-40 transition-colors"
          >
            {savingTitles ? 'Saving…' : 'Save titles'}
          </button>
          {titleMsg && <span className="text-xs text-chip-good-fg">{titleMsg}</span>}
        </div>
      </div>

      <Card
        slot="hero-poster" title="Hero poster" required
        desc="JPG fallback + video poster. JPG / PNG / WebP / HEIC, up to 10 MB."
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        isSet={!!settings?.heroPoster} isVideo={false} mediaSlot="hero-poster"
      />
      <Card
        slot="hero-video" title="Hero video"
        desc="Muted autoplay loop over the poster (desktop). MP4 / WebM, up to 50 MB."
        accept="video/mp4,video/webm,video/quicktime"
        isSet={!!settings?.heroVideo} isVideo mediaSlot="hero-video"
        clearable="hero-video" clearLabel="hero video"
      />
      <Card
        slot="hero-video-mobile" title="Hero video · mobile"
        desc="Lighter loop served under ~768px. Falls back to the desktop video if unset. MP4 / WebM, up to 50 MB."
        accept="video/mp4,video/webm,video/quicktime"
        isSet={!!settings?.heroVideoMobile} isVideo mediaSlot="hero-video-mobile"
        clearable="hero-video-mobile" clearLabel="mobile hero video"
      />

      <p className="text-xs text-lt-fg3">
        With no poster set, the Home hero shows the plain dark band. Media changes may take up to an hour to
        propagate through the CDN cache.
      </p>
    </div>
  );
}

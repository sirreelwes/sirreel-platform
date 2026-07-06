'use client';

/**
 * /admin/site-settings — public marketing site config (requireAdmin on
 * every API call). Currently: the Home hero media.
 *
 *   Hero poster image (required) — background + video poster.
 *   Hero loop video (optional)   — muted autoplay loop; poster shows
 *                                  until it plays / if autoplay fails.
 *
 * Both upload to the PRIVATE Blob store and are served publicly through
 * /api/public/site-media/[slot]. Empty state → the Home hero falls back
 * to the plain dark band.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

interface SettingsState {
  heroImage: boolean;
  heroVideo: boolean;
  updatedAt: string | null;
}

export default function SiteSettingsPage() {
  const [settings, setSettings] = useState<SettingsState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Cache-buster so a fresh upload preview reflects the new blob.
  const [rev, setRev] = useState(0);
  const imageInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/site-settings');
      if (res.status === 401 || res.status === 403) {
        setError('Admin access required.');
        return;
      }
      const data = await res.json();
      setSettings(data);
      setError(null);
    } catch {
      setError('Failed to load settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const upload = async (slot: 'hero-image' | 'hero-video', file: File) => {
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

  const clearVideo = async () => {
    if (!confirm('Remove the hero loop video? The poster image stays.')) return;
    setBusy('hero-video');
    try {
      const res = await fetch('/api/admin/site-settings?slot=hero-video', { method: 'DELETE' });
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
        <h1 className="text-xl font-bold text-lt-fg">Site Settings</h1>
        <p className="text-sm text-lt-fg2 mt-1">
          Home page hero media for the public marketing site.
        </p>
      </div>

      {error && (
        <div className="px-4 py-2 rounded-lg bg-chip-bad-bg text-chip-bad-fg text-sm">{error}</div>
      )}

      {/* Hero poster image (required) */}
      <div className="bg-lt-card border border-lt-hairline rounded-xl p-5 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold text-lt-fg">Hero image <span className="text-chip-bad-fg text-xs align-middle ml-1">required</span></h2>
            <p className="text-xs text-lt-fg3 mt-0.5">Background + video poster. JPG / PNG / WebP / HEIC, up to 10 MB.</p>
          </div>
          <span className={`text-xs px-2 py-1 rounded ${settings?.heroImage ? 'bg-chip-good-bg text-chip-good-fg' : 'bg-chip-neutral-bg text-chip-neutral-fg'}`}>
            {settings?.heroImage ? 'set' : 'not set'}
          </span>
        </div>
        {settings?.heroImage && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/public/site-media/hero-image?v=${rev}`}
            alt="Current hero"
            className="w-full max-h-64 object-cover rounded-lg border border-lt-hairline bg-lt-inner"
          />
        )}
        <input
          ref={imageInput}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) upload('hero-image', f); e.target.value = ''; }}
        />
        <button
          onClick={() => imageInput.current?.click()}
          disabled={busy === 'hero-image'}
          className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold rounded-lg disabled:opacity-40 transition-colors"
        >
          {busy === 'hero-image' ? 'Uploading…' : settings?.heroImage ? 'Replace image' : 'Upload image'}
        </button>
      </div>

      {/* Hero loop video (optional) */}
      <div className="bg-lt-card border border-lt-hairline rounded-xl p-5 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold text-lt-fg">Hero video <span className="text-lt-fg3 text-xs align-middle ml-1">optional</span></h2>
            <p className="text-xs text-lt-fg3 mt-0.5">Muted autoplay loop over the poster. MP4 / WebM, up to 50 MB.</p>
          </div>
          <span className={`text-xs px-2 py-1 rounded ${settings?.heroVideo ? 'bg-chip-good-bg text-chip-good-fg' : 'bg-chip-neutral-bg text-chip-neutral-fg'}`}>
            {settings?.heroVideo ? 'set' : 'not set'}
          </span>
        </div>
        {settings?.heroVideo && (
          <video
            src={`/api/public/site-media/hero-video?v=${rev}`}
            muted
            loop
            playsInline
            autoPlay
            className="w-full max-h-64 object-cover rounded-lg border border-lt-hairline bg-black"
          />
        )}
        <input
          ref={videoInput}
          type="file"
          accept="video/mp4,video/webm,video/quicktime"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) upload('hero-video', f); e.target.value = ''; }}
        />
        <div className="flex gap-2">
          <button
            onClick={() => videoInput.current?.click()}
            disabled={busy === 'hero-video'}
            className="px-3 py-1.5 bg-lt-fg hover:bg-black text-white text-sm font-semibold rounded-lg disabled:opacity-40 transition-colors"
          >
            {busy === 'hero-video' ? 'Uploading…' : settings?.heroVideo ? 'Replace video' : 'Upload video'}
          </button>
          {settings?.heroVideo && (
            <button
              onClick={clearVideo}
              disabled={busy === 'hero-video'}
              className="px-3 py-1.5 border border-lt-hairline text-chip-bad-fg text-sm rounded-lg hover:bg-lt-inner transition-colors"
            >
              Remove
            </button>
          )}
        </div>
      </div>

      <p className="text-xs text-lt-fg3">
        With no image set, the Home hero shows the plain dark band. Media changes may take up to an hour to
        propagate through the CDN cache.
      </p>
    </div>
  );
}

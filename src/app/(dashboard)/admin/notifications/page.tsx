'use client';

/**
 * /admin/notifications — who receives each class of internal HQ
 * notification email (Wes 2026-08-31). One card per channel: the
 * effective recipients as chips, an editor (comma-separated addresses),
 * Save, and "Use default" to drop the override. ADMIN-only (the API
 * enforces requireAdmin).
 *
 * A channel with no override runs on its built-in default; this page
 * makes the audience editable without touching Workspace admin or code.
 *
 * 2026-09-08 (Wes's quiet-down pass):
 *  · Channels are grouped and badged by TIER. 'Needs action' means
 *    somebody other than Wes has to do something and email is how they
 *    find out; 'Wes only' is awareness. The tier's reason is printed on
 *    the card so the next person to widen a list has to argue with it.
 *  · A banner offers "Reset all to defaults" when any channel is still
 *    on a custom list. The pass changed the DEFAULTS — an override saved
 *    before it silently keeps the old, wider audience, and the card
 *    would read "Custom" without saying it is the loud version.
 *  · Page chrome uses the lt-* light tokens. The title and intro were
 *    text-white / text-zinc-400 sitting directly on the shell's cream
 *    <main> — present, selectable, unreadable. The channel CARDS stay
 *    dark: they paint their own opaque bg-zinc-900, which is the one
 *    case CLAUDE.md allows.
 */

import { useEffect, useState } from 'react';

type Tier = 'desk' | 'owner';

interface Channel {
  key: string;
  label: string;
  description: string;
  tier: Tier;
  tierReason: string;
  defaults: string[];
  effective: string[];
  overridden: boolean;
  updatedAt: string | null;
  updatedByEmail: string | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseEmails(input: string): { valid: string[]; invalid: string[] } {
  const valid: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const raw of input.split(/[,\n;]/)) {
    const e = raw.trim();
    if (!e) continue;
    if (!EMAIL_RE.test(e)) { invalid.push(e); continue; }
    const norm = e.toLowerCase();
    if (seen.has(norm)) continue;
    seen.add(norm);
    valid.push(e);
  }
  return { valid, invalid };
}

export default function AdminNotificationsPage() {
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [overriddenCount, setOverriddenCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // key → draft text while that channel's editor is open; absent = closed.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const load = async () => {
    setError(null);
    try {
      const r = await fetch('/api/admin/notification-channels', { cache: 'no-store' });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) { setError(json?.error || `HTTP ${r.status}`); return; }
      setChannels(json.channels);
      setOverriddenCount(json.overriddenCount ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'load failed');
    }
  };

  useEffect(() => { void load(); }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  // Clears every override so the built-in defaults apply again. Guarded
  // by a confirm because it is the one action here that touches channels
  // the admin is not looking at.
  const resetAll = async () => {
    if (busy) return;
    if (!confirm(
      `Drop the custom recipient list on ${overriddenCount} channel${overriddenCount === 1 ? '' : 's'} ` +
      `and put every channel back on its built-in default? Each change is written to the audit log.`,
    )) return;
    setBusy('__all__');
    try {
      const r = await fetch('/api/admin/notification-channels', { method: 'DELETE' });
      const json = await r.json().catch(() => ({}));
      if (!r.ok || json?.ok === false) {
        setToast({ kind: 'err', msg: json?.error || `HTTP ${r.status}` });
        return;
      }
      setDrafts({});
      setToast({ kind: 'ok', msg: `${json.cleared} channel${json.cleared === 1 ? '' : 's'} back to default.` });
      await load();
    } finally {
      setBusy(null);
    }
  };

  const save = async (ch: Channel, body: { emails: string[] } | { reset: true }) => {
    if (busy) return;
    setBusy(ch.key);
    try {
      const r = await fetch('/api/admin/notification-channels', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: ch.key, ...body }),
      });
      const json = await r.json().catch(() => ({}));
      if (!r.ok || json?.ok === false) {
        setToast({ kind: 'err', msg: json?.error || `HTTP ${r.status}` });
        return;
      }
      setDrafts((d) => { const n = { ...d }; delete n[ch.key]; return n; });
      setToast({ kind: 'ok', msg: 'reset' in body ? `${ch.label} back to default.` : `${ch.label} saved.` });
      await load();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-xl font-bold text-lt-fg">Notification recipients</h1>
      <p className="text-[13px] text-lt-fg2 mt-1">
        Who receives each class of internal HQ email. A channel on its{' '}
        <span className="text-lt-fg">default</span> follows the built-in audience below; a{' '}
        <span className="text-lt-fg">custom</span> list set here replaces it entirely and takes
        effect immediately, no deploy. An empty list silences a channel.
      </p>
      <p className="text-[13px] text-lt-fg3 mt-2">
        Since 8 Sep 2026 the defaults are deliberately narrow:{' '}
        <strong className="text-lt-fg2">Needs action</strong> channels reach the desk that has to
        do something about them, and everything else goes to Wes alone. Adding a name to a{' '}
        <strong className="text-lt-fg2">Wes only</strong> channel puts that person back on a feed
        somebody decided they did not need — the reason is on each card.
      </p>

      {error && (
        <div className="mt-4 text-xs bg-chip-bad-bg text-chip-bad-fg border border-lt-hairline rounded px-3 py-2">
          {error}
        </div>
      )}
      {toast && (
        <div
          className={`mt-4 rounded-lg border px-3 py-2 text-sm ${
            toast.kind === 'ok'
              ? 'border-lt-hairline bg-chip-good-bg text-chip-good-fg'
              : 'border-lt-hairline bg-chip-bad-bg text-chip-bad-fg'
          }`}
        >
          {toast.msg}
        </div>
      )}

      {!channels && !error && <p className="mt-6 text-sm text-lt-fg3">Loading…</p>}

      {overriddenCount > 0 && (
        <div className="mt-4 rounded-lg border border-lt-hairline bg-chip-warn-bg text-chip-warn-fg px-3 py-2.5">
          <p className="text-[13px] font-semibold">
            {overriddenCount} channel{overriddenCount === 1 ? ' is' : 's are'} on a custom list.
          </p>
          <p className="text-[12px] mt-1">
            A custom list is the whole audience, so it ignores the built-in default — including the
            narrower defaults set on 8 Sep 2026. If one of these was saved before then it is still
            mailing the wider group it was given at the time.
          </p>
          <button
            onClick={resetAll}
            disabled={busy !== null}
            className="mt-2 px-3 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-[12px] font-bold rounded-lg"
          >
            {busy === '__all__' ? 'Resetting…' : 'Reset all to defaults'}
          </button>
        </div>
      )}

      <div className="mt-5 space-y-4">
        {channels?.map((ch) => {
          const draft = drafts[ch.key];
          const editing = draft !== undefined;
          const parsed = editing ? parseEmails(draft) : null;
          const isBusy = busy === ch.key;
          return (
            <div key={ch.key} className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-sm font-semibold text-white">{ch.label}</h2>
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${
                        ch.tier === 'desk'
                          ? 'bg-sky-900/40 text-sky-300 border-sky-800'
                          : 'bg-zinc-800 text-zinc-400 border-zinc-700'
                      }`}
                      title={ch.tierReason}
                    >
                      {ch.tier === 'desk' ? 'Needs action' : 'Wes only'}
                    </span>
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${
                        ch.overridden
                          ? 'bg-amber-900/40 text-amber-300 border-amber-800'
                          : 'bg-zinc-800 text-zinc-400 border-zinc-700'
                      }`}
                    >
                      {ch.overridden ? 'Custom' : 'Default'}
                    </span>
                  </div>
                  <p className="text-[12px] text-zinc-500 mt-1">{ch.description}</p>
                  {/* Why this tier — the argument anyone widening the list
                      has to answer, kept next to the Edit button on purpose. */}
                  <p className="text-[12px] text-zinc-400 mt-1.5 italic">{ch.tierReason}</p>
                </div>
                {!editing && (
                  <button
                    onClick={() => setDrafts((d) => ({ ...d, [ch.key]: ch.effective.join(', ') }))}
                    className="flex-none text-[11px] font-semibold text-amber-300 hover:text-amber-200 px-2 py-1 rounded hover:bg-amber-900/20"
                  >
                    Edit
                  </button>
                )}
              </div>

              {/* Effective recipients */}
              {!editing && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {ch.effective.length === 0 ? (
                    <span className="text-[12px] text-zinc-500 italic">
                      Nobody — this channel is silenced.
                    </span>
                  ) : (
                    ch.effective.map((e) => (
                      <span
                        key={e}
                        className="text-[12px] font-mono text-zinc-200 bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5"
                      >
                        {e}
                      </span>
                    ))
                  )}
                </div>
              )}

              {editing && (
                <div className="mt-3 space-y-2">
                  <textarea
                    value={draft}
                    onChange={(e) => setDrafts((d) => ({ ...d, [ch.key]: e.target.value }))}
                    rows={2}
                    autoFocus
                    spellCheck={false}
                    placeholder="name@sirreel.com, second@sirreel.com — empty list = nobody"
                    className={`w-full bg-zinc-800 border rounded px-2 py-1.5 text-sm text-white font-mono placeholder:text-zinc-500 placeholder:font-sans focus:outline-none resize-y ${
                      parsed && parsed.invalid.length > 0
                        ? 'border-rose-700 focus:border-rose-500'
                        : 'border-zinc-700 focus:border-zinc-500'
                    }`}
                  />
                  {parsed && parsed.invalid.length > 0 && (
                    <div className="text-[11px] text-rose-300">
                      Not a valid address: {parsed.invalid.join(', ')} — separate addresses with commas.
                    </div>
                  )}
                  {parsed && parsed.invalid.length === 0 && parsed.valid.length === 0 && (
                    <div className="text-[11px] text-amber-300">
                      Empty list — saving silences this channel entirely.
                    </div>
                  )}
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={() => parsed && save(ch, { emails: parsed.valid })}
                      disabled={isBusy || !parsed || parsed.invalid.length > 0}
                      className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-[12px] font-bold rounded-lg"
                    >
                      {isBusy ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      onClick={() => setDrafts((d) => { const n = { ...d }; delete n[ch.key]; return n; })}
                      disabled={isBusy}
                      className="px-3 py-1.5 text-zinc-400 hover:text-white text-[12px] font-medium disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    {ch.overridden && (
                      <button
                        onClick={() => save(ch, { reset: true })}
                        disabled={isBusy}
                        title={`Back to: ${ch.defaults.join(', ') || 'nobody'}`}
                        className="ml-auto text-[11px] text-zinc-500 hover:text-zinc-300 underline-offset-2 hover:underline disabled:opacity-50"
                      >
                        Use default ({ch.defaults.join(', ') || 'nobody'})
                      </button>
                    )}
                  </div>
                </div>
              )}

              {ch.overridden && ch.updatedAt && !editing && (
                <div className="mt-2 text-[11px] text-zinc-600">
                  Changed {new Date(ch.updatedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  {ch.updatedByEmail ? ` by ${ch.updatedByEmail}` : ''}
                  {' · default: '}
                  <span className="font-mono">{ch.defaults.join(', ') || 'nobody'}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-6 text-[11px] text-zinc-600">
        Group addresses (hq@, rentals@) keep fanning out through Google Workspace — editing a
        channel here changes which addresses HQ sends to, not who is inside a group. Every change
        is audit-logged.
      </p>
    </div>
  );
}

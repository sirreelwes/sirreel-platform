'use client';

/**
 * /fleet/paperwork — drop a folder of BIT inspections and vehicle
 * registrations, confirm what matched, file it.
 *
 * Julian keeps these as scans; the per-unit panel takes one at a time through
 * a modal you open per truck, which for the fleet is ~160 documents and
 * therefore a job that never gets done. This is the door for the folder.
 *
 * REVIEW BEFORE WRITE, always. The proposal is a guess off the filename and a
 * wrong one files Cargo 25's registration onto Cargo 2 — a client then
 * downloads a document with the wrong plate and nobody finds out until an
 * officer does. So nothing is written until a person has seen the row, and
 * any row the rules could not resolve stays visibly unfiled rather than being
 * guessed at.
 */

import { useState, useRef } from 'react';
import Link from 'next/link';
import { AlertTriangle, Check, Upload } from 'lucide-react';
import { SurfaceGuard } from '@/components/shared/SurfaceGuard';

type Unit = { id: string; unitName: string };
type Row = {
  index: number;
  filename: string;
  unitId: string | null;
  unitName: string | null;
  candidates: Unit[];
  kind: 'registration' | 'bit-certificate' | null;
  inspectionDate: string | null;
  expiresAt: string | null;
  problems: string[];
  ready: boolean;
};
type Correction = { index: number; unitId?: string | null; kind?: string | null; inspectionDate?: string | null; expiresAt?: string | null; skip?: boolean };
type Filed = { index: number; filename: string; unitName: string; kind: string; isCurrent?: boolean; expiresAt?: string | null };
type Skipped = { index: number; filename: string; why: string };

const PROBLEM_TEXT: Record<string, string> = {
  'no-unit': 'Which unit?',
  'many-units': 'Names more than one unit',
  'no-kind': 'Registration or BIT?',
  'needs-date': 'Inspection date?',
  'not-pdf': 'Not a PDF',
};

function FleetPaperworkInner() {
  const [files, setFiles] = useState<File[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [summary, setSummary] = useState('');
  const [fixes, setFixes] = useState<Record<number, Correction>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ filed: Filed[]; skipped: Skipped[] } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [bulkExpiry, setBulkExpiry] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  /**
   * A drop can carry loose files OR a folder. Gmail's "Download all
   * attachments" gives a zip that unzips to a folder, and asking someone to
   * then select forty files in a picker is the kind of step that sends them
   * back to doing it one at a time. So directories are walked.
   *
   * webkitGetAsEntry is the only way to see INSIDE a dropped folder;
   * dataTransfer.files is empty for one. Every browser we care about has it,
   * and the plain file list is the fallback when it is missing.
   */
  async function filesFromDrop(dt: DataTransfer): Promise<File[]> {
    const entries = Array.from(dt.items || [])
      .map((i) => (typeof i.webkitGetAsEntry === 'function' ? i.webkitGetAsEntry() : null))
      .filter(Boolean) as FileSystemEntry[];
    if (entries.length === 0) return Array.from(dt.files ?? []);

    const out: File[] = [];
    const walk = async (entry: FileSystemEntry): Promise<void> => {
      if (entry.isFile) {
        const f = await new Promise<File | null>((res) =>
          (entry as FileSystemFileEntry).file(res, () => res(null)),
        );
        // macOS leaves .DS_Store and ._ resource forks in every folder; they
        // would each take a row in the table and say "Not a PDF".
        if (f && !f.name.startsWith('.') && !f.name.startsWith('._')) out.push(f);
        return;
      }
      if (entry.isDirectory) {
        const reader = (entry as FileSystemDirectoryEntry).createReader();
        // readEntries returns at most ~100 at a time and must be called until
        // it comes back empty — a folder of 160 scans truncates otherwise.
        for (;;) {
          const batch = await new Promise<FileSystemEntry[]>((res) => reader.readEntries(res, () => res([])));
          if (batch.length === 0) break;
          for (const e of batch) await walk(e);
        }
      }
    };
    for (const e of entries) await walk(e);
    return out;
  }

  function accept(list: File[]) {
    if (list.length === 0) { setError('Nothing in that drop — try the files themselves, or the folder they are in.'); return; }
    if (list.length > 60) {
      setError(`${list.length} files at once; the cap is 60. Drop them in a couple of batches.`);
      return;
    }
    setFiles(list);
    plan(list);
  }

  // The plan pass sends NAMES ONLY. The table re-plans on every dropdown
  // change, and re-uploading 60 scans per correction would make the screen
  // unusable — the bytes go up once, at commit.
  const namesOf = (list: File[]) =>
    list.map((f) => ({ filename: f.name, isPdf: f.type === 'application/pdf' || /\.pdf$/i.test(f.name) }));

  async function planFor(list: File[], next: Record<number, Correction>) {
    const res = await fetch('/api/fleet/documents/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: namesOf(list), corrections: Object.values(next) }),
    });
    const d = await res.json();
    if (!res.ok || !d.ok) throw new Error(d.error || `Couldn't read those files (${res.status})`);
    return d;
  }

  async function plan(list: File[]) {
    setBusy(true); setError(null); setResult(null); setRows(null); setFixes({});
    try {
      const d = await planFor(list, {});
      setUnits(d.units || []); setRows(d.rows || []); setSummary(d.summary || '');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  // Re-plan on the server after an edit, so the readiness the operator sees is
  // the server's own reading and not a second opinion computed in the browser.
  async function replan(next: Record<number, Correction>) {
    setFixes(next);
    try {
      const d = await planFor(files, next);
      setRows(d.rows || []); setSummary(d.summary || '');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const edit = (index: number, patch: Partial<Correction>) =>
    replan({ ...fixes, [index]: { ...(fixes[index] ?? { index }), index, ...patch } });

  /**
   * Typing eighty expiry dates one at a time is its own reason not to bother,
   * and a terminal's BIT sweep really does put the same date on a whole batch.
   * Only fills rows that are BLANK — it can never quietly overwrite a date
   * somebody already looked up.
   */
  function fillBlankExpiries(kind: 'registration' | 'bit-certificate') {
    if (!bulkExpiry || !rows) return;
    const next = { ...fixes };
    let touched = 0;
    for (const r of rows) {
      if (r.kind !== kind || r.expiresAt) continue;
      next[r.index] = { ...(next[r.index] ?? { index: r.index }), index: r.index, expiresAt: bulkExpiry };
      touched++;
    }
    if (touched > 0) replan(next);
  }

  async function commit() {
    setBusy(true); setError(null);
    try {
      const fd = new FormData();
      fd.append('mode', 'commit');
      for (const f of files) fd.append('files', f);
      fd.append('corrections', JSON.stringify(Object.values(fixes)));
      const res = await fetch('/api/fleet/documents/bulk', { method: 'POST', body: fd });
      const d = await res.json();
      if (!res.ok || !d.ok) { setError(d.error || `Filing failed (${res.status})`); return; }
      setResult({ filed: d.filed || [], skipped: d.skipped || [] });
      setRows(null); setFiles([]);
      if (inputRef.current) inputRef.current.value = '';
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  const readyCount = rows?.filter((r) => r.ready && !fixes[r.index]?.skip).length ?? 0;
  const sel = 'border border-gray-200 rounded px-2 py-1 text-[11px] bg-white focus:outline-none focus:border-gray-400';

  return (
    <div className="max-w-5xl">
      <div className="mb-4">
        <Link href="/fleet" className="text-[11px] text-gray-400 hover:text-gray-700">← Fleet</Link>
        <h1 className="text-lg font-bold text-gray-900 mt-1">Upload DOT paperwork</h1>
        <p className="text-[11px] text-gray-500 mt-0.5 max-w-2xl">
          Drop a folder of registrations and BIT inspection scans. Each file is matched to a unit by its
          name — check the list before filing. The second date on each row is when the document expires:
          optional, but it is what drives the 30-day renewal alert. Anything filed here reaches the
          client&apos;s portal for jobs that unit is on.
        </p>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={async (e) => {
          e.preventDefault();
          setDragging(false);
          setError(null);
          accept(await filesFromDrop(e.dataTransfer));
        }}
        className={`rounded-xl border-2 border-dashed p-6 mb-4 text-center transition-colors ${
          dragging ? 'border-gray-900 bg-gray-50' : 'border-gray-200 bg-white'
        }`}
      >
        <Upload size={20} aria-hidden className="mx-auto text-gray-300" />
        <div className="text-[13px] font-semibold text-gray-800 mt-2">
          Drop the scans here — loose files or a whole folder
        </div>
        <p className="text-[11px] text-gray-500 mt-1">
          Save the attachments out of Julian&apos;s email first. Gmail&apos;s &ldquo;Download all
          attachments&rdquo; gives you a zip — unzip it and drop the folder in.
        </p>
        <button
          onClick={() => inputRef.current?.click()}
          className="mt-3 border border-gray-200 hover:border-gray-400 rounded-lg px-3 py-1.5 text-[11px] font-semibold text-gray-700"
        >
          or choose files…
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          multiple
          onChange={(e) => { setError(null); accept(Array.from(e.target.files ?? [])); }}
          className="hidden"
        />
        <p className="text-[10px] text-gray-400 mt-3">
          PDFs, up to 60 at a time. Names like <span className="font-mono">Cube 27 registration.pdf</span> or{' '}
          <span className="font-mono">Cargo 22 BIT 2026-04-30.pdf</span> match on their own; anything else you
          pick from a list.
        </p>
      </div>

      {busy && <div className="text-[12px] text-gray-500 mb-3">Working…</div>}
      {error && (
        <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-[12px] text-rose-800 mb-3">{error}</div>
      )}

      {result && (
        <div className="rounded-xl border border-gray-200 bg-white p-4 mb-4">
          <div className="text-[13px] font-semibold text-emerald-700 inline-flex items-center gap-1.5">
            <Check size={14} aria-hidden />
            Filed {result.filed.length} document{result.filed.length === 1 ? '' : 's'}
          </div>
          <ul className="mt-2 text-[11px] text-gray-600 space-y-0.5 max-h-56 overflow-y-auto">
            {result.filed.map((f) => (
              <li key={f.index}>
                <span className="font-semibold text-gray-800">{f.unitName}</span> —{' '}
                {f.kind === 'registration' ? 'registration' : 'BIT inspection'}
                {f.expiresAt ? <span className="text-gray-400"> · expires {f.expiresAt}</span> : null}
                {f.kind === 'bit-certificate' && f.isCurrent === false && (
                  <span className="text-gray-400"> · filed to history, a newer certificate is still current (any expiry you typed belongs to that one, not this)</span>
                )}
                <span className="text-gray-400"> · {f.filename}</span>
              </li>
            ))}
          </ul>
          {result.skipped.length > 0 && (
            <div className="mt-3 rounded border border-amber-300 bg-amber-50 px-2.5 py-2">
              <div className="text-[11px] font-semibold text-amber-900">
                {result.skipped.length} not filed — nothing was written for these:
              </div>
              <ul className="mt-1 text-[11px] text-amber-900 space-y-0.5">
                {result.skipped.map((s) => (
                  <li key={s.index}><span className="font-mono">{s.filename}</span> — {s.why}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-[10px] text-gray-400 mt-3">
            Anything filed without an expiry reads &ldquo;on file · no expiry recorded&rdquo; and raises no
            renewal alert — add the date on the unit&apos;s panel in Fleet whenever you have it.
          </p>
        </div>
      )}

      {rows && rows.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
            <div className="text-[12px] font-semibold text-gray-800">{summary}</div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] text-gray-400">Fill blank expiries:</span>
              <input
                type="date"
                value={bulkExpiry}
                onChange={(e) => setBulkExpiry(e.target.value)}
                className={sel}
                aria-label="Expiry date to apply"
              />
              <button
                onClick={() => fillBlankExpiries('registration')}
                disabled={!bulkExpiry}
                className="border border-gray-200 hover:border-gray-400 disabled:opacity-40 rounded px-2 py-1 text-[10px] font-semibold text-gray-700"
              >
                → registrations
              </button>
              <button
                onClick={() => fillBlankExpiries('bit-certificate')}
                disabled={!bulkExpiry}
                className="border border-gray-200 hover:border-gray-400 disabled:opacity-40 rounded px-2 py-1 text-[10px] font-semibold text-gray-700"
              >
                → BITs
              </button>
            </div>
            <button
              onClick={commit}
              disabled={busy || readyCount === 0}
              className="bg-gray-900 hover:bg-black disabled:bg-gray-300 text-white text-[12px] font-semibold px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5"
            >
              <Upload size={12} aria-hidden />
              File {readyCount} document{readyCount === 1 ? '' : 's'}
            </button>
          </div>

          <div className="divide-y divide-gray-100">
            {rows.map((r) => {
              const skip = !!fixes[r.index]?.skip;
              return (
                <div key={r.index} className={`px-4 py-2.5 ${skip ? 'opacity-40' : ''}`}>
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] font-mono text-gray-700 truncate">{r.filename}</div>
                      {r.ready ? (
                        <div className="text-[10px] text-emerald-600 font-semibold mt-0.5 inline-flex items-center gap-1">
                          <Check size={10} aria-hidden />
                          {r.unitName} · {r.kind === 'registration' ? 'Registration' : `BIT ${r.inspectionDate}`}
                          {r.expiresAt ? ` · expires ${r.expiresAt}` : ' · no expiry'}
                        </div>
                      ) : (
                        <div className="text-[10px] text-amber-700 font-semibold mt-0.5 inline-flex items-center gap-1">
                          <AlertTriangle size={10} aria-hidden />
                          {r.problems.map((p) => PROBLEM_TEXT[p] ?? p).join(' · ')}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      <select
                        value={r.unitId ?? ''}
                        onChange={(e) => edit(r.index, { unitId: e.target.value || null })}
                        className={sel}
                      >
                        <option value="">— pick a unit —</option>
                        {/* Candidates first when the name was ambiguous: the
                            answer is almost certainly one of the two. */}
                        {r.candidates.length > 0 && (
                          <optgroup label="Named in this file">
                            {r.candidates.map((c) => <option key={c.id} value={c.id}>{c.unitName}</option>)}
                          </optgroup>
                        )}
                        <optgroup label="All units">
                          {units.map((u) => <option key={u.id} value={u.id}>{u.unitName}</option>)}
                        </optgroup>
                      </select>

                      <select
                        value={r.kind ?? ''}
                        onChange={(e) => edit(r.index, { kind: e.target.value || null })}
                        className={sel}
                      >
                        <option value="">— kind —</option>
                        <option value="registration">Registration</option>
                        <option value="bit-certificate">BIT inspection</option>
                      </select>

                      {r.kind === 'bit-certificate' && (
                        <input
                          type="date"
                          value={r.inspectionDate ?? ''}
                          onChange={(e) => edit(r.index, { inspectionDate: e.target.value || null })}
                          className={`${sel} ${r.inspectionDate ? '' : 'border-amber-400'}`}
                          title="Inspected on (required)"
                        />
                      )}

                      {/* Optional — a document with no expiry is still the
                          document the client needs; the blank only costs the
                          30-day renewal alert. Never guessed from the
                          filename: the date in a BIT filename is the day it
                          was inspected, not the day it runs out. */}
                      {r.kind && (
                        <input
                          type="date"
                          value={r.expiresAt ?? ''}
                          onChange={(e) => edit(r.index, { expiresAt: e.target.value || null })}
                          className={sel}
                          title="Expires on (optional — drives the renewal alert)"
                          placeholder="expires"
                        />
                      )}

                      <label className="text-[10px] text-gray-500 inline-flex items-center gap-1">
                        <input type="checkbox" checked={skip} onChange={(e) => edit(r.index, { skip: e.target.checked })} />
                        Skip
                      </label>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default function FleetPaperworkPage() {
  return (
    <SurfaceGuard need="fleet" label="Fleet">
      <FleetPaperworkInner />
    </SurfaceGuard>
  );
}

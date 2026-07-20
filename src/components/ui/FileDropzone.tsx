'use client';

import { useRef, useState } from 'react';

/**
 * Drag-and-drop (or click-to-browse) file picker. Controlled: the parent
 * owns the File in state and reads it at submit — no ref reaching into a
 * hidden input. Used by the COI upload + agreement modals.
 */
export function FileDropzone({
  file,
  onFile,
  accept = 'application/pdf,.pdf',
  hint = 'PDF, up to 25 MB',
  compact = false,
}: {
  file: File | null;
  onFile: (f: File | null) => void;
  accept?: string;
  hint?: string;
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const pick = (f: File | null | undefined) => onFile(f ?? null);

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!dragging) setDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          pick(e.dataTransfer.files?.[0]);
        }}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed text-center transition-colors ${
          compact ? 'px-3 py-3' : 'px-4 py-6'
        } ${
          dragging
            ? 'border-amber-500 bg-amber-500/10'
            : file
              ? 'border-emerald-700/60 bg-emerald-500/[0.06]'
              : 'border-zinc-700 bg-zinc-800/40 hover:border-zinc-600 hover:bg-zinc-800/70'
        }`}
      >
        {file ? (
          <>
            <div className="flex items-center gap-2 text-sm text-emerald-300">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
              <span className="max-w-[16rem] truncate font-medium">{file.name}</span>
            </div>
            <div className="mt-1 text-[11px] text-zinc-500">
              {(file.size / 1024 / 1024).toFixed(2)} MB ·{' '}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onFile(null);
                  if (inputRef.current) inputRef.current.value = '';
                }}
                className="text-amber-400 hover:text-amber-300 underline underline-offset-2"
              >
                remove
              </button>
            </div>
          </>
        ) : (
          <>
            <svg className={`text-zinc-500 ${compact ? 'mb-1' : 'mb-1.5'}`} width={compact ? 18 : 22} height={compact ? 18 : 22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
            <div className="text-sm text-zinc-300">
              <span className="font-semibold text-amber-400">Drag &amp; drop</span> a file, or <span className="font-semibold text-amber-400">browse</span>
            </div>
            <div className="mt-0.5 text-[11px] text-zinc-500">{hint}</div>
          </>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => pick(e.target.files?.[0])}
      />
    </div>
  );
}

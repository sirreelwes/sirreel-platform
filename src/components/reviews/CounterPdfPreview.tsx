'use client';

interface CounterPdfPreviewProps {
  reviewId: string;
  generatedAt: string | null;
  generatedBy: { name: string } | null;
  /** Cache-buster: bump after regenerate so the iframe re-fetches. */
  cacheKey: string | number;
  onRegenerate: () => void;
  regenerating: boolean;
  canRegenerate: boolean;
}

function fmtDateTime(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function CounterPdfPreview({
  reviewId,
  generatedAt,
  generatedBy,
  cacheKey,
  onRegenerate,
  regenerating,
  canRegenerate,
}: CounterPdfPreviewProps) {
  const src = `/api/tools/contract-review/${reviewId}/counter-pdf?v=${cacheKey}`;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-[11px] text-gray-600">
          Generated {fmtDateTime(generatedAt)}
          {generatedBy && <> by <span className="font-semibold">{generatedBy.name}</span></>}
        </div>
        <div className="flex items-center gap-2">
          <a
            href={src}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] font-semibold text-gray-500 hover:text-gray-900"
          >
            Open in new tab ↗
          </a>
          <a
            href={src}
            download
            className="text-[11px] font-semibold text-gray-500 hover:text-gray-900"
          >
            Download
          </a>
          <button
            onClick={onRegenerate}
            disabled={regenerating || !canRegenerate}
            className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:bg-gray-200 disabled:text-gray-400 text-white text-[11px] font-bold rounded-lg"
            title={canRegenerate ? '' : 'Resolve all pending decisions before regenerating'}
          >
            {regenerating ? 'Regenerating…' : 'Regenerate'}
          </button>
        </div>
      </div>
      <iframe
        src={src}
        className="w-full h-[600px] rounded-lg border border-gray-100 bg-gray-50"
        title="Counter PDF"
      />
    </div>
  );
}

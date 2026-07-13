'use client'

import { TSX } from '@/lib/brand/tsxTokens'
import type { V2CardStatus } from './types'

/**
 * CardShell — the stacked document card of the v2 guided portal.
 * Collapsed: icon + title + glanceable status chip + one-tap action.
 * Expanded: renders the wrapped signing/upload flow (children).
 */

const STATUS_META: Record<V2CardStatus, { label: string; chip: string; dot: string }> = {
  todo: { label: 'Action needed', chip: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' },
  pending: { label: 'Pending review', chip: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-400' },
  attention: { label: 'Needs attention', chip: 'bg-red-50 text-red-600 border-red-200', dot: 'bg-red-500' },
  done: { label: 'Complete', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  locked: { label: 'Read-only', chip: 'bg-gray-100 text-gray-500 border-gray-200', dot: 'bg-gray-400' },
}

export function ContextChip({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border"
      style={{ borderColor: TSX.gold, color: '#8a6a1f', backgroundColor: 'rgba(212,165,71,0.10)' }}
    >
      {children}
    </span>
  )
}

export function CardShell({
  icon,
  title,
  subtitle,
  status,
  statusLabel,
  chips,
  open,
  onToggle,
  actionLabel = 'Start',
  children,
}: {
  icon: string
  title: string
  subtitle?: string
  status: V2CardStatus
  /** Override the default chip label (e.g. "Accepted", "Signed"). */
  statusLabel?: string
  chips?: React.ReactNode
  open: boolean
  onToggle: () => void
  actionLabel?: string
  children: React.ReactNode
}) {
  const meta = STATUS_META[status]
  return (
    <div className={`bg-white rounded-2xl border transition-all ${open ? 'border-gray-300 shadow-sm' : 'border-gray-200'}`}>
      <button type="button" onClick={onToggle} className="w-full flex items-center gap-3 p-4 text-left">
        <div
          className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0 ${
            status === 'done' ? 'bg-emerald-50' : 'bg-gray-50'
          }`}
        >
          {status === 'done' ? '✓' : icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-gray-900">{title}</span>
            {chips}
          </div>
          {subtitle && <div className="text-[11px] text-gray-400 mt-0.5 truncate">{subtitle}</div>}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-bold uppercase tracking-wide ${meta.chip}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
            {statusLabel || meta.label}
          </span>
          {status === 'todo' && !open && (
            <span
              className="hidden sm:inline-flex px-3 py-1.5 rounded-lg text-[11px] font-bold text-white"
              style={{ backgroundColor: TSX.ink }}
            >
              {actionLabel}
            </span>
          )}
          <span className={`text-gray-300 text-xs transition-transform ${open ? 'rotate-180' : ''}`}>▼</span>
        </div>
      </button>
      {open && <div className="px-4 pb-4 border-t border-gray-100 pt-4">{children}</div>}
    </div>
  )
}

export function DoneNote({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center">
      <div className="text-2xl mb-1">✅</div>
      <div className="text-emerald-800 font-bold text-sm">{title}</div>
      {sub && <div className="text-emerald-600 text-xs mt-0.5">{sub}</div>}
    </div>
  )
}

export function LockedNote({ title }: { title: string }) {
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-center">
      <div className="text-2xl mb-1">🔒</div>
      <div className="font-bold text-sm text-gray-800">{title} — Locked</div>
      <div className="text-xs mt-0.5 text-gray-500">This rental has been confirmed. Documents are read-only.</div>
    </div>
  )
}

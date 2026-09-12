import Link from 'next/link'
import { Tag } from 'lucide-react'

/**
 * The one "Print barcodes" button, for every warehouse screen (Wes
 * 2026-09-12: "make a button for printing barcodes in warehouse section").
 * Lands on /warehouse/labels; pass `itemId` to open it with that catalog
 * item already picked, so a drawer or a line can go straight to minting.
 */
export function PrintBarcodesButton({
  itemId,
  compact = false,
  className = '',
}: { itemId?: string; compact?: boolean; className?: string }) {
  const href = itemId ? `/warehouse/labels?item=${encodeURIComponent(itemId)}` : '/warehouse/labels'
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-1.5 font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white whitespace-nowrap ${
        compact ? 'text-[13px] px-2.5 py-1.5' : 'text-[14px] px-3 py-2.5'
      } ${className}`}
    >
      <Tag size={compact ? 13 : 15} aria-hidden />
      Print barcodes
    </Link>
  )
}

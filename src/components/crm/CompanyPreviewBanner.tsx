/**
 * The strip above an account-portal preview: where you are, who you are
 * looking as, and the way back. Same shape as the vendor / driver preview
 * banners on /crm/portals/preview/*.
 */

import Link from 'next/link'
import { ArrowLeft, Eye } from 'lucide-react'

export function CompanyPreviewBanner({
  companyId,
  companyName,
  currentAccessId,
  personas,
  jobHref,
}: {
  companyId: string
  companyName: string
  currentAccessId: string | null
  personas: { accessId: string; name: string; label: string }[]
  /** Set on the job sub-page so the persona switch keeps the job open. */
  jobHref?: string | null
}) {
  const base = jobHref ?? `/crm/portals/preview/company/${companyId}`
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Link href="/crm/portals#company" className="inline-flex items-center gap-1.5 text-sm text-lt-fg2 hover:text-lt-fg">
          <ArrowLeft className="w-4 h-4" /> Portals
        </Link>
        <Link href={`/crm/${companyId}`} className="text-sm text-lt-fg2 hover:text-lt-fg">
          Company page →
        </Link>
      </div>
      <div className="rounded-xl border border-amber-300 bg-chip-warn-bg text-chip-warn-fg px-4 py-2.5 text-sm flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="inline-flex items-center gap-2">
          <Eye className="w-4 h-4 shrink-0" />
          <span>
            <strong>Preview</strong> — exactly what <strong>{companyName}</strong> sees in their
            account portal. Buttons are inert here, and this look does not count as them opening it.
          </span>
        </span>
        {personas.length > 1 && (
          <span className="inline-flex items-center gap-1.5 flex-wrap">
            <span className="text-xs opacity-80">Viewing as</span>
            {personas.map((p) => (
              <Link
                key={p.accessId}
                href={`${base}?as=${p.accessId}`}
                className={`text-xs font-semibold px-2 py-0.5 rounded border ${
                  p.accessId === currentAccessId
                    ? 'bg-chip-warn-fg text-white border-chip-warn-fg'
                    : 'border-chip-warn-fg/40 hover:border-chip-warn-fg'
                }`}
                title={p.label}
              >
                {p.name}
              </Link>
            ))}
          </span>
        )}
        {personas.length === 0 && (
          <span className="text-xs opacity-80">Nobody has been granted access yet — shown as a placeholder executive.</span>
        )}
      </div>
    </div>
  )
}

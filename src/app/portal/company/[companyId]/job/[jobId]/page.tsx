/**
 * /portal/company/[companyId]/job/[jobId] — one show's paperwork.
 *
 * The tile on the account page answers "what is this and who's running
 * it"; this answers "show me the invoices and the agreement". Nothing
 * more — see src/lib/portal/companyJobDetail.ts for why the omissions are
 * the point.
 */

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft, BadgeCheck, Download, FileText, Mail, Phone } from 'lucide-react'
import { getCompanyPortalSession } from '@/lib/portal/companyPortal'
import { buildCompanyJobDetail } from '@/lib/portal/companyJobDetail'
import { PORTAL } from '@/lib/brand/portalTokens'

export const dynamic = 'force-dynamic'

function fmtMoney(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function fmtDay(d: Date | null): string {
  if (!d) return '—'
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

const INVOICE_CHIP: Record<string, string> = {
  PAID: 'bg-emerald-100 text-emerald-800',
  SENT: 'bg-amber-100 text-amber-900',
  PARTIAL: 'bg-amber-100 text-amber-900',
  DRAFT: 'bg-zinc-200 text-zinc-700',
}

export default async function CompanyPortalJobPage({
  params,
}: {
  params: { companyId: string; jobId: string }
}) {
  const session = await getCompanyPortalSession(params.companyId)
  // Same door as the company page — see the note there.
  if (!session) redirect(`/portal/company?next=${encodeURIComponent(`/portal/company/${params.companyId}`)}`)

  // companyId comes from the SESSION, not the URL — the two are equal here
  // only because the session resolved against that URL segment.
  const job = await buildCompanyJobDetail(session.companyId, params.jobId)
  if (!job) notFound()

  return (
    <div className="min-h-screen bg-[#F8F7F4]">
      <header className="w-full" style={{ backgroundColor: PORTAL.dark }}>
        <div className="max-w-3xl mx-auto px-6 py-7">
          <Link
            href={`/portal/company/${params.companyId}`}
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-white/60 hover:text-white"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> {session.companyName}
          </Link>
          <div className="mt-3" style={{ width: 48, height: 2, backgroundColor: PORTAL.gold }} />
          <div
            className="mt-3 text-[10px] uppercase font-semibold"
            style={{ color: PORTAL.gold, letterSpacing: '2.5px' }}
          >
            {job.jobCode}
          </div>
          <h1 className="mt-1 text-white text-[28px] font-display leading-tight tracking-tight">
            {job.name}
          </h1>
          <div className="text-xs text-white/60 mt-1">
            {job.startDate || job.endDate
              ? `${fmtDay(job.startDate)} → ${fmtDay(job.endDate)}`
              : 'Dates to be confirmed'}
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8 space-y-8">
        {/* Money at a glance — three numbers, no line items. */}
        <div className="grid grid-cols-3 bg-white border border-zinc-200 rounded-xl divide-x divide-zinc-100">
          <Stat label="Invoiced" value={fmtMoney(job.totals.invoiced)} />
          <Stat label="Paid" value={fmtMoney(job.totals.paid)} />
          <Stat
            label="Balance"
            value={fmtMoney(job.totals.balance)}
            emphasis={job.totals.balance > 0.005}
          />
        </div>

        {/* ── Invoices ─────────────────────────────────────────────────── */}
        <section>
          <h2 className="text-[11px] uppercase font-semibold tracking-[1.6px] text-zinc-500 mb-3">
            Invoices
          </h2>
          {job.invoices.length === 0 ? (
            <div className="bg-white border border-zinc-200 rounded-xl p-5 text-sm text-zinc-500">
              Nothing invoiced on this show yet.
            </div>
          ) : (
            <div className="bg-white border border-zinc-200 rounded-xl divide-y divide-zinc-100">
              {job.invoices.map((inv) => (
                <div key={inv.id} className="p-4 flex items-center justify-between gap-4 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-zinc-500">{inv.invoiceNumber}</span>
                      <span
                        className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                          INVOICE_CHIP[inv.status] || INVOICE_CHIP.DRAFT
                        }`}
                      >
                        {inv.isPreInvoice ? 'For review' : inv.status}
                      </span>
                      {inv.type !== 'RENTAL' && (
                        <span className="text-[10px] text-zinc-500 uppercase">{inv.type}</span>
                      )}
                    </div>
                    <div className="text-xs text-zinc-500 mt-1">
                      Order {inv.orderNumber}
                      {inv.paidAt
                        ? ` · paid ${fmtDay(inv.paidAt)}`
                        : inv.dueDate
                          ? ` · due ${fmtDay(inv.dueDate)}`
                          : inv.sentAt
                            ? ` · sent ${fmtDay(inv.sentAt)}`
                            : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <div className="font-mono text-sm text-zinc-900">{fmtMoney(inv.total)}</div>
                      {inv.balanceDue > 0.005 && (
                        <div className="font-mono text-xs text-amber-800">
                          {fmtMoney(inv.balanceDue)} due
                        </div>
                      )}
                    </div>
                    {inv.hasPdf && (
                      <a
                        href={`/api/portal/company/${params.companyId}/invoice/${inv.id}/pdf`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-semibold text-zinc-700 hover:text-black border border-zinc-300 rounded-lg px-2.5 py-1.5"
                      >
                        <FileText className="w-3.5 h-3.5" /> PDF
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── Agreements ───────────────────────────────────────────────── */}
        <section>
          <h2 className="text-[11px] uppercase font-semibold tracking-[1.6px] text-zinc-500 mb-3">
            Rental agreements
          </h2>
          {job.agreements.length === 0 ? (
            <div className="bg-white border border-zinc-200 rounded-xl p-5 text-sm text-zinc-500">
              No agreement has been issued on this show yet.
            </div>
          ) : (
            <div className="bg-white border border-zinc-200 rounded-xl divide-y divide-zinc-100">
              {job.agreements.map((a) => (
                <div key={a.id} className="p-4 flex items-center justify-between gap-4 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-zinc-900">
                        {a.contractType === 'STAGE_CONTRACT' ? 'Stage contract' : 'Rental agreement'}
                      </span>
                      {a.isSigned ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">
                          <BadgeCheck className="w-3 h-3" /> Signed
                        </span>
                      ) : (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-zinc-200 text-zinc-700">
                          Awaiting signature
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-zinc-500 mt-1">
                      Order {a.orderNumber}
                      {a.signedAt && a.signerName
                        ? ` · signed by ${a.signerName}${a.signerTitle ? `, ${a.signerTitle}` : ''} on ${fmtDay(a.signedAt)}`
                        : ''}
                    </div>
                    {a.coverageNote && (
                      <div className="text-xs text-zinc-500 mt-0.5 italic">{a.coverageNote}</div>
                    )}
                  </div>
                  {a.hasPdf && (
                    <a
                      href={`/api/portal/company/${params.companyId}/agreement/${a.id}/pdf?kind=signed`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-semibold text-zinc-700 hover:text-black border border-zinc-300 rounded-lg px-2.5 py-1.5 shrink-0"
                    >
                      <Download className="w-3.5 h-3.5" /> Signed copy
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── Who's on it ──────────────────────────────────────────────── */}
        <section>
          <h2 className="text-[11px] uppercase font-semibold tracking-[1.6px] text-zinc-500 mb-3">
            Who&apos;s on it
          </h2>
          <div className="bg-white border border-zinc-200 rounded-xl divide-y divide-zinc-100">
            {job.contacts.length === 0 ? (
              <div className="p-5 text-sm text-zinc-500">No contacts recorded on this show.</div>
            ) : (
              job.contacts.map((c, i) => (
                <div key={`${c.email || c.name}-${i}`} className="p-4 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-zinc-900 truncate">
                      {c.name}
                      {c.isLead && (
                        <span className="ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-zinc-900 text-white align-middle">
                          LEAD
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-zinc-500 mt-0.5">{c.role.replace(/_/g, ' ')}</div>
                  </div>
                  <div className="flex items-center gap-3 text-xs shrink-0">
                    {c.email && (
                      <a href={`mailto:${c.email}`} className="text-zinc-600 hover:text-black" title={c.email}>
                        <Mail className="w-4 h-4" />
                      </a>
                    )}
                    {c.phone && (
                      <a href={`tel:${c.phone}`} className="text-zinc-600 hover:text-black" title={c.phone}>
                        <Phone className="w-4 h-4" />
                      </a>
                    )}
                  </div>
                </div>
              ))
            )}
            {job.repName && (
              <div className="p-4 flex items-center justify-between gap-4 bg-zinc-50">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-zinc-900 truncate">{job.repName}</div>
                  <div className="text-xs text-zinc-500 mt-0.5">Your SirReel rep</div>
                </div>
                {job.repEmail && (
                  <a href={`mailto:${job.repEmail}`} className="text-zinc-600 hover:text-black shrink-0">
                    <Mail className="w-4 h-4" />
                  </a>
                )}
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  )
}

function Stat({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="px-4 py-4 min-w-0">
      <div className="text-[10px] uppercase font-semibold tracking-wider text-zinc-400">{label}</div>
      <div
        className={`text-sm font-mono mt-1 truncate ${emphasis ? 'font-semibold text-amber-800' : 'text-zinc-900'}`}
      >
        {value}
      </div>
    </div>
  )
}

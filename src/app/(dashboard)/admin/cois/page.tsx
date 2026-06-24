import Link from 'next/link'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

// Team-facing list of stored COIs so client uploads aren't write-only.
// Shows what each COI is attached to (job / company / inquiry / unattached)
// with a private-blob download. A first cut — richer per-company/job
// surfacing can come later.
export default async function CoiListPage() {
  const cois = await prisma.coiCheck.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: {
      id: true,
      originalFilename: true,
      fileSize: true,
      source: true,
      clientUploaderName: true,
      clientUploaderEmail: true,
      createdAt: true,
      company: { select: { name: true } },
      job: { select: { name: true, jobCode: true } },
      inquiry: { select: { id: true } },
    },
  })

  const attachedLabel = (c: (typeof cois)[number]) =>
    c.job ? `${c.job.name} (${c.job.jobCode})` : c.company ? c.company.name : c.inquiry ? 'Inquiry' : 'Unattached'

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-lt-fg">COIs</h1>
        <p className="text-sm text-lt-fg2 mt-0.5">
          Certificates of Insurance filed in HQ — including client uploads via the COI link.
        </p>
      </div>

      <div className="border border-lt-hairline rounded-lg overflow-x-auto bg-lt-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-lt-hairline text-lt-fg2 text-left text-xs uppercase tracking-wide bg-lt-inner/50">
              <th className="px-3 py-2 font-semibold">File</th>
              <th className="px-3 py-2 font-semibold">Attached to</th>
              <th className="px-3 py-2 font-semibold">Uploaded by</th>
              <th className="px-3 py-2 font-semibold">Source</th>
              <th className="px-3 py-2 font-semibold">Date</th>
              <th className="px-3 py-2 font-semibold"></th>
            </tr>
          </thead>
          <tbody>
            {cois.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-lt-fg3">No COIs filed yet.</td>
              </tr>
            ) : (
              cois.map((c) => {
                const unattached = !c.job && !c.company && !c.inquiry
                return (
                  <tr key={c.id} className="border-b border-lt-hairline/60 last:border-0">
                    <td className="px-3 py-2 text-lt-fg truncate max-w-[260px]" title={c.originalFilename}>
                      {c.originalFilename}
                      <span className="text-lt-fg3 text-xs ml-1">({(c.fileSize / 1024 / 1024).toFixed(1)} MB)</span>
                    </td>
                    <td className="px-3 py-2">
                      <span className={unattached ? 'text-chip-warn-fg' : 'text-lt-fg2'}>{attachedLabel(c)}</span>
                    </td>
                    <td className="px-3 py-2 text-lt-fg2 text-xs">
                      {c.clientUploaderName || c.clientUploaderEmail || '—'}
                    </td>
                    <td className="px-3 py-2 text-lt-fg3 text-xs">{c.source === 'CLIENT_UPLOAD' ? 'Client link' : 'Internal'}</td>
                    <td className="px-3 py-2 text-lt-fg3 text-xs whitespace-nowrap">
                      {c.createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Link
                        href={`/api/coi/download/${c.id}`}
                        className="text-amber-600 hover:text-amber-500 text-xs font-semibold"
                        target="_blank"
                      >
                        Download
                      </Link>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

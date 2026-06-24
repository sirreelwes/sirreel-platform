import { prisma } from '@/lib/prisma'
import { verifyCoiToken } from '@/lib/coi/coiUploadToken'
import { CoiUploadForm } from '@/components/coi/CoiUploadForm'

export const dynamic = 'force-dynamic'

// Client-facing COI drop (no login). The signed token in the URL carries
// the job/company/inquiry context (or none). Server-verifies the token,
// greets with whatever context resolves, and renders the upload form.
export default async function CoiUploadPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const payload = verifyCoiToken(token)

  if (!payload) {
    return (
      <Shell>
        <h1 className="text-xl font-bold text-[#0c0c0d]" style={{ fontFamily: 'Archivo, sans-serif' }}>
          This link has expired
        </h1>
        <p className="mt-2 text-[14px] text-[#5b554b]">
          COI upload links are valid for a limited time. Please ask your SirReel contact for a fresh link.
        </p>
      </Shell>
    )
  }

  const [company, job] = await Promise.all([
    payload.companyId
      ? prisma.company.findUnique({ where: { id: payload.companyId }, select: { name: true } })
      : Promise.resolve(null),
    payload.jobId
      ? prisma.job.findUnique({ where: { id: payload.jobId }, select: { name: true } })
      : Promise.resolve(null),
  ])
  const forLabel = job?.name || company?.name || null

  return (
    <Shell>
      <h1 className="text-[26px] font-extrabold tracking-tight text-[#0c0c0d]" style={{ fontFamily: 'Archivo, sans-serif' }}>
        Drop your COI here
      </h1>
      <p className="mt-2 text-[14px] text-[#5b554b] leading-relaxed">
        Upload your Certificate of Insurance{forLabel ? <> for <b className="text-[#0c0c0d]">{forLabel}</b></> : ''} as a
        PDF. We&rsquo;ll route it to the SirReel team and keep a copy on file.
      </p>
      <div className="mt-6">
        <CoiUploadForm token={token} />
      </div>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-screen bg-[#f4f1ea] text-[#0c0c0d] flex flex-col"
      style={{ fontFamily: '"Hanken Grotesk", Inter, system-ui, sans-serif' }}
    >
      <header className="bg-[#0c0c0d] text-white px-6 py-4">
        <div className="max-w-2xl mx-auto flex items-center gap-2.5">
          <span className="font-bold text-[16px]">SirReel</span>
          <span className="text-[#c39a3f] text-[11px] font-semibold tracking-[0.22em] uppercase">Studio Services</span>
        </div>
      </header>
      <main className="flex-1 px-6 py-10">
        <div className="max-w-2xl mx-auto bg-white border border-[#e4dfd4] rounded-2xl p-6 sm:p-8 shadow-sm">
          {children}
        </div>
      </main>
    </div>
  )
}

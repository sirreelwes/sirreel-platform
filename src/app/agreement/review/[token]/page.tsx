/**
 * /agreement/review/[token] — the client's counsel reads their negotiated
 * agreement and downloads it as PDF or Word.
 *
 * Wes, 2026-09-18: "Marell will probably want to see the entire agreement
 * again … Ideally, I can just send it in HQ to him, and he can review it
 * there with a button that allows him to download a DOCX file."
 *
 * READ-ONLY in the strong sense, like the COI broker desk it is modelled on:
 * no form, no POST, no session, nothing to click but two downloads. The
 * token is the credential and it names one agreement, so a forwarded link
 * never widens to another client.
 *
 * A SERVER component on purpose — the packet is assembled server-side
 * (counselReviewPacket.ts) and the page renders only what it returns, so
 * what a stranger can read is decided in one reviewable place.
 */
import type { Metadata } from 'next'
import { verifyCounselReviewToken } from '@/lib/contracts/counselReviewToken'
import { buildCounselReviewPacket } from '@/lib/contracts/counselReviewPacket'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Rental Agreement — Review',
  // Opposing counsel's link must never turn up in a search index.
  robots: { index: false, follow: false },
}

export default async function CounselReviewPage({ params }: { params: { token: string } }) {
  const payload = verifyCounselReviewToken(params.token)
  const packet = payload ? await buildCounselReviewPacket(payload.companyAgreementId) : null

  if (!packet) {
    return (
      <main className="min-h-screen bg-zinc-50 px-5 py-16">
        <div className="mx-auto max-w-lg rounded-xl border border-zinc-200 bg-white px-6 py-8 text-center">
          <h1 className="text-[20px] font-semibold text-zinc-900">This link isn&rsquo;t available</h1>
          <p className="mt-2 text-[14px] leading-relaxed text-zinc-600">
            It may have expired, or been replaced by a newer copy. Email{' '}
            <a href="mailto:wes@sirreel.com" className="underline">wes@sirreel.com</a> and we&rsquo;ll send a
            current one.
          </p>
        </div>
      </main>
    )
  }

  const pdf = `/api/agreement/review/${params.token}?format=pdf`
  const docx = `/api/agreement/review/${params.token}?format=docx`

  return (
    <main className="min-h-screen bg-zinc-50 px-5 py-8">
      <div className="mx-auto max-w-4xl space-y-5">
        <header>
          <div className="text-[12px] font-semibold uppercase tracking-wide text-zinc-500">
            SirReel Studio Services
          </div>
          <h1 className="mt-1 text-[24px] font-semibold leading-tight text-zinc-900">{packet.title}</h1>
          <p className="mt-1.5 text-[14px] text-zinc-600">
            {packet.companyName} · in effect {packet.effectiveDate} through {packet.expiryDate}
          </p>
          <p className="mt-1 text-[13px] text-zinc-500">{packet.version}</p>
        </header>

        {packet.isCurrentDraft ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] leading-relaxed text-amber-900">
            <span className="font-semibold">For your review.</span> This is the current copy — your
            clauses as agreed, in your numbering, with the sections SirReel added marked as additions
            under their own heading. Nobody has signed it. If a change lands, this same link shows the
            corrected copy, so there is no need to ask for a fresh one.
          </div>
        ) : (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] leading-relaxed text-emerald-900">
            <span className="font-semibold">Executed.</span> Signed
            {packet.signerName ? ` by ${packet.signerName}` : ''} on{' '}
            {packet.signedAt?.toLocaleDateString('en-US', {
              month: 'long',
              day: 'numeric',
              year: 'numeric',
              timeZone: 'UTC',
            })}
            . This copy is for your file.
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <a
            href={docx}
            className="inline-flex items-center rounded-md bg-amber-600 px-4 py-2 text-[14px] font-semibold text-white hover:bg-amber-500"
          >
            Download Word (.docx)
          </a>
          <a
            href={`${pdf}&dl=1`}
            className="inline-flex items-center rounded-md border border-zinc-300 bg-white px-4 py-2 text-[14px] font-semibold text-zinc-800 hover:bg-zinc-50"
          >
            Download PDF
          </a>
          <span className="text-[12.5px] text-zinc-500">
            The Word copy is generated from the agreement text itself — not converted from the PDF — so
            it is clean to mark up.
          </span>
        </div>

        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
          <iframe title={packet.title} src={`${pdf}#toolbar=0`} className="h-[78vh] w-full" />
        </div>

        <footer className="pb-6 text-[12.5px] leading-relaxed text-zinc-500">
          Questions or a further markup: reply to Wes Bailey,{' '}
          <a href="mailto:wes@sirreel.com" className="underline">wes@sirreel.com</a>. SirReel Production
          Vehicles, Inc. dba SirReel Studio Services · 8500 Lankershim Blvd, Sun Valley, CA 91352.
        </footer>
      </div>
    </main>
  )
}

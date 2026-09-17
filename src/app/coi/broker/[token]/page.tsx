import { prisma } from '@/lib/prisma'
import { verifyCoiBrokerToken } from '@/lib/coi/brokerReviewToken'
import { signCoiToken } from '@/lib/coi/coiUploadToken'
import { coiUploadUrl } from '@/lib/portal/portalUrl'
import { buildBrokerReviewPacket, type BrokerPacketCheck } from '@/lib/coi/broker'
import { COI_SCOPE_SELECT, deriveCoiScope } from '@/lib/coi/jobScope'
import { evaluateInsuredMatch } from '@/lib/coi/insuredMatch'
import type { CoiCheckContext } from '@/lib/coi/checks'
import {
  AUTO_PHYSICAL_DAMAGE_NOTE,
  COI_INBOX,
  COI_REQUIREMENTS,
  SAMPLE_COI_PATH,
  STICKING_POINT,
} from '@/lib/coi/requirements'
import { PUBLIC_SITE_ORIGIN } from '@/lib/site/publicUrl'
import {
  loadJobReplacementValue,
  replacementValueSentence,
  toClientReplacementValue,
} from '@/lib/coi/replacementValue'
import { formatCalendarDate } from '@/lib/dates/calendarDate'

export const dynamic = 'force-dynamic'

/**
 * /coi/broker/[token] — the certificate's BROKER reads our review of it.
 *
 * Wes, 2026-09-17: "add an option to send a link to them when we need an
 * updated COI or something isn't passing our test. The link would open a
 * read only review showing the broker what we are rejecting or requesting be
 * fixed."
 *
 * READ-ONLY in the strong sense: this page has no form, no POST, and no
 * session. The signed token is the whole credential and it names one
 * certificate (src/lib/coi/brokerReviewToken.ts). What it may show is fixed
 * by `buildBrokerReviewPacket`, not by this file — see the envelope note
 * there. The one thing it offers to DO is hand back a corrected certificate,
 * through the drop link the client already has.
 *
 * Verdicts are recomputed on every view rather than frozen at send time, so a
 * broker who opens the link after the desk approved the certificate reads
 * "nothing further needed" instead of chasing a closed ask — and a production
 * company corrected in HQ clears the named-insured line here the same way it
 * clears it everywhere else.
 */

const STATUS_STYLES: Record<string, { label: string; cls: string }> = {
  PASS: { label: 'Met', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  FAIL: { label: 'Needed', cls: 'bg-rose-50 text-rose-800 border-rose-200' },
  UNKNOWN: { label: 'Not shown', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  NA: { label: 'Not required', cls: 'bg-[#f1efe9] text-[#6b6355] border-[#e4dfd4]' },
}

export default async function CoiBrokerReviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const payload = verifyCoiBrokerToken(token)

  if (!payload) {
    return (
      <Shell>
        <h1 className="text-xl font-bold text-[#0c0c0d]" style={{ fontFamily: 'Archivo, sans-serif' }}>
          This link has expired
        </h1>
        <p className="mt-2 text-[14px] text-[#5b554b] leading-relaxed">
          Certificate review links are valid for a limited time. Ask your client — or email{' '}
          <a className="text-[#0C657A] font-semibold" href={`mailto:${COI_INBOX}`}>
            {COI_INBOX}
          </a>{' '}
          — for a fresh one.
        </p>
      </Shell>
    )
  }

  const coi = await prisma.coiCheck.findUnique({
    where: { id: payload.coiId },
    select: {
      id: true,
      namedInsured: true,
      policyExpiryDate: true,
      aiResponse: true,
      humanDecision: true,
      deletedAt: true,
      companyId: true,
      company: { select: { id: true, name: true } },
      job: {
        select: {
          id: true,
          name: true,
          companyId: true,
          company: { select: { name: true } },
          ...COI_SCOPE_SELECT,
        },
      },
    },
  })

  if (!coi || coi.deletedAt) {
    return (
      <Shell>
        <h1 className="text-xl font-bold text-[#0c0c0d]" style={{ fontFamily: 'Archivo, sans-serif' }}>
          This review is no longer available
        </h1>
        <p className="mt-2 text-[14px] text-[#5b554b] leading-relaxed">
          The certificate this link pointed at has been removed. Email{' '}
          <a className="text-[#0C657A] font-semibold" href={`mailto:${COI_INBOX}`}>
            {COI_INBOX}
          </a>{' '}
          and we will send the current requirements.
        </p>
      </Shell>
    )
  }

  const ai = (coi.aiResponse || null) as Record<string, unknown> | null
  const scope = deriveCoiScope(coi.job ?? {})
  const ctx: CoiCheckContext = { ...scope.ctx }
  const candidates = [coi.job?.company?.name, coi.company?.name, coi.job?.name].filter(
    (n): n is string => !!n && !!n.trim(),
  )
  const match = evaluateInsuredMatch(coi.namedInsured, candidates)

  // The equipment line the requirements ask for ("totaling the replacement
  // value of rented equipment") — the figure the broker would otherwise have
  // to ask their client for. Best-effort; a failure leaves the sentence off
  // rather than the page.
  let replacementSentence: string | null = null
  if (coi.job?.id) {
    try {
      replacementSentence = replacementValueSentence(
        toClientReplacementValue(await loadJobReplacementValue(coi.job.id)),
      )
    } catch {
      replacementSentence = null
    }
  }

  // Our sample certificate, but ONLY when one has actually been uploaded —
  // the forms slot 404s off an unset `SiteSetting.formCoiUrl`, and a dead
  // "download the sample" in front of a broker costs the round trip this
  // page exists to save. Absolute on the marketing origin, like the
  // requirements email, so it resolves the same from any host or inbox.
  let sampleUrl: string | null = null
  try {
    const settings = await prisma.siteSetting.findUnique({
      where: { id: 'singleton' },
      select: { formCoiUrl: true },
    })
    sampleUrl = settings?.formCoiUrl ? `${PUBLIC_SITE_ORIGIN}${SAMPLE_COI_PATH}` : null
  } catch {
    sampleUrl = null
  }

  // Their route back: the drop link the client uses, scoped to the same job
  // or company. Nothing about it is broker-specific — a corrected
  // certificate lands and is reviewed exactly like any other.
  const uploadUrl =
    coi.job || coi.company
      ? coiUploadUrl(
          signCoiToken({
            jobId: coi.job?.id,
            companyId: coi.job?.companyId ?? coi.company?.id ?? undefined,
          }),
        )
      : null

  const packet = buildBrokerReviewPacket({
    ai: ai as Parameters<typeof buildBrokerReviewPacket>[0]['ai'],
    match,
    policyExpiryDate: coi.policyExpiryDate,
    ctx,
    insuredName: coi.namedInsured,
    jobLabel: coi.job?.name ?? null,
    approved: coi.humanDecision === 'APPROVED',
    uploadUrl,
    replacementSentence,
    sampleUrl,
  })

  const critical = packet.checks.filter((c) => c.tier === 'CRITICAL')
  const alerts = packet.checks.filter((c) => c.tier === 'ALERT')

  return (
    <Shell>
      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#0C657A]">
        Certificate review
      </p>
      <h1
        className="mt-1.5 text-[26px] font-extrabold tracking-tight text-[#0c0c0d] leading-tight"
        style={{ fontFamily: 'Archivo, sans-serif' }}
      >
        {packet.resolved ? 'This certificate is accepted' : 'What we still need on this certificate'}
      </h1>

      <dl className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-[13px]">
        {packet.insuredName && (
          <Fact label="Named insured" value={packet.insuredName} />
        )}
        {packet.jobLabel && <Fact label="Rental" value={packet.jobLabel} />}
        {packet.policyExpiryDate && (
          <Fact
            label="Policy expires"
            value={formatCalendarDate(packet.policyExpiryDate, {
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            })}
          />
        )}
        <Fact label="Certificate holder" value={`${packet.holder.name} · ${packet.holder.address}`} />
      </dl>

      {packet.resolved ? (
        <p className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[14px] text-emerald-900 leading-relaxed">
          Nothing further is needed — this certificate has been reviewed and accepted. The review
          below is here for your records.
        </p>
      ) : packet.issues.length ? (
        <section className="mt-5 rounded-xl border border-[#e4dfd4] bg-[#fffdf8] p-4 sm:p-5">
          <h2 className="text-[12px] font-bold uppercase tracking-[0.14em] text-[#8a5a12]">
            Please reissue the certificate showing
          </h2>
          <ul className="mt-2.5 space-y-2.5">
            {packet.issues.map((issue, i) => (
              <li key={i} className="flex gap-2.5 text-[14px] text-[#2b2720] leading-relaxed">
                <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#b45309]" />
                <span>{issue}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="mt-5 text-[14px] text-[#5b554b] leading-relaxed">
          A corrected certificate of insurance is what we need. The full requirements are below.
        </p>
      )}

      {packet.replacementSentence && (
        <p className="mt-4 text-[14px] text-[#2b2720] leading-relaxed">
          <strong>{packet.replacementSentence}</strong> This is the figure for the rented-equipment
          line.
        </p>
      )}

      <section className="mt-7">
        <h2 className="text-[12px] font-bold uppercase tracking-[0.14em] text-[#6b6355]">
          Our review of the certificate on file
        </h2>
        <p className="mt-1.5 text-[12px] text-[#7a7365] leading-relaxed">
          Every requirement we check, and what your certificate shows against it.
        </p>
        <CheckTable rows={critical} />
        {alerts.length > 0 && (
          <>
            <h3 className="mt-5 text-[12px] font-bold uppercase tracking-[0.14em] text-[#6b6355]">
              Also reviewed
            </h3>
            <CheckTable rows={alerts} />
          </>
        )}
      </section>

      <section className="mt-7">
        <h2 className="text-[12px] font-bold uppercase tracking-[0.14em] text-[#6b6355]">
          Insurance requirements (all jobs)
        </h2>
        <ul className="mt-2 space-y-1.5 text-[14px] text-[#2b2720]">
          {COI_REQUIREMENTS.map((r) => (
            <li key={r.label}>
              <span className="font-semibold">{r.label}</span>
              {r.details?.length ? (
                <ul className="mt-1 ml-4 space-y-0.5 text-[13px]">
                  {r.details.map((d) => (
                    <li
                      key={d}
                      className={d === STICKING_POINT ? 'font-bold text-[#8a5a12]' : 'text-[#6b6355]'}
                    >
                      – {d}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
        <p className="mt-3 rounded-xl border border-[#fcd34d] bg-[#fffbeb] px-4 py-3 text-[13px] text-[#8a5a12] leading-relaxed">
          {AUTO_PHYSICAL_DAMAGE_NOTE}
        </p>
        {packet.sampleUrl && (
          <p className="mt-3 text-[14px] text-[#2b2720] leading-relaxed">
            <a
              href={packet.sampleUrl}
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-[#0C657A] underline underline-offset-2"
            >
              Download a sample certificate
            </a>{' '}
            showing the format we need — every line above, filled in.
          </p>
        )}
        <p className="mt-3 text-[14px] text-[#2b2720] leading-relaxed">
          Certificate holder, additional insured and loss payee:
          <br />
          <strong>{packet.holder.name}</strong>
          <br />
          {packet.holder.address}
        </p>
      </section>

      {!packet.resolved && (
        <section className="mt-7 border-t border-[#e4dfd4] pt-5">
          <h2 className="text-[12px] font-bold uppercase tracking-[0.14em] text-[#6b6355]">
            Sending the corrected certificate
          </h2>
          <p className="mt-2 text-[14px] text-[#2b2720] leading-relaxed">
            Email it to{' '}
            <a className="text-[#0C657A] font-semibold" href={`mailto:${COI_INBOX}`}>
              {COI_INBOX}
            </a>
            {packet.uploadUrl ? ', or upload it directly:' : '.'}
          </p>
          {packet.uploadUrl && (
            <a
              href={packet.uploadUrl}
              className="mt-3 inline-block rounded-xl bg-[#0F7A93] px-5 py-2.5 text-[14px] font-semibold text-white hover:bg-[#0C657A]"
            >
              Upload the corrected certificate
            </a>
          )}
        </section>
      )}

      <p className="mt-7 border-t border-[#e4dfd4] pt-4 text-[12px] text-[#7a7365] leading-relaxed">
        This page is read-only and shows the review as it stands right now. Questions about a
        requirement? Reply to the email that brought you here. SirReel Studio Services · 8500
        Lankershim Blvd, Sun Valley, CA 91352 · (888) 477-7335
      </p>
    </Shell>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#8a8375]">{label}</dt>
      <dd className="text-[14px] text-[#0c0c0d]">{value}</dd>
    </div>
  )
}

function CheckTable({ rows }: { rows: BrokerPacketCheck[] }) {
  if (!rows.length) return null
  return (
    <ul className="mt-2 divide-y divide-[#ece8de] rounded-xl border border-[#e4dfd4] overflow-hidden">
      {rows.map((r) => {
        const s = STATUS_STYLES[r.status] ?? STATUS_STYLES.UNKNOWN
        return (
          <li key={r.key} className="flex flex-wrap items-start gap-2 bg-white px-3.5 py-2.5">
            <span className="flex-1 min-w-[180px] text-[14px] text-[#2b2720]">
              {r.label}
              {r.found && (
                <span className="block text-[12px] text-[#7a7365] leading-relaxed">
                  Your certificate: {r.found}
                </span>
              )}
            </span>
            <span
              className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider ${s.cls}`}
            >
              {s.label}
            </span>
          </li>
        )
      })}
    </ul>
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
          <span className="text-[#4DB1C6] text-[11px] font-semibold tracking-[0.22em] uppercase">
            Studio Services
          </span>
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

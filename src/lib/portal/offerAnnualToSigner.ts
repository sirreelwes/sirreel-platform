/**
 * Put the negotiated annual in front of the person who will sign it —
 * from a phone.
 *
 * Wes 2026-09-18, after the masters were filed and §32 was agreed: "An
 * executive at the company wants to sign these agreements … I am not on my
 * laptop. Is there a way to do this so that I can make this happen from my
 * phone?"
 *
 * Every piece already existed as a web control, and the /crm/[id] panel does
 * work on a phone — but it is THREE separate acts on a wide, dense page
 * (Offer annual agreement · Add people · Review & send invite), repeated per
 * company, with 14px inputs iOS Safari zooms into on focus. This is the same
 * three acts as one idempotent task on the page that was built for a phone.
 *
 * WHAT IT IS NOT: a second implementation. It calls
 * `offerAnnualForSignature` (which picks the document off the registry by the
 * company's own name and records it in `CompanyAgreement.source`),
 * `grantCompanyPortalAccess` and `sendCompanyPortalInvite` — the same three
 * functions the panel's buttons call. The invite's sign link is appended by
 * the template, so it cannot go missing down this path either.
 *
 * ── Why the signer is optional ────────────────────────────────────────────
 * Offering and inviting are separate states on purpose (a rep sets up the
 * paper today and mails the executive when the deal closes). Leave the email
 * blank and it files the offers and stops — the panel can send the invite
 * later, with a preview.
 *
 * ── What it refuses, rather than guessing ─────────────────────────────────
 * Companies are matched on EXACT name via the agreement's own aliases, same
 * as fileNegotiatedAgreement — 0 or 2+ matches are skipped and the
 * near-misses printed. A company with NO covering or pending master is
 * skipped too: this task offers the negotiated document as an annual, and if
 * nothing was ever filed for that company then "file the negotiated
 * agreement" is the task to run first, not this one guessing at dates.
 */

import { prisma } from '@/lib/prisma'
import {
  findNegotiatedAgreement,
  negotiatedAgreementForCompany,
  NEGOTIATED_AGREEMENTS,
} from '@/lib/contracts/negotiatedAgreement'
import { resolveCompanyName } from '@/lib/contracts/fileNegotiatedAgreement'
import { findPendingAnnual, offerAnnualForSignature } from '@/lib/portal/companyAnnual'
import { renderedFromVersion } from '@/lib/contracts/fileNegotiatedAgreement'
import { findCompanyAnnualCoverage } from '@/lib/orders/annualCoverage'
import { annualSigningState } from '@/lib/portal/annualSigningRules'
import { grantCompanyPortalAccess, isEmailAddress, normalizeGrantInputs } from '@/lib/portal/grantCompanyAccess'
import { sendCompanyPortalInvite, hqOrigin } from '@/lib/portal/sendCompanyInvite'
import { TaskRefused } from '@/lib/admin/taskRefused'

export { TaskRefused }

export interface OfferAnnualOptions {
  /** Registry key of the negotiated agreement, e.g. `graduation-day-2026`. */
  key: string
  dryRun: boolean
  /** Registry name → exact DB name, when the dry run says one did not match. */
  aliases?: Record<string, string> | null
  /** The person who will sign. Blank files the offers and sends nothing. */
  signerEmail?: string | null
  signerName?: string | null
  signerTitle?: string | null
  /** false grants access without mailing them — the panel can send later. */
  sendInvite?: boolean
  /**
   * Replace a pending offer rendered from an OLDER version of the document.
   * On by default: an offer that is not the agreed text is the one thing
   * this task must never hand to a signer.
   */
  refresh?: boolean
  actorUserId?: string | null
}

export interface OfferedCompany {
  registryName: string
  companyId: string
  companyName: string
  agreementId: string
  title: string
  /** The offer was already on file — this run did not create it. */
  alreadyOffered: boolean
  signerEmail: string | null
  accessId: string | null
  invited: boolean
}

export interface SkippedForOffer {
  registryName: string
  reason: string
  detail: string
}

export interface OfferAnnualResult {
  key: string
  title: string
  log: string[]
  createdIds: string[]
  touchedIds: string[]
  offered: OfferedCompany[]
  skipped: SkippedForOffer[]
}

export async function offerAnnualToSigner(opts: OfferAnnualOptions): Promise<OfferAnnualResult> {
  const { dryRun } = opts
  const agreement = findNegotiatedAgreement(opts.key)
  if (!agreement) {
    throw new TaskRefused(
      `No negotiated agreement with key "${opts.key}".`,
      `Known keys: ${NEGOTIATED_AGREEMENTS.map((a) => a.key).join(', ')}.`,
    )
  }

  const signerEmail = (opts.signerEmail ?? '').trim().toLowerCase() || null
  if (signerEmail && !isEmailAddress(signerEmail)) {
    throw new TaskRefused(
      `"${opts.signerEmail}" is not an email address.`,
      'Leave it blank to file the offers without inviting anyone, or fix the address.',
    )
  }
  const sendInvite = opts.sendInvite !== false

  // Checked before anything is rendered: the offer renders a PDF and puts it
  // in the blob store first, the row second, so a missing token fails
  // BETWEEN two companies and leaves the run half done.
  if (!dryRun && !process.env.BLOB_READ_WRITE_TOKEN) {
    throw new TaskRefused(
      'BLOB_READ_WRITE_TOKEN is not set — the agreement PDF has nowhere to go.',
      'It is deliberately not in .env.local. Run it from /admin/maintenance, where the Vercel runtime has the token.',
    )
  }

  const log: string[] = []
  const createdIds: string[] = []
  const touchedIds: string[] = []
  const offered: OfferedCompany[] = []
  const skipped: SkippedForOffer[] = []

  log.push(`${agreement.title} (${agreement.key})`)
  log.push(`  offered for signature in each company's account portal, through ${agreement.expiryDate}`)
  log.push(
    signerEmail
      ? `  signer: ${signerEmail}${opts.signerName ? ` (${opts.signerName})` : ''}${sendInvite ? ' — invited' : ' — access only, not mailed'}`
      : '  no signer given — files the offers and invites nobody',
  )
  log.push(dryRun ? '  MODE: dry run — nothing is written and nothing is sent' : '  MODE: writing')
  log.push('')

  for (const registryName of agreement.companies) {
    const companyName = resolveCompanyName(agreement, registryName, opts.aliases)
    const via = companyName === registryName ? '' : ` (as "${companyName}")`

    const matches = await prisma.company.findMany({
      where: { name: companyName },
      select: { id: true, name: true },
    })
    if (matches.length !== 1) {
      log.push(`  ✗ ${registryName}${via}: ${matches.length} companies carry that exact name — skipped`)
      const near = await prisma.company.findMany({
        where: { name: { contains: companyName.split(/\s+/)[0], mode: 'insensitive' } },
        select: { name: true },
        take: 10,
      })
      for (const n of near) log.push(`      near: ${registryName}=${n.name}`)
      skipped.push({
        registryName,
        reason: matches.length === 0 ? 'no company with that exact name' : 'more than one company with that name',
        detail: companyName,
      })
      continue
    }
    const company = matches[0]

    // The registry must answer for THIS company's own CRM name, because
    // `offerAnnualForSignature` looks the document up that way and would
    // otherwise build the offer from our baseline clauses. An alias that
    // only lives in this run's params would pass the match above and then
    // render the wrong document.
    const byName = negotiatedAgreementForCompany(company.name)
    if (byName?.key !== agreement.key) {
      log.push(
        `  ✗ ${company.name}: the registry does not resolve this name to ${agreement.key}` +
          `${byName ? ` (it resolves to ${byName.key})` : ''} — skipped`,
      )
      skipped.push({
        registryName,
        reason: 'the registry does not map this company name to this agreement',
        detail: `add "${registryName}": "${company.name}" to companyAliases in negotiatedAgreement.ts — an offer built from the wrong document would put our baseline terms in front of them`,
      })
      continue
    }

    const [coverage, pending] = await Promise.all([
      findCompanyAnnualCoverage(company.id),
      findPendingAnnual(company.id),
    ])
    const state = annualSigningState({ coverage, pending })

    if (!coverage && !pending) {
      log.push(`  ✗ ${company.name}: no annual master on file at all — skipped`)
      skipped.push({
        registryName,
        reason: 'nothing filed for this company yet',
        detail: 'run "File a negotiated agreement as the client’s annual master" first — that is the task that files it with the agreed window',
      })
      continue
    }

    if (state.executed && !pending) {
      log.push(
        `  – ${company.name}: already signed by ${state.executed.signerName || 'someone'} — nothing to offer`,
      )
      skipped.push({
        registryName,
        reason: 'already executed',
        detail: `signed by ${state.executed.signerName || 'someone'}`,
      })
      continue
    }

    // Is the offer already on file the CURRENT document? Reusing a stale one
    // is how the pre-redline clause reaches a signer.
    const pendingNote = pending
      ? (await prisma.companyAgreement.findUnique({ where: { id: pending.id }, select: { note: true } }))?.note
      : null
    const pendingIsCurrent = !!pending && renderedFromVersion(pendingNote, agreement.version)
    const refresh = opts.refresh !== false

    let agreementId: string
    let title: string
    const alreadyOffered = !!pending && pendingIsCurrent
    if (pending && pendingIsCurrent) {
      agreementId = pending.id
      title = pending.title
      log.push(`  ✓ ${company.name}: "${pending.title}" is already offered, from this same version — reusing it`)
    } else if (pending && !refresh) {
      agreementId = pending.id
      title = pending.title
      log.push(`  ! ${company.name}: "${pending.title}" is offered but from an OLDER version of the document`)
      log.push(`      re-run with "Re-offer if the document changed" set to yes, or they sign the wrong text`)
    } else if (pending && dryRun) {
      agreementId = '(would be replaced — dry run)'
      title = agreement.title
      log.push(`  ! ${company.name}: the offer on file is an older version — would withdraw it and offer "${title}"`)
    } else if (dryRun) {
      agreementId = '(not created — dry run)'
      title = agreement.title
      log.push(`  ✓ ${company.name}: would offer "${title}" for signature in their portal`)
    } else {
      const created = await offerAnnualForSignature(company.id, {
        byUserId: opts.actorUserId ?? null,
        refresh,
      })
      if (pending && created.id !== pending.id) {
        log.push(`      withdrew the older offer ${pending.id} — kept on file, never signed`)
      }
      agreementId = created.id
      title = created.title
      createdIds.push(created.id)
      log.push(`  ✓ ${company.name}: offered "${title}" — ${created.id}`)
      if (!created.negotiatedKey) {
        // Belt and braces on the check above: if this ever renders the
        // baseline it must be loud, not filed quietly under their name.
        log.push(
          `      ! it rendered our BASELINE clauses, not their negotiated document — do not send this one for signature`,
        )
      }
    }
    if (state.coveringUnsigned || (coverage && !coverage.signedAt)) {
      log.push(`      their jobs stay covered by the unsigned master until this is signed; signing supersedes it`)
    }

    let accessId: string | null = null
    let invited = false
    if (signerEmail) {
      const existing = await prisma.companyPortalAccess.findFirst({
        where: { companyId: company.id, person: { email: signerEmail }, revokedAt: null },
        select: { id: true, invitedAt: true },
      })
      if (existing) {
        accessId = existing.id
        log.push(
          `      ${signerEmail} already has portal access${existing.invitedAt ? ' (invited before)' : ' (never invited)'}`,
        )
      } else if (dryRun) {
        log.push(`      would give ${signerEmail} account-portal access as an EXECUTIVE`)
      } else {
        const grants = normalizeGrantInputs(
          [{ email: signerEmail, name: opts.signerName ?? null, title: opts.signerTitle ?? null, role: 'EXECUTIVE' }],
          { defaultRole: 'EXECUTIVE' },
        )
        const g = await grantCompanyPortalAccess(company.id, grants, {
          userId: opts.actorUserId ?? null,
          accessId: null,
        })
        accessId = g.created[0]?.accessId ?? null
        if (accessId) createdIds.push(accessId)
        log.push(
          accessId
            ? `      ${signerEmail} now has account-portal access as an EXECUTIVE`
            : `      ! could not grant access to ${signerEmail} — invite not sent`,
        )
      }

      if (sendInvite) {
        if (dryRun) {
          log.push(`      would email ${signerEmail} the invite — it names "${title}" and links to the signing page`)
        } else if (accessId) {
          const sent = await sendCompanyPortalInvite({
            companyId: company.id,
            accessId,
            base: hqOrigin(),
            fallbackRep: { name: null, email: null },
            customBody: null,
            byUserId: opts.actorUserId ?? null,
          })
          invited = sent.ok
          touchedIds.push(accessId)
          log.push(
            sent.ok
              ? `      emailed ${sent.to} — the invite names the agreement and links straight to the signing page`
              : `      ! the invite did NOT send: ${sent.error} (they have access; re-send from /crm)`,
          )
        }
      }
    }

    offered.push({
      registryName,
      companyId: company.id,
      companyName: company.name,
      agreementId,
      title,
      alreadyOffered,
      signerEmail,
      accessId,
      invited,
    })
  }

  log.push('')
  log.push(
    signerEmail
      ? `They sign at /portal/company/<id>/sign/annual — the LCDW election for the account is made there too.`
      : `Nobody was invited. Send the invite from /crm → Account portal access when you are ready.`,
  )

  return { key: agreement.key, title: agreement.title, log, createdIds, touchedIds, offered, skipped }
}

import { prisma } from '@/lib/prisma'
import { deriveJobDateRange } from '@/lib/jobs/dateRange'
import type {
  AiChange,
  DecisionForRender,
  CompanyForRender,
  JobForRender,
  ContactForRender,
  GrantedScopeEntry,
  RenderArgs,
} from '@/lib/contracts/generateCounterPdf'

/**
 * Everything ContractDocument needs, gathered from one ContractReview.
 *
 * Lifted out of the generate-counter-pdf route when the ACCEPT step started
 * needing the same props: the document a client SIGNS is rendered from the
 * same review as the counter-proposal, and the two must never drift apart —
 * a client should sign the clauses they were shown.
 *
 * Returns a discriminated result rather than throwing so both callers keep
 * their own HTTP shapes.
 */
export type ReviewPdfProps = Omit<RenderArgs, 'generatedAt' | 'documentTitle' | 'finalized'> & {
  counterPdfKey: string | null
  reviewId: string
  amendedClauseRefs: string[]
}

export type BuildReviewPdfPropsResult =
  | { ok: true; props: ReviewPdfProps }
  | { ok: false; status: number; error: string }

export async function buildReviewPdfProps(reviewId: string): Promise<BuildReviewPdfPropsResult> {
  const review = await prisma.contractReview.findFirst({
    where: { id: reviewId, deletedAt: null },
    include: {
      company: true,
      job: {
        include: {
          jobContacts: {
            include: { person: true },
          },
          // A job has no dates of its own; the span comes from its orders.
          orders: { select: { startDate: true, endDate: true, status: true } },
        },
      },
      changeDecisions: true,
    },
  })

  if (!review) {
    return { ok: false, status: 404, error: 'Contract review not found.' }
  }

  const ai = review.aiResponse as { changes?: AiChange[] } | null
  const aiChanges: AiChange[] = Array.isArray(ai?.changes) ? ai!.changes! : []

  const decisionsByIndex = new Map(
    review.changeDecisions.map((d) => [d.changeIndex, d])
  )

  // Validate every AI change has a non-PENDING decision.
  const pending: string[] = []
  aiChanges.forEach((ch, i) => {
    const d = decisionsByIndex.get(i)
    if (!d || d.decision === 'PENDING') {
      pending.push(ch.clause || `#${i + 1}`)
    }
  })
  if (pending.length > 0) {
    return {
      ok: false,
      status: 400,
      error: `Cannot render: ${pending.length} change${
        pending.length === 1 ? '' : 's'
      } still pending decision (clause${pending.length === 1 ? '' : 's'} ${pending.join(', ')})`,
    }
  }

  const decisions: DecisionForRender[] = review.changeDecisions.map((d) => ({
    changeIndex: d.changeIndex,
    clauseRef: d.clauseRef,
    decision: d.decision,
    counterLanguage: d.counterLanguage,
    note: d.note,
  }))

  const company: CompanyForRender | null = review.company
    ? {
        name: review.company.name,
        industry: review.company.industry,
        billingAddress: review.company.billingAddress,
        billingEmail: review.company.billingEmail,
        notes: review.company.notes,
      }
    : null

  const primaryContact: ContactForRender | null = review.job
    ? (() => {
        const contacts = review.job.jobContacts ?? []
        if (contacts.length === 0) return null
        const byRole = (role: string) => contacts.find((jc) => jc.role === role)
        const primary =
          byRole('PM') ||
          byRole('PC') ||
          contacts.find((jc) => jc.isPrimary) ||
          contacts[0]
        if (!primary) return null
        const fullName = [primary.person.firstName, primary.person.lastName]
          .filter(Boolean)
          .join(' ')
          .trim()
        return {
          fullName: fullName || null,
          role: primary.role,
          email: primary.person.email,
          phone: primary.person.phone || primary.person.mobile || null,
        }
      })()
    : null

  const job: JobForRender | null = review.job
    ? {
        jobCode: review.job.jobCode,
        name: review.job.name,
        productionType: review.job.productionType,
        // The job-level range was a separate, drifting copy. ContractReview
        // has no order relation, so derive the span from the job's orders.
        startDate: deriveJobDateRange(review.job.orders).start,
        endDate: deriveJobDateRange(review.job.orders).end,
        primaryContact,
      }
    : null

  // Facility scope block — enumerate the package members from any
  // order on this job that carries a Lankershim Studios facility
  // package. Lets the client see exactly which areas the counter
  // contract grants access to (vs. areas the rep withheld at scope
  // time). Picks the most recent order with a Lankershim header;
  // ties decide deterministically by order id.
  let grantedScope: { packageName: string; items: GrantedScopeEntry[] } | null = null
  if (review.jobId) {
    const orderWithLank = await prisma.order.findFirst({
      where: {
        jobId: review.jobId,
        lineItems: {
          some: {
            isPackageHeader: true,
            package: { name: { startsWith: 'Lankershim Studios' } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        lineItems: {
          where: { packageId: { not: null } },
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            description: true,
            notes: true,
            isPackageHeader: true,
            packageInstanceId: true,
            package: { select: { name: true } },
          },
        },
      },
    })
    if (orderWithLank) {
      const header = orderWithLank.lineItems.find(
        (li) => li.isPackageHeader && li.package?.name?.startsWith('Lankershim Studios'),
      )
      if (header) {
        const members = orderWithLank.lineItems.filter(
          (li) =>
            !li.isPackageHeader &&
            li.packageInstanceId &&
            li.packageInstanceId === header.packageInstanceId,
        )
        grantedScope = {
          packageName: header.package?.name ?? 'Lankershim Studios — Facility',
          items: members.map((m) => ({ label: m.description, note: m.notes })),
        }
      }
    }
  }


  return {
    ok: true,
    props: {
      company,
      job,
      aiChanges,
      decisions,
      grantedScope,
      counterPdfKey: review.counterPdfKey,
      reviewId: review.id,
      amendedClauseRefs: decisions
        .filter((d) => d.decision === 'ACCEPT' || d.decision === 'COUNTER')
        .map((d) => d.clauseRef),
    },
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { randomUUID } from 'crypto'
import { put, del } from '@vercel/blob'
import { prisma } from '@/lib/prisma'
import { generateCounterPdf } from '@/lib/contracts/generateCounterPdf'
import type {
  AiChange,
  DecisionForRender,
  CompanyForRender,
  JobForRender,
  ContactForRender,
} from '@/lib/contracts/generateCounterPdf'

export const dynamic = 'force-dynamic'
export const maxDuration = 15

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const sessionUser = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })
  if (!sessionUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const review = await prisma.contractReview.findFirst({
    where: { id: params.id, deletedAt: null },
    include: {
      company: true,
      job: {
        include: {
          jobContacts: {
            include: { person: true },
          },
        },
      },
      changeDecisions: true,
    },
  })

  if (!review) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
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
    return NextResponse.json(
      {
        error: `Cannot generate counter-PDF: ${pending.length} change${
          pending.length === 1 ? '' : 's'
        } still pending decision (clause${pending.length === 1 ? '' : 's'} ${pending.join(', ')})`,
      },
      { status: 400 }
    )
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
        startDate: review.job.startDate,
        endDate: review.job.endDate,
        primaryContact,
      }
    : null

  let pdfBytes: Buffer
  try {
    pdfBytes = await generateCounterPdf({
      company,
      job,
      aiChanges,
      decisions,
      generatedAt: new Date(),
    })
  } catch (err) {
    console.error('[generate-counter-pdf] render error:', err)
    return NextResponse.json(
      { error: 'Failed to render counter-PDF. See server logs.' },
      { status: 500 }
    )
  }

  const now = new Date()
  const yyyy = now.getUTCFullYear()
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
  const blobKey = `contracts/${yyyy}/${mm}/${randomUUID()}-counter.pdf`

  let blob
  try {
    blob = await put(blobKey, pdfBytes, {
      access: 'private' as any,
      contentType: 'application/pdf',
    })
  } catch (err) {
    console.error('[generate-counter-pdf] blob upload error:', err)
    return NextResponse.json({ error: 'Failed to upload counter-PDF.' }, { status: 500 })
  }

  // Delete the previous counter-PDF, if any (Q4: replace, no versioning).
  const previousKey = review.counterPdfKey
  await prisma.contractReview.update({
    where: { id: review.id },
    data: {
      counterPdfKey: blobKey,
      counterPdfUrl: blob.url,
      counterGeneratedAt: now,
      counterGeneratedById: sessionUser.id,
    },
  })

  if (previousKey && previousKey !== blobKey) {
    try {
      await del(previousKey)
    } catch (err) {
      // Non-fatal — orphaned blob will fall out of retention eventually.
      console.warn('[generate-counter-pdf] failed to delete previous blob:', previousKey, err)
    }
  }

  return NextResponse.json({
    ok: true,
    counterPdfId: review.id,
    counterGeneratedAt: now.toISOString(),
  })
}

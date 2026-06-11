/**
 * POST /api/crm/captures/[id] — act on a single capture row.
 *
 * Actions (discriminated by body.action):
 *   - add      (NEEDS_REVIEW only): create Person from the supplied
 *              payload (rep may have edited the parsed fields), link
 *              to capture, resolution=ADDED. If email already maps to
 *              an existing Person, link without creating + enrich
 *              empty fields the same way the AUTO path does.
 *   - dismiss  (NEEDS_REVIEW only): resolution=DISMISSED, no Person
 *              touched.
 *   - undo     (AUTO_CAPTURED only): reverse the auto action.
 *              AUTO_FILED → delete the Person row this capture minted
 *              (refuse if the Person has any downstream activity).
 *              AUTO_ENRICHED → restore the fields named in
 *              enrichmentLog to their pre-capture values. Either way
 *              the capture lands at resolution=DISMISSED with
 *              resolvedAt stamped.
 *
 * Auth: getServerSession; mutations require a known user so
 * resolvedById is populated for the audit trail.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { Prisma, CaptureResolution, CaptureVerdict, PersonRole } from '@prisma/client'
import { mapTitleToRole } from '@/lib/crm/roleMapping'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

type AddPayload = {
  firstName: string
  lastName: string
  email: string
  phone?: string | null
  role?: PersonRole
  rawTitle?: string | null
  lastKnownProject?: string | null
}

interface EnrichmentChange { from: string | PersonRole | null; to: string | PersonRole }

function isValidRole(r: unknown): r is PersonRole {
  return typeof r === 'string' && (Object.values(PersonRole) as string[]).includes(r)
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  })
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id } = await params
  const capture = await prisma.inquiryCapture.findUnique({
    where: { id },
    select: {
      id: true,
      verdict: true,
      resolution: true,
      personId: true,
      parsedTitle: true,
      parsedProject: true,
      enrichmentLog: true,
      emailMessageId: true,
      inbox: true,
    },
  })
  if (!capture) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const body = (await req.json().catch(() => null)) as { action?: string } | null
  const action = body?.action

  // ── DISMISS ────────────────────────────────────────────────────
  if (action === 'dismiss') {
    if (capture.verdict !== CaptureVerdict.NEEDS_REVIEW) {
      return NextResponse.json(
        { error: `dismiss only valid for NEEDS_REVIEW (got ${capture.verdict})` },
        { status: 409 },
      )
    }
    await prisma.inquiryCapture.update({
      where: { id },
      data: {
        resolution: CaptureResolution.DISMISSED,
        resolvedById: user.id,
        resolvedAt: new Date(),
      },
    })
    return NextResponse.json({ ok: true, resolution: CaptureResolution.DISMISSED })
  }

  // ── ADD ────────────────────────────────────────────────────────
  if (action === 'add') {
    if (capture.verdict !== CaptureVerdict.NEEDS_REVIEW) {
      return NextResponse.json(
        { error: `add only valid for NEEDS_REVIEW (got ${capture.verdict})` },
        { status: 409 },
      )
    }
    const p = body as unknown as AddPayload
    if (!p?.firstName?.trim() || !p?.lastName?.trim() || !p?.email?.trim()) {
      return NextResponse.json({ error: 'firstName, lastName, email required' }, { status: 400 })
    }
    const emailLower = p.email.trim().toLowerCase()
    const role: PersonRole = isValidRole(p.role)
      ? p.role
      : mapTitleToRole(p.rawTitle ?? capture.parsedTitle ?? null)

    const existing = await prisma.person.findFirst({
      where: { email: { equals: emailLower, mode: 'insensitive' } },
      select: { id: true, phone: true, mobile: true, rawTitle: true, lastKnownProject: true, role: true },
    })

    let personId: string
    if (existing) {
      // Enrich rather than duplicate (same rule as the AUTO path).
      const data: Prisma.PersonUpdateInput = {}
      if (!existing.phone && !existing.mobile && p.phone) data.phone = p.phone
      const newRawTitle = p.rawTitle ?? capture.parsedTitle
      if (!existing.rawTitle && newRawTitle) data.rawTitle = newRawTitle
      const newProject = p.lastKnownProject ?? capture.parsedProject
      if (!existing.lastKnownProject && newProject) data.lastKnownProject = newProject
      if (existing.role === PersonRole.OTHER && role !== PersonRole.OTHER) data.role = role
      if (Object.keys(data).length > 0) {
        data.sourceMessageId = capture.emailMessageId
        await prisma.person.update({ where: { id: existing.id }, data })
      }
      personId = existing.id
    } else {
      const created = await prisma.person.create({
        data: {
          firstName: p.firstName.trim(),
          lastName: p.lastName.trim(),
          email: emailLower,
          phone: p.phone?.trim() || null,
          role,
          rawTitle: p.rawTitle ?? capture.parsedTitle,
          lastKnownProject: p.lastKnownProject ?? capture.parsedProject,
          source: 'email_capture',
          sourceMessageId: capture.emailMessageId,
          notes: `Added from capture-review on ${capture.inbox}`,
        },
        select: { id: true },
      })
      personId = created.id
    }

    await prisma.inquiryCapture.update({
      where: { id },
      data: {
        personId,
        resolution: CaptureResolution.ADDED,
        resolvedById: user.id,
        resolvedAt: new Date(),
      },
    })
    return NextResponse.json({ ok: true, resolution: CaptureResolution.ADDED, personId })
  }

  // ── UNDO ───────────────────────────────────────────────────────
  if (action === 'undo') {
    if (capture.verdict !== CaptureVerdict.AUTO_CAPTURED) {
      return NextResponse.json(
        { error: `undo only valid for AUTO_CAPTURED (got ${capture.verdict})` },
        { status: 409 },
      )
    }
    if (capture.resolution === CaptureResolution.AUTO_FILED && capture.personId) {
      // Refuse if the Person has touched anything else — undo only
      // works while the row is still pristine.
      const person = await prisma.person.findUnique({
        where: { id: capture.personId },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          _count: {
            select: {
              jobContacts: true,
              orderContacts: true,
              bookings: true,
              referredBookings: true,
              affiliations: true,
              activities: true,
            },
          },
        },
      })
      if (!person) {
        // Already gone — just mark capture dismissed.
        await prisma.inquiryCapture.update({
          where: { id },
          data: {
            resolution: CaptureResolution.DISMISSED,
            personId: null,
            resolvedById: user.id,
            resolvedAt: new Date(),
          },
        })
        return NextResponse.json({ ok: true, resolution: CaptureResolution.DISMISSED })
      }
      const c = person._count
      const downstream = c.jobContacts + c.orderContacts + c.bookings + c.referredBookings + c.affiliations + c.activities
      if (downstream > 0) {
        return NextResponse.json(
          { error: `cannot undo — Person has ${downstream} downstream link(s); dismiss capture without deleting?` },
          { status: 409 },
        )
      }
      await prisma.$transaction([
        prisma.inquiryCapture.update({
          where: { id },
          data: {
            personId: null,
            resolution: CaptureResolution.DISMISSED,
            resolvedById: user.id,
            resolvedAt: new Date(),
          },
        }),
        prisma.person.delete({ where: { id: person.id } }),
      ])
      return NextResponse.json({ ok: true, resolution: CaptureResolution.DISMISSED, deletedPersonId: person.id })
    }

    if (capture.resolution === CaptureResolution.AUTO_ENRICHED && capture.personId) {
      // Restore the fields named in enrichmentLog to their pre-capture
      // values. Each log entry is { from, to }; "from" is what to
      // restore.
      const log = (capture.enrichmentLog ?? null) as
        | Record<string, EnrichmentChange>
        | null
      const data: Prisma.PersonUpdateInput = {}
      if (log) {
        if ('phone' in log) data.phone = (log.phone.from as string | null) ?? null
        if ('rawTitle' in log) data.rawTitle = (log.rawTitle.from as string | null) ?? null
        if ('lastKnownProject' in log) data.lastKnownProject = (log.lastKnownProject.from as string | null) ?? null
        if ('role' in log) data.role = (log.role.from as PersonRole | null) ?? PersonRole.OTHER
      }
      await prisma.$transaction([
        ...(Object.keys(data).length > 0
          ? [prisma.person.update({ where: { id: capture.personId }, data })]
          : []),
        prisma.inquiryCapture.update({
          where: { id },
          data: {
            resolution: CaptureResolution.DISMISSED,
            resolvedById: user.id,
            resolvedAt: new Date(),
          },
        }),
      ])
      return NextResponse.json({ ok: true, resolution: CaptureResolution.DISMISSED })
    }

    return NextResponse.json(
      { error: `undo not supported for resolution=${capture.resolution}` },
      { status: 409 },
    )
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}

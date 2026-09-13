/**
 * AHA texts the lock box how-to — photo first, link always.
 *
 * Wes 2026-09-13, after Jose hand-typed the steps and texted May a photo of
 * the keypad: "I think we should incorporate this into AHA's capabilities…
 * Is she able to send a photo like this to the Driver in the future?" She is,
 * by MMS, and this module is the only place that does it.
 *
 * WHAT GOES OUT — never a code. The picture is a keypad with two arrows on
 * it and the caption is Jose's sentence; the code itself is released
 * separately by verifyAndRelease, in its own message, as it always was. That
 * separation is also why the photo is a SECOND message rather than an
 * attachment on the code reply: the SMS prompt's standing rule is that a
 * code shares a message with nothing else.
 *
 * MMS IS NOT GUARANTEED. A 10DLC long code can be MMS-capable or not, and a
 * carrier may drop the media on a message it still delivers. So the caption
 * CARRIES THE LINK: if the picture never lands, the text that lands is still
 * the instruction plus a page with the picture on it. And if Twilio refuses
 * the MMS outright (an MMS-incapable sender is a 400 at send time, not a
 * silent drop), we immediately re-send the same words as a plain text rather
 * than leave someone standing at a truck with nothing.
 *
 * SENT AT MOST ONCE PER CONVERSATION PER DAY on the automatic path (a code
 * release), because a driver who gets the code every evening does not need
 * the same picture every evening. When AHA is ASKED — someone says the box
 * will not open — it sends regardless: they asked.
 */

import { prisma } from '@/lib/prisma'
import { sendTracked } from '@/lib/sms/threads'
import { toE164 } from '@/lib/sms/sendSms'
import { lockboxPhotoCaption, lockboxPhotoUrl, lockboxTextOnly } from '@/lib/site/lockboxGuide'

/** The marker sendTracked writes into the recorded body when media rides along. */
const PHOTO_LABEL = 'lock box keypad'
const DEDUPE_MS = 24 * 60 * 60 * 1000

export type LockboxHowToResult =
  | { sent: true; withPhoto: boolean }
  | { sent: false; reason: 'no-phone' | 'recently-sent' | 'not-delivered'; detail?: string }

/**
 * Has this number already been sent the photo inside the dedupe window?
 * Read off the thread's own outbound rows — the marker sendTracked records
 * IS the receipt, so there is no second place to keep in step.
 */
async function sentRecently(phone: string): Promise<boolean> {
  const thread = await prisma.smsThread.findUnique({ where: { phone }, select: { id: true } })
  if (!thread) return false
  const since = new Date(Date.now() - DEDUPE_MS)
  const hit = await prisma.smsMessage.findFirst({
    where: {
      threadId: thread.id,
      direction: 'OUTBOUND',
      createdAt: { gte: since },
      body: { contains: `[photo: ${PHOTO_LABEL}]` },
      // A held or refused send is not a send — those rows must not suppress
      // the next attempt.
      status: { in: ['queued', 'sent', 'delivered', 'twiml'] },
    },
    select: { id: true },
  })
  return Boolean(hit)
}

/**
 * Text the lock box how-to to one number.
 *
 * `trigger` is only about the dedupe: 'asked' means a person said the box
 * will not open, 'code-released' means AHA just handed over a lock box code
 * and is following it with the picture unprompted.
 */
export async function sendLockboxHowTo(args: {
  phone: string | null | undefined
  trigger: 'asked' | 'code-released'
  jobId?: string | null
}): Promise<LockboxHowToResult> {
  const phone = toE164(args.phone || '')
  if (!phone) return { sent: false, reason: 'no-phone' }

  if (args.trigger === 'code-released' && (await sentRecently(phone).catch(() => false))) {
    return { sent: false, reason: 'recently-sent' }
  }

  const photo = lockboxPhotoUrl()
  // Answering someone who is standing at a locked truck; quiet hours are the
  // reason they are texting rather than calling, so they do not apply.
  const common = { to: phone, source: 'assistant' as const, jobId: args.jobId ?? null, overrideQuietHours: true }
  const mms = await sendTracked({ ...common, body: lockboxPhotoCaption(), mediaUrls: [photo], mediaLabel: PHOTO_LABEL })
  if (mms.ok) return { sent: true, withPhoto: true }

  // Opted out, or SMS is switched off in this environment: a second attempt
  // would fail for the same reason and log a second row saying so.
  if (mms.status === 'skipped-opted-out' || mms.status === 'skipped-unconfigured' || mms.status === 'bad-number') {
    return { sent: false, reason: 'not-delivered', detail: mms.status }
  }

  const text = await sendTracked({ ...common, body: lockboxTextOnly() })
  if (text.ok) return { sent: true, withPhoto: false }
  return { sent: false, reason: 'not-delivered', detail: text.error || text.status }
}

/** Audit one send, whatever fired it. Never records the number in full. */
export async function noteLockboxHowTo(args: {
  phone: string
  trigger: 'asked' | 'code-released'
  result: LockboxHowToResult
  jobId?: string | null
}): Promise<void> {
  await prisma.auditLog
    .create({
      data: {
        action: 'assistant.lockbox_howto',
        entityType: 'SmsThread',
        entityId: toE164(args.phone) ?? args.phone,
        newValues: {
          phoneTail: (toE164(args.phone) ?? args.phone).slice(-4),
          trigger: args.trigger,
          sent: args.result.sent,
          withPhoto: args.result.sent ? args.result.withPhoto : false,
          reason: args.result.sent ? null : args.result.reason,
          jobId: args.jobId ?? null,
        },
      },
    })
    .catch(() => {})
}

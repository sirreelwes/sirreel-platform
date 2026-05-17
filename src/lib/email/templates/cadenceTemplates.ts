import type { CadenceEventType } from '@prisma/client'

/**
 * Locked email copy for the CRH cadence engine. Every body here mirrors the
 * verbatim text in docs/specs/client-relationship-hub-brief.md §10. Subject
 * lines and bodies use Handlebars syntax — compilation happens in
 * src/lib/email/templates/renderCadenceTemplate.ts.
 *
 * Templates intentionally absent (and the reason):
 *   - QUOTE_LOST_MARK: not an email, it's a state action.
 *   - MID_RENTAL_CHECKIN: optional rep-toggle, copy not yet locked.
 *   - LOST_SOFT_CHECKIN_90D: optional, copy not yet locked.
 *   - ANNUAL_EXPIRY_60D / ANNUAL_EXPIRY_7D: only the 30-day touchpoint has
 *     locked copy in the brief; the others can reuse the 30D body or wait
 *     for additional copy approval.
 */
export interface CadenceTemplate {
  subject: string
  body: string
}

export interface CadenceTemplateContext {
  firstName?: string
  companyName?: string
  jobName?: string
  pickupDate?: string
  pickupTime?: string
  pickupAddress?: string
  pickupDayOfWeek?: string
  returnDate?: string
  returnTime?: string
  repName?: string
  repPhone?: string
  repEmail?: string
  afterHoursLine?: string
  portalLink?: string
  opsContactName?: string
  opsContactPhone?: string
  parkingInstructions?: string
  invoiceAmount?: string
  invoiceDueDate?: string
  invoiceDate?: string
  payLink?: string
  paperworkType?: string
  expirationDate?: string
  renewalLink?: string
  year?: string
  sunsetDate?: string
  newContactName?: string
  approveLink?: string
  declineLink?: string
}

export const CADENCE_TEMPLATES: Partial<Record<CadenceEventType, CadenceTemplate>> = {
  // ── Unbooked — SILENT cadence ─────────────────────────────────────────
  QUOTE_NUDGE_24H: {
    subject: 'Quick check on your SirReel quote',
    body: `Hi {{firstName}},

Just confirming the quote I sent over for {{jobName}} landed safely. Happy to walk through anything, swap equipment if it'd help, or jump on a call. No rush — just here when you need.

Best,
{{repName}}
{{repPhone}}`,
  },
  QUOTE_CHECKIN_T72: {
    subject: 'Following up on {{jobName}}',
    body: `Hi {{firstName}},

I wanted to follow up and make sure I haven't missed anything you might need for your upcoming job. We show the pickup as {{pickupDate}} and I haven't heard back from you yet.

If anything's changed or you have questions, just let me know.

Best,
{{repName}}
{{repPhone}}`,
  },
  QUOTE_CLOSEDOWN_T24: {
    subject: 'Closing your SirReel quote for {{jobName}}',
    body: `Hi {{firstName}},

I haven't heard back, so I'm going to close this quote down. We're always here for you, and should you need anything at all, we are standing by.

Best,
{{repName}}
{{repPhone}}`,
  },

  // ── Unbooked — ACKNOWLEDGED cadence ────────────────────────────────────
  ACK_QUESTIONS_PROMPT_24H: {
    subject: 'SirReel quote for {{jobName}}',
    body: `Hi {{firstName}},

Please let me know if you have any questions on the quote or if there's anything I can help clarify.

Best,
{{repName}}
{{repPhone}}`,
  },
  ACK_SWEETEN_T72: {
    subject: 'Earning your business on {{jobName}}',
    body: `Hi {{firstName}},

Let me know if I can answer any questions or sweeten this quote in some way to earn your business. Happy to work with your budget or adjust the package.

Best,
{{repName}}
{{repPhone}}`,
  },
  ACK_CLOSEDOWN_T24: {
    subject: 'Closing your SirReel quote for {{jobName}}',
    body: `Hi {{firstName}},

I haven't heard back about a booking, so I'm going to close this quote down. We're always here for you, and should you need anything at all, we are standing by.

Best,
{{repName}}
{{repPhone}}`,
  },

  // ── Booked cadence ─────────────────────────────────────────────────────
  BOOKING_WELCOME: {
    subject: "You're booked! {{jobName}}",
    body: `Hi {{firstName}},

You're all set for {{pickupDate}} — {{jobName}}. We'll take it from here.

A few things you can do anytime through your portal:
• Upload your COI
• Review pickup info
• See your equipment list and schedule

[View your job portal]({{portalLink}})

Reach me directly at {{repPhone}} if anything changes. After-hours line is {{afterHoursLine}} for any urgent issues.

Looking forward to it.

Best,
{{repName}}`,
  },
  COI_RECEIVED_ACK: {
    subject: 'Got your insurance for {{jobName}}',
    body: `Hi {{firstName}},

Your COI is in. Our team is reviewing it and we'll let you know if anything needs adjusting — otherwise consider it locked in.

Best,
{{repName}}`,
  },
  PRE_PICKUP_DETAILS_T48: {
    subject: 'Pickup details for {{jobName}} — {{pickupDate}}',
    body: `Hi {{firstName}},

Quick rundown for pickup at {{pickupTime}} on {{pickupDate}}:

• Address: {{pickupAddress}}
• Parking: {{parkingInstructions}}
• Your contact on-site: {{opsContactName}} at {{opsContactPhone}}
• After-hours line: {{afterHoursLine}}

Everything is also live in your [job portal]({{portalLink}}) if helpful.

See you {{pickupDayOfWeek}}!

Best,
{{repName}}`,
  },
  FINAL_CONFIRM_T24: {
    subject: "Tomorrow's pickup — {{jobName}}",
    body: `Hi {{firstName}},

Just confirming we're all set for {{pickupTime}} tomorrow. Equipment is staged. If anything changes overnight, hit me on {{repPhone}}.

Best,
{{repName}}`,
  },
  PICKUP_DAY_AM: {
    subject: "Today's the day — {{jobName}}",
    body: `Hi {{firstName}},

We're ready when you are. {{opsContactName}} will be on-site at {{opsContactPhone}} if you need anything during pickup. After-hours line is {{afterHoursLine}}.

Have a great shoot.

Best,
{{repName}}`,
  },
  RETURN_REMINDER_T24: {
    subject: "Tomorrow's return — {{jobName}}",
    body: `Hi {{firstName}},

Return is set for {{returnTime}} tomorrow at {{pickupAddress}}. A few quick notes:

• Please return fueled to the level it was picked up at
• Equipment should come back clean — anything substantial gets billed at cost
• Need extra time? Just text me — we can adjust if available

Best,
{{repName}}`,
  },
  RETURN_ACKNOWLEDGMENT: {
    subject: 'Equipment back — thanks for {{jobName}}',
    body: `Hi {{firstName}},

Got the equipment back. Our team will do the walk-through and we'll get your final invoice to you within 24-48 hours.

Thanks for working with us.

Best,
{{repName}}`,
  },
  WRAP_THANKS_T24: {
    subject: 'Thanks again for {{jobName}}',
    body: `Hi {{firstName}},

Just wanted to say thanks for the work. Hope the shoot went well and the equipment held up its end. If anything was less than great, I'd love to hear it — we always want to be better.

When the next one comes up, you know where to find us.

Best,
{{repName}}`,
  },
  INVOICE_DELIVERY: {
    subject: 'Invoice for {{jobName}}',
    body: `Hi {{firstName}},

Your invoice for {{jobName}} is in your [job portal]({{portalLink}}) and attached here. Total is {{invoiceAmount}}, due {{invoiceDueDate}}.

Payment options:
• Pay online through the portal
• Wire details available on request
• Mail check to 8500 Lankershim Blvd, Sun Valley, CA 91352

Let me know if you have any questions.

Best,
Ana DeAngelis
SirReel Studio Services`,
  },
  PAYMENT_REMINDER_T14: {
    subject: 'Friendly reminder — invoice for {{jobName}}',
    body: `Hi {{firstName}},

Just a friendly nudge — invoice for {{jobName}} (dated {{invoiceDate}}) is showing unpaid in our system. If it's already been sent, just let me know and I'll track it down on our end.

[Pay invoice]({{payLink}})

Best,
Ana DeAngelis
SirReel Studio Services`,
  },
  REPEAT_BUSINESS_T30: {
    subject: 'Anything coming up?',
    body: `Hi {{firstName}},

Hope you're well. Anything on the horizon we could help with? Always happy to put together a quick quote.

Best,
{{repName}}
{{repPhone}}`,
  },

  // ── Re-engagement ──────────────────────────────────────────────────────
  LOST_REENGAGEMENT_2W: {
    subject: 'Following up on {{jobName}}',
    body: `Hi {{firstName}},

Hope your project went well. Wanted to reach back out in case there are upcoming projects we could quote for you. We'd love the chance to earn your business next time.

Best,
{{repName}}
{{repPhone}}`,
  },

  // ── Annual paperwork (only 30D copy locked; 60D/7D follow same shape) ──
  ANNUAL_EXPIRY_30D: {
    subject: 'SirReel paperwork renewal — {{paperworkType}}',
    body: `Hi {{firstName}},

Your annual {{paperworkType}} with SirReel expires on {{expirationDate}}. To keep things smooth for upcoming projects, let's get it renewed now.

[Renewal portal]({{renewalLink}})

Best,
{{repName}}`,
  },

  // ── Portal lifecycle ───────────────────────────────────────────────────
  PORTAL_SUNSET_REMINDER_23M: {
    subject: 'Your SirReel portal access for {{jobName}} is closing soon',
    body: `Hi {{firstName}},

Heads up — your portal access for the {{jobName}} project from {{year}} will sunset on {{sunsetDate}}. If you'd like to download anything (invoices, paperwork) for your records, now's the time.

[Portal link]({{portalLink}})

If you've got upcoming projects, just reach out and we'll get a fresh portal set up.

Best,
{{repName}}`,
  },
}

/**
 * Multi-contact authorization ask — not a cadence event (no CadenceEventType
 * key in the schema), so it's exported separately for direct callers. Same
 * Handlebars syntax, fed through the same renderCadenceTemplate function via
 * the optional `template` override.
 */
export const ADD_CONTACT_AUTHORIZATION_TEMPLATE: CadenceTemplate = {
  subject: 'Quick question — adding {{newContactName}} to the {{jobName}} portal',
  body: `Hi {{firstName}},

We noticed {{newContactName}} has been on our email thread about {{jobName}}. Would you like them to have access to the project portal? They'd be able to see paperwork, the schedule, and the equipment list.

[Yes, give them access]({{approveLink}}) [No thanks]({{declineLink}})

Best,
{{repName}}`,
}

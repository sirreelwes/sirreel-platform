import { renderEmailShell, renderEmailText, detailTable, calloutBox, p } from '@/lib/email/templates/shell'

/**
 * The end-of-day collections email.
 *
 * Modelled on the one Ana has been sending by hand — same four figures in the
 * same order, her note in the middle, because Dani and Wes read it every
 * evening and the shape is what makes it scannable.
 *
 * Four things it adds, each of which she was writing out longhand or leaving
 * to the reader:
 *   · counts beside the money, so "$8,564.50" is visibly two orders and not ten
 *   · the non-card remainder, computed (see below)
 *   · open AR, the number the report was always implicitly about
 *   · pending ACH called out on its own — her "straggling ACH's" line, as a figure
 *
 * The two collected lines are NESTED and the layout now says so. Wes,
 * 2026-09-02: RentalWorks is "money that hits the RW collected — sometimes
 * that is cardpointe payments and sometimes that's an ACH or wire that hits
 * Bank Account and she marks as paid". So the total leads, the card slice sits
 * under it, and what is left — ACH, wire, cheques — is subtracted and shown.
 * Listed flat, as they were, the two figures invite being added together,
 * which counts the card money twice.
 *
 * The note stays free text. The judgement in "orders extended into the
 * weekend, so today is light" is the part of this email no query produces.
 */

export interface EodEmailInput {
  /** Pacific date, YYYY-MM-DD. */
  date: string
  cardpointe: number
  rentalworks: number
  ordersCreated: number
  quotesCreated: number
  ordersCount: number
  quotesCount: number
  cardCount: number
  achPending: number
  achPendingCount: number
  outstandingTotal: number
  outstandingCount: number
  note: string
  senderName: string
}

const usd = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function longDate(dateISO: string): string {
  return new Date(`${dateISO}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

const countNote = (n: number, word: string) =>
  n === 1 ? `1 ${word}` : `${n} ${word}s`

export function renderEodCollectionsEmail(i: EodEmailInput): {
  subject: string
  html: string
  text: string
} {
  const subject = `EOD Collections — ${longDate(i.date)}`

  // Total first, then what it is made of. The remainder shows only when it is
  // real money — on an all-card day a "$0.00 other" line is noise.
  const nonCard = Math.round((i.rentalworks - i.cardpointe) * 100) / 100
  const collected = detailTable([
    { label: 'Collected (RentalWorks)', value: usd(i.rentalworks) },
    {
      label: 'of which card',
      value: `${usd(i.cardpointe)}  ·  ${countNote(i.cardCount, 'payment')}`,
    },
    ...(Math.abs(nonCard) >= 0.01
      ? [{ label: 'of which ACH / wire / cheque', value: usd(nonCard) }]
      : []),
  ])

  const created = detailTable([
    {
      label: 'Orders created',
      value: `${usd(i.ordersCreated)}  ·  ${countNote(i.ordersCount, 'order')}`,
    },
    {
      label: 'Quotes created',
      value: `${usd(i.quotesCreated)}  ·  ${countNote(i.quotesCount, 'quote')}`,
    },
  ])

  const standing = detailTable([
    {
      label: 'Open AR',
      value: `${usd(i.outstandingTotal)}  ·  ${countNote(i.outstandingCount, 'invoice')}`,
    },
    ...(i.achPendingCount
      ? [
          {
            label: 'ACH pending',
            value: `${usd(i.achPending)}  ·  ${countNote(i.achPendingCount, 'payment')} not yet cleared`,
          },
        ]
      : []),
  ])

  const noteHtml = i.note.trim()
    ? calloutBox(
        i.note
          .trim()
          .split(/\n{2,}/)
          .map(
            (para) =>
              `<p style="margin:0 0 10px;">${para
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/\n/g, '<br>')}</p>`,
          )
          .join('')
          .replace(/<p style="margin:0 0 10px;">([\s\S]*)<\/p>$/, '<p style="margin:0;">$1</p>'),
      )
    : ''

  const html = renderEmailShell({
    eyebrow: 'Collections',
    heading: `End of day — ${longDate(i.date)}`,
    // The total alone — adding the two would double-count the card take.
    preheader: `Collected ${usd(i.rentalworks)} · open AR ${usd(i.outstandingTotal)}`,
    bodyHtml: [
      p('<strong>Collected today</strong>'),
      collected,
      noteHtml,
      p('<strong>Written today</strong>'),
      created,
      p('<strong>Where we stand</strong>'),
      standing,
    ].join(''),
    footNote: `Sent by ${i.senderName} from HQ Collections.`,
  })

  const text = renderEmailText([
    `EOD Collections — ${longDate(i.date)}`,
    '',
    'COLLECTED TODAY',
    `Collected (RentalWorks): ${usd(i.rentalworks)}`,
    `  of which card: ${usd(i.cardpointe)} (${countNote(i.cardCount, 'payment')})`,
    ...(Math.abs(nonCard) >= 0.01 ? [`  of which ACH / wire / cheque: ${usd(nonCard)}`] : []),
    ...(i.note.trim() ? ['', i.note.trim()] : []),
    '',
    'WRITTEN TODAY',
    `Value of Orders Created: ${usd(i.ordersCreated)} (${countNote(i.ordersCount, 'order')})`,
    `Value of Quotes Created: ${usd(i.quotesCreated)} (${countNote(i.quotesCount, 'quote')})`,
    '',
    'WHERE WE STAND',
    `Open AR: ${usd(i.outstandingTotal)} across ${countNote(i.outstandingCount, 'invoice')}`,
    ...(i.achPendingCount
      ? [`ACH pending: ${usd(i.achPending)} (${countNote(i.achPendingCount, 'payment')} not yet cleared)`]
      : []),
    '',
    `Sent by ${i.senderName} from HQ Collections.`,
  ])

  return { subject, html, text }
}

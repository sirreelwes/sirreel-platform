import { renderEmailShell, renderEmailText, detailTable, calloutBox, p } from '@/lib/email/templates/shell'

/**
 * The end-of-day collections email.
 *
 * Modelled on the one Ana has been sending by hand — same four figures in the
 * same order, her note in the middle, because Dani and Wes read it every
 * evening and the shape is what makes it scannable.
 *
 * Three things it adds, each of which she was writing out longhand or leaving
 * to the reader:
 *   · counts beside the money, so "$8,564.50" is visibly two orders and not ten
 *   · open AR, the number the report was always implicitly about
 *   · pending ACH called out on its own — her "straggling ACH's" line, as a figure
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

  const collected = detailTable([
    { label: 'CardPointe', value: `${usd(i.cardpointe)}  ·  ${countNote(i.cardCount, 'payment')}` },
    { label: 'RentalWorks', value: usd(i.rentalworks) },
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
    preheader: `Collected ${usd(i.cardpointe + i.rentalworks)} · open AR ${usd(i.outstandingTotal)}`,
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
    `CardPointe: ${usd(i.cardpointe)} (${countNote(i.cardCount, 'payment')})`,
    `RentalWorks: ${usd(i.rentalworks)}`,
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

import { convert as htmlToText } from 'html-to-text'

// Result of walking a Gmail MIME payload tree.
//
// Gmail's `messages.get` with `format: "full"` returns a recursive
// `payload` object where each part has a `mimeType`, optional `body.data`
// (base64url-encoded), optional `filename` (set on attachments), and
// optional nested `parts`. Multipart/alternative typically yields one
// text/plain part + one text/html part. Multipart/mixed adds attachments
// alongside. We persist the bodies but only the attachment count.
export interface ExtractedBody {
  bodyText: string | null
  bodyHtml: string | null
  bodySource: 'plain' | 'html-converted' | null
  attachmentCount: number
}

// Recursive scan of the MIME tree. First text/plain and first text/html
// win. Parts with a filename + attachmentId are counted as attachments
// regardless of MIME type (Gmail uses filename to mark attachments).
function walk(part: GmailMessagePart, acc: { text: string | null; html: string | null; attachments: number }) {
  if (!part) return
  const mime = part.mimeType || ''
  const filename = part.filename || ''
  const body = part.body

  if (filename && body?.attachmentId) {
    acc.attachments += 1
  } else if (mime === 'text/plain' && body?.data && acc.text == null) {
    acc.text = decodeBase64Url(body.data)
  } else if (mime === 'text/html' && body?.data && acc.html == null) {
    acc.html = decodeBase64Url(body.data)
  }

  if (part.parts && part.parts.length > 0) {
    for (const child of part.parts) walk(child, acc)
  }
}

function decodeBase64Url(data: string): string {
  // Node's Buffer accepts 'base64url' directly since v16.
  return Buffer.from(data, 'base64url').toString('utf-8')
}

export function extractBodyFromGmailPayload(payload: GmailMessagePart | undefined | null): ExtractedBody {
  const acc = { text: null as string | null, html: null as string | null, attachments: 0 }
  if (payload) walk(payload, acc)

  // Pick the canonical body text. text/plain wins outright. If only HTML
  // exists, convert it. If neither exists (rare — calendar invites,
  // bare attachments), return all null and let the caller fall back to
  // snippet.
  let bodyText: string | null = null
  let bodySource: 'plain' | 'html-converted' | null = null
  if (acc.text != null) {
    bodyText = acc.text
    bodySource = 'plain'
  } else if (acc.html != null) {
    bodyText = htmlToText(acc.html, {
      wordwrap: false,
      selectors: [
        { selector: 'a', options: { hideLinkHrefIfSameAsText: true } },
        { selector: 'img', format: 'skip' },
      ],
    })
    bodySource = 'html-converted'
  }

  return {
    bodyText,
    bodyHtml: acc.html,
    bodySource,
    attachmentCount: acc.attachments,
  }
}

// Minimal shape of the Gmail MessagePart we depend on. Avoids leaking
// googleapis types into callers that import this for testing.
export interface GmailMessagePart {
  mimeType?: string | null
  filename?: string | null
  body?: { data?: string | null; attachmentId?: string | null; size?: number | null } | null
  parts?: GmailMessagePart[] | null
}

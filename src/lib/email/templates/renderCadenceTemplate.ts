import Handlebars from 'handlebars'
import type { CadenceEventType } from '@prisma/client'
import {
  CADENCE_TEMPLATES,
  type CadenceTemplate,
  type CadenceTemplateContext,
} from './cadenceTemplates'

/**
 * Renders a cadence template to { subject, text, html }. Handlebars compiles
 * each template once and caches; re-rendering with new context is fast.
 *
 * Markdown-style links in the body (`[label](url)`) are detected and
 * converted to anchor tags in the html output, so the brief's "[View your
 * job portal]({{portalLink}})" syntax becomes a real link on send. The text
 * fallback keeps the original markdown so the body still reads naturally if
 * the recipient sees only the plain-text part.
 */
export interface RenderedCadenceEmail {
  subject: string
  text: string
  html: string
}

const subjectCache = new Map<string, Handlebars.TemplateDelegate>()
const bodyCache = new Map<string, Handlebars.TemplateDelegate>()

function compile(template: string, cache: Map<string, Handlebars.TemplateDelegate>): Handlebars.TemplateDelegate {
  let fn = cache.get(template)
  if (!fn) {
    fn = Handlebars.compile(template, { noEscape: true })
    cache.set(template, fn)
  }
  return fn
}

export function renderCadenceTemplateString(
  template: CadenceTemplate,
  context: CadenceTemplateContext,
): RenderedCadenceEmail {
  const subject = compile(template.subject, subjectCache)(context).trim()
  const text = compile(template.body, bodyCache)(context).trim()
  return { subject, text, html: textToHtml(text) }
}

export function renderCadenceTemplate(
  eventType: CadenceEventType,
  context: CadenceTemplateContext,
): RenderedCadenceEmail | null {
  const template = CADENCE_TEMPLATES[eventType]
  if (!template) return null
  return renderCadenceTemplateString(template, context)
}

/**
 * Minimal text→html: escapes HTML, converts markdown links, replaces blank
 * lines with paragraph breaks, single newlines with <br>. Wraps the result
 * in a basic table-based shell that matches the visual style of the COI /
 * agreement emails the rest of the codebase sends.
 */
function textToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

  // Markdown link → <a>
  const linked = escaped.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_, label, url) => `<a href="${url}" style="color:#1f3d5c;">${label}</a>`,
  )

  // Bullet detection: line starts with "• " or "- "
  const paragraphs = linked.split(/\n{2,}/).map((para) => {
    const lines = para.split('\n')
    const isBullets = lines.every((l) => /^\s*[•\-]\s+/.test(l))
    if (isBullets) {
      const items = lines.map((l) => l.replace(/^\s*[•\-]\s+/, '').trim())
      return `<ul style="margin:0 0 12px 18px;padding:0;">${items.map((it) => `<li>${it}</li>`).join('')}</ul>`
    }
    return `<p style="margin:0 0 12px 0;">${lines.join('<br>')}</p>`
  })

  return `<!DOCTYPE html>
<html><body style="font-family:Helvetica,Arial,sans-serif;background:#f9fafb;margin:0;padding:24px;color:#111827;">
  <div style="max-width:560px;margin:0 auto;background:white;border-radius:8px;padding:24px;font-size:14px;line-height:1.55;">
    ${paragraphs.join('\n    ')}
  </div>
</body></html>`
}

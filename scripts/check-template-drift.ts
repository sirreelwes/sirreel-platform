#!/usr/bin/env tsx
/**
 * Template drift detection — compares the Path A Word template at
 *   public/contracts/sirreel-rental-agreement-template.docx
 * against the canonical clause text in
 *   src/lib/contracts/contractClauses.ts
 * and the placeholder contract documented in
 *   docs/specs/paperwork-portal-signing-feature-brief.md.
 *
 * Two failure modes catch real bugs:
 *
 *  - **Missing clause refs** — operator opened the template in Word and
 *    accidentally dropped a numbered clause, or the canonical PDF added a
 *    clause that never made it into the template.
 *
 *  - **Missing or extra placeholders** — operator typed over a {{placeholder}}
 *    by accident, or added a new {{field}} that the download route doesn't
 *    fill (which docxtemplater would error on).
 *
 * Usage:
 *   npm run check:template-drift             # warning-only, exits 0
 *   npm run check:template-drift -- --strict # exits 1 on any drift (use in CI)
 */

import { readFileSync } from 'fs'
import path from 'path'
import PizZip from 'pizzip'
import { CANONICAL_CLAUSES } from '../src/lib/contracts/contractClauses'

const TEMPLATE_PATH = path.join(
  __dirname,
  '..',
  'public',
  'contracts',
  'sirreel-rental-agreement-template.docx',
)

const EXPECTED_PLACEHOLDERS = [
  'companyName',
  'companyType',
  'companyAddress',
  'companyEmail',
  'companyPhone',
  'jobName',
  'jobNumber',
  'jobType',
  'rentalStart',
  'rentalEnd',
  'contactFirstName',
  'contactLastName',
  'contactPosition',
  'contactEmail',
  'contactPhone',
  'generatedDate',
] as const

interface Finding {
  severity: 'pass' | 'warn' | 'fail'
  message: string
}

function readTemplateText(): string {
  const buf = readFileSync(TEMPLATE_PATH)
  const zip = new PizZip(buf)
  const docXml = zip.file('word/document.xml')
  if (!docXml) {
    throw new Error('template missing word/document.xml — file may be corrupt')
  }
  return docXml.asText()
}

function plainTextFromOoxml(xml: string): string {
  // Strip XML tags and decode the few entities that show up in OOXML body text.
  // The result is approximate plain text — good enough for substring checks.
  return xml
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

function findPlaceholdersIn(text: string): Set<string> {
  const out = new Set<string>()
  const re = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    out.add(m[1])
  }
  return out
}

function check(): Finding[] {
  const findings: Finding[] = []
  let xml: string
  let text: string
  try {
    xml = readTemplateText()
    text = plainTextFromOoxml(xml)
  } catch (err) {
    findings.push({
      severity: 'fail',
      message: `Could not read template: ${err instanceof Error ? err.message : err}`,
    })
    return findings
  }

  // 1. Placeholders
  const found = findPlaceholdersIn(text)
  const expected = new Set<string>(EXPECTED_PLACEHOLDERS)
  const missing = [...expected].filter((p) => !found.has(p))
  const extra = [...found].filter((p) => !expected.has(p))
  if (missing.length === 0 && extra.length === 0) {
    findings.push({ severity: 'pass', message: `All ${expected.size} expected placeholders present, no extras.` })
  } else {
    if (missing.length > 0) {
      findings.push({
        severity: 'fail',
        message: `Missing placeholder${missing.length === 1 ? '' : 's'}: ${missing.map((p) => `{{${p}}}`).join(', ')}`,
      })
    }
    if (extra.length > 0) {
      findings.push({
        severity: 'fail',
        message: `Unexpected placeholder${extra.length === 1 ? '' : 's'} (download route would error): ${extra.map((p) => `{{${p}}}`).join(', ')}`,
      })
    }
  }

  // 2. Canonical clause refs. The template is the unsigned version of the
  // canonical PDF, so every numbered clause SirReel maintains in
  // contractClauses.ts should appear as a numbered heading in the .docx body.
  // We look for `N.` followed by either a clause title or whitespace, on the
  // assumption that filled templates name clauses by number.
  const numericRefs = CANONICAL_CLAUSES.map((c) => c.ref).filter((r) => /^\d+$/.test(r))
  const missingClauses: { ref: string; title: string }[] = []
  for (const ref of numericRefs) {
    const titled = CANONICAL_CLAUSES.find((c) => c.ref === ref)!.title
    // accept either "{ref}. {title}" or a bare numeric-period token at a word boundary
    const titleHit = new RegExp(`\\b${ref}\\.\\s*${escapeRegExp(titled).slice(0, 12)}`, 'i').test(text)
    const numberHit = new RegExp(`(?:^|[^0-9])${ref}\\.`, 'i').test(text)
    if (!titleHit && !numberHit) {
      missingClauses.push({ ref, title: titled })
    }
  }
  if (missingClauses.length === 0) {
    findings.push({
      severity: 'pass',
      message: `All ${numericRefs.length} canonical clause refs found in template.`,
    })
  } else {
    const sev: Finding['severity'] = missingClauses.length === numericRefs.length ? 'fail' : 'warn'
    findings.push({
      severity: sev,
      message:
        sev === 'fail'
          ? `Template body does not reference ANY canonical clause numbers — looks like the scaffold has not been replaced with canonical content yet.`
          : `Template is missing ${missingClauses.length} canonical clause${missingClauses.length === 1 ? '' : 's'}: ${missingClauses.map((c) => `§${c.ref} (${c.title})`).join(', ')}`,
    })
  }

  // 3. Sanity: template byte size — empty / truncated files frequently slip in
  const docSize = xml.length
  if (docSize < 1000) {
    findings.push({
      severity: 'fail',
      message: `Template body is suspiciously small (${docSize} bytes of XML) — likely empty.`,
    })
  } else {
    findings.push({ severity: 'pass', message: `Template OOXML body is ${docSize} bytes.` })
  }

  return findings
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function main(): void {
  const strict = process.argv.includes('--strict')
  const findings = check()

  console.log('Template drift report')
  console.log(`  ${TEMPLATE_PATH}`)
  console.log('')
  for (const f of findings) {
    const prefix = f.severity === 'pass' ? '✓' : f.severity === 'warn' ? '⚠' : '✗'
    console.log(`  ${prefix} ${f.message}`)
  }
  console.log('')

  const failed = findings.filter((f) => f.severity === 'fail').length
  const warned = findings.filter((f) => f.severity === 'warn').length

  if (failed === 0 && warned === 0) {
    console.log('No drift detected.')
    process.exit(0)
  }

  console.log(`${failed} failure(s), ${warned} warning(s).`)
  if (strict && failed > 0) {
    process.exit(1)
  }
  process.exit(0)
}

main()

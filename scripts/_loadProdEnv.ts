/**
 * Local-script helper: load .env.prod.local and repair the
 * GOOGLE_SERVICE_ACCOUNT_KEY value so Node's JSON.parse accepts it.
 *
 * The Vercel CLI's env export wraps the service-account JSON in double
 * quotes and represents real newlines as the escape sequence "\n". When
 * dotenv expands the value, it converts those back to real newlines —
 * including the ones inside the `private_key` string field. JSON.parse
 * forbids unescaped real newlines inside string literals, so the parse
 * fails. We do a state-machine walk that re-escapes any newline / carriage
 * return that appears INSIDE a JSON string back to `\n` / `\r`, leaving
 * structural newlines (between fields, outside any string) intact.
 *
 * Production reads the raw env directly from Vercel and is unaffected.
 */

import fs from 'fs'
import path from 'path'
import { config } from 'dotenv'

function repair(): void {
  const file = path.resolve(process.cwd(), '.env.prod.local')
  if (fs.existsSync(file)) {
    config({ path: file })
  }
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  if (!raw) return
  let out = ''
  let inStr = false
  let prev = ''
  for (const ch of raw) {
    if (ch === '"' && prev !== '\\') inStr = !inStr
    if (inStr && ch === '\n') out += '\\n'
    else if (inStr && ch === '\r') out += '\\r'
    else out += ch
    prev = ch
  }
  process.env.GOOGLE_SERVICE_ACCOUNT_KEY = out
}

// Run at module import time so `import './_loadProdEnv'` is enough.
repair()

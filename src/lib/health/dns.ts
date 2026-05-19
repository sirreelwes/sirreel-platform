import { promises as dns } from 'node:dns'
import type { DnsHealth } from './types'

const TIMEOUT_MS = 4000

/**
 * Cloudflare DNS health probe. We don't talk to the Cloudflare API —
 * we just resolve our two production hostnames via Node's resolver
 * and check that the answers look like what they should:
 *
 *   - hq.sirreel.com  → CNAME containing "vercel-dns" (Vercel apex)
 *   - sirreel.com     → at least one A record (Wix-hosted marketing
 *                       site; specific IPs change so we don't pin them)
 *
 * Status:
 *   healthy  — both hostnames resolved and the CNAME looks Vercel-ish
 *   degraded — both resolve but hq.sirreel.com CNAME is not pointing
 *              at Vercel (could be a DNS-cutover in progress)
 *   down     — either lookup fails or hq.sirreel.com has no CNAME
 *
 * NOTE: this probe runs from a Vercel edge/serverless region and uses
 * whatever resolver that runtime uses (not the user's local resolver).
 * That's fine — we want to know what the *server* sees.
 */
export async function checkDns(): Promise<DnsHealth> {
  const lastChecked = new Date().toISOString()
  const start = Date.now()

  const withTimeout = <T>(p: Promise<T>): Promise<T> =>
    Promise.race([
      p,
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`dns timeout after ${TIMEOUT_MS}ms`)), TIMEOUT_MS)),
    ])

  let hqCnameResults: string[] = []
  let hqResolvedAny = false
  try {
    hqCnameResults = await withTimeout(dns.resolveCname('hq.sirreel.com'))
    hqResolvedAny = hqCnameResults.length > 0
  } catch {
    try {
      // Fallback: maybe it's a flat A record now. We still want to
      // report "resolves" vs "doesn't resolve" honestly.
      const a = await withTimeout(dns.resolve4('hq.sirreel.com'))
      hqResolvedAny = a.length > 0
    } catch {
      hqResolvedAny = false
    }
  }

  let sirreelA: string[] = []
  try {
    sirreelA = await withTimeout(dns.resolve4('sirreel.com'))
  } catch {
    sirreelA = []
  }

  const latencyMs = Date.now() - start
  const hqCname = hqCnameResults[0]
  const hqLooksVercel = !!hqCname && /vercel/i.test(hqCname)
  const apexResolved = sirreelA.length > 0

  if (!hqResolvedAny || !apexResolved) {
    return {
      status: 'down',
      latencyMs,
      hqCname,
      sirreelA,
      hqResolves: hqResolvedAny,
      error: !hqResolvedAny
        ? 'hq.sirreel.com did not resolve'
        : 'sirreel.com apex did not resolve',
      lastChecked,
    }
  }
  if (!hqLooksVercel) {
    return {
      status: 'degraded',
      latencyMs,
      hqCname,
      sirreelA,
      hqResolves: true,
      error: hqCname
        ? `hq.sirreel.com CNAME is "${hqCname}" — expected to contain "vercel"`
        : 'hq.sirreel.com resolved via A record instead of CNAME — Vercel normally requires CNAME',
      lastChecked,
    }
  }
  return {
    status: 'healthy',
    latencyMs,
    hqCname,
    sirreelA,
    hqResolves: true,
    lastChecked,
  }
}

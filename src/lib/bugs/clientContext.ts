/**
 * What the browser saw, kept in memory so a bug report can carry it.
 *
 * Wes 2026-09-19: "this problem is going to be severe in the future,
 * especially when employees are sending this and I have no context at
 * all. How do I make sure I have some form of context?"
 *
 * He is right, and the first version was worse than it looked: the box
 * lives on HQ Help, so the `pagePath` it recorded was ALWAYS "/guides".
 * The one field meant to say where someone was said nothing. Wes's own
 * reports only carried context because he typed it in himself; Hugo,
 * mid-task on a phone, will not.
 *
 * The fix that does not depend on anybody remembering anything: the
 * dashboard shell mounts a recorder ONCE and it keeps a small rolling
 * buffer — failed requests, thrown errors, the pages walked through.
 * The shell does not remount on client-side navigation, so when Julian
 * hits a dead button on /jobs/abc, walks to HQ Help and types "the send
 * button did nothing", the failed POST from /jobs/abc is still in the
 * buffer and goes with the report. The context survives the walk.
 *
 * ── What is deliberately NOT recorded ────────────────────────────────
 * Request and response BODIES, headers, and any query parameter that
 * looks like a credential. A bug report is read by people and sent to a
 * model; card numbers, portal tokens and client PII must not ride along.
 * Method, URL path, status and timing answer "what broke" without any of
 * that.
 *
 * Memory only — no localStorage (banned by CLAUDE.md, and this should
 * die with the tab anyway).
 */

export interface FailedRequest {
  /** ms since epoch */
  t: number
  method: string
  /** Path + safe query only; origin dropped, secrets stripped. */
  url: string
  /** HTTP status, or 0 when the request never completed. */
  status: number
}

export interface CapturedError {
  t: number
  message: string
  /** Where it came from, when the browser tells us. */
  source?: string
}

export interface VisitedPage {
  t: number
  path: string
}

export interface BugContext {
  /** The page they were on when they hit Send — usually /guides. */
  reportedFrom: string
  /** Where they actually were before that. The useful one. */
  pages: VisitedPage[]
  failedRequests: FailedRequest[]
  errors: CapturedError[]
  viewport: string
  /** ISO, so a Vercel log can be lined up against it. */
  capturedAt: string
}

const MAX_REQUESTS = 8
const MAX_ERRORS = 5
const MAX_PAGES = 6

/** Query params whose VALUES never leave the browser. */
const SECRET_PARAM = /^(token|key|secret|password|pass|auth|signature|sig|code)$/i

const state = {
  installed: false,
  requests: [] as FailedRequest[],
  errors: [] as CapturedError[],
  pages: [] as VisitedPage[],
}

/** Path + query, origin dropped, secret-looking values masked. */
export function safeUrl(raw: string): string {
  try {
    const u = new URL(raw, typeof window === 'undefined' ? 'http://x' : window.location.origin)
    u.searchParams.forEach((_, k) => {
      if (SECRET_PARAM.test(k)) u.searchParams.set(k, '…')
    })
    const q = u.searchParams.toString()
    return `${u.pathname}${q ? `?${q}` : ''}`.slice(0, 300)
  } catch {
    return String(raw).slice(0, 300)
  }
}

function push<T>(arr: T[], item: T, max: number) {
  arr.push(item)
  if (arr.length > max) arr.shift()
}

/** Record a page the person passed through. Called by the recorder. */
export function notePage(path: string): void {
  if (state.pages[state.pages.length - 1]?.path === path) return
  push(state.pages, { t: Date.now(), path }, MAX_PAGES)
}

/**
 * Patch fetch + error listeners, once per tab.
 *
 * EVERY recording step is inside its own try/catch and the patched fetch
 * does nothing but pass through and observe. This runs on every staff
 * page in HQ; a throw in here would break the app it exists to protect,
 * which would be an unusually stupid way to cause an outage.
 */
export function installBugContextRecorder(): void {
  if (typeof window === 'undefined' || state.installed) return
  state.installed = true

  try {
    const orig = window.fetch
    window.fetch = function (this: unknown, ...args: Parameters<typeof fetch>) {
      const started = Date.now()
      let method = 'GET'
      let url = ''
      try {
        const [input, init] = args
        url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
        method = (init?.method || (input as Request)?.method || 'GET').toUpperCase()
      } catch { /* observing must never break the call */ }

      const p = orig.apply(this as never, args)
      try {
        p.then(
          (res) => {
            try {
              if (!res.ok) push(state.requests, { t: started, method, url: safeUrl(url), status: res.status }, MAX_REQUESTS)
            } catch { /* ignore */ }
            return res
          },
          (err) => {
            try {
              push(state.requests, { t: started, method, url: safeUrl(url), status: 0 }, MAX_REQUESTS)
            } catch { /* ignore */ }
            throw err
          },
        // A rejection handled here must not become an unhandled one.
        ).catch(() => {})
      } catch { /* ignore */ }
      return p
    } as typeof window.fetch

    window.addEventListener('error', (e) => {
      try {
        push(state.errors, {
          t: Date.now(),
          message: String(e.message || 'script error').slice(0, 300),
          source: e.filename ? safeUrl(e.filename) : undefined,
        }, MAX_ERRORS)
      } catch { /* ignore */ }
    })

    window.addEventListener('unhandledrejection', (e) => {
      try {
        const r = (e as PromiseRejectionEvent).reason
        const msg = r instanceof Error ? r.message : String(r)
        push(state.errors, { t: Date.now(), message: msg.slice(0, 300), source: 'promise' }, MAX_ERRORS)
      } catch { /* ignore */ }
    })
  } catch {
    // Recording is a nicety. If the patch fails the app carries on and
    // reports simply arrive without an envelope, exactly as before.
  }
}

/** Everything the buffer holds, for a report being sent right now. */
export function snapshotBugContext(reportedFrom: string): BugContext {
  return {
    reportedFrom,
    pages: [...state.pages],
    failedRequests: [...state.requests],
    errors: [...state.errors],
    viewport:
      typeof window === 'undefined' ? '' : `${window.innerWidth}×${window.innerHeight}`,
    capturedAt: new Date().toISOString(),
  }
}

/** Test seam — lets the unit test drive the buffer without a browser. */
export const __bugContextState = state

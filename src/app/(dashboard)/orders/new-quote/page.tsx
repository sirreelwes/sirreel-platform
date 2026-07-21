import { redirect } from 'next/navigation'

/**
 * LEGACY REDIRECT. The order builder now lives at /orders/new (the mature
 * flow was promoted there and this thin route retired). All in-app entry
 * points were repointed to /orders/new; this redirect is a safety net for
 * bookmarks and any stale links, preserving the query params (inquiryId /
 * clientCompanyId / jobId) the builder reads.
 */
export const dynamic = 'force-dynamic'

export default function NewQuoteRedirect({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>
}) {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(searchParams)) {
    if (typeof v === 'string') sp.set(k, v)
    else if (Array.isArray(v) && typeof v[0] === 'string') sp.set(k, v[0])
  }
  const qs = sp.toString()
  redirect(`/orders/new${qs ? `?${qs}` : ''}`)
}

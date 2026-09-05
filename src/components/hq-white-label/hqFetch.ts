'use client'

/** One fetch helper for every form in the partner's HQ. */
export async function hqFetch<T = Record<string, unknown>>(
  url: string,
  method: 'POST' | 'PATCH',
  body: unknown,
): Promise<{ ok: true; status: number; data: T } | { ok: false; status: number; error: string; data: Record<string, unknown> }> {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (res.ok) return { ok: true, status: res.status, data: data as T }
  return { ok: false, status: res.status, error: typeof data.error === 'string' ? data.error : 'Something went wrong.', data }
}

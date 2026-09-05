/**
 * Per-request helpers for the workspace pages: one cached resolve of the
 * token (the layout and the page both need the workspace), and the base
 * path every link inside the shell hangs off.
 */
import { cache } from 'react'
import { notFound } from 'next/navigation'
import { loadWorkspaceByToken, type HqWorkspace } from './workspace'

export const getWorkspace = cache(async (token: string): Promise<HqWorkspace | null> => loadWorkspaceByToken(token))

export async function requireWorkspace(token: string): Promise<HqWorkspace> {
  const ws = await getWorkspace(token)
  if (!ws) notFound()
  return ws
}

export function basePath(token: string): string {
  return `/hq/${token}`
}

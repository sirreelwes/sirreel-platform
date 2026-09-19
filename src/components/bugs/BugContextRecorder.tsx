'use client'

/**
 * Mounts the bug-context recorder once, in the dashboard shell.
 *
 * Renders nothing. Lives in the shell rather than in the report box
 * because the shell survives client-side navigation — which is the whole
 * point: the failure happens on /jobs/abc and the report gets typed on
 * /guides, and only a buffer that outlived the walk between them can
 * connect the two.
 *
 * Hooks are above every return (the repo has no ESLint — see
 * project_no_eslint_hooks_gap).
 */

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { installBugContextRecorder, notePage } from '@/lib/bugs/clientContext'

export function BugContextRecorder() {
  const pathname = usePathname()

  useEffect(() => {
    installBugContextRecorder()
  }, [])

  useEffect(() => {
    if (pathname) notePage(pathname)
  }, [pathname])

  return null
}

import type { Metadata } from 'next'

/**
 * Client-portal metadata defaults.
 *
 * Every page under /portal used to fall through to the root layout's
 * `title: 'SirReel HQ'` — our internal name for the staff tool. Clients saw
 * it: Safari names a printed PDF after the page title, so when Graduation Day
 * Productions printed their rental agreement on 2026-09-15 the file landed on
 * their desk as "SirReel HQ_Agreement.pdf", and the reply asked what the "HQ
 * Agreement" was. Nothing a client touches should be labelled HQ.
 *
 * `template: '%s'` so a portal page that sets its own title keeps it verbatim
 * — same arrangement as the public marketing group. robots noindex is
 * inherited from the root layout and must stay: these pages are tokenized
 * client documents.
 */
export const metadata: Metadata = {
  title: {
    default: 'SirReel Studio Services',
    template: '%s',
  },
}

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

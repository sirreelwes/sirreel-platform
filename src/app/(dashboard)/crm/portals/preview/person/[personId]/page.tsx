/**
 * /crm/portals/preview/person/[personId] — what one PERSON sees when they
 * sign in to /portal/account: every show they have touched, across every
 * company, current then history.
 *
 * Real data, the real body (PersonAccountView), no session minted and no
 * sign-in stamped. Reached from the Clients pane on /crm/portals and from
 * a person's page.
 */
import { notFound, redirect } from 'next/navigation'
import { requireStaff } from '@/lib/portal/companyPreview'
import { buildPersonAccount } from '@/lib/portal/personAccount'
import { PersonAccountView } from '@/components/portal/PersonAccountView'
import { PersonPreviewBanner } from '@/components/crm/PersonPreviewBanner'

export const dynamic = 'force-dynamic'

export default async function PersonPortalPreviewPage({ params }: { params: { personId: string } }) {
  if (!(await requireStaff())) redirect('/login')
  const account = await buildPersonAccount(params.personId)
  if (!account) notFound()

  const name = `${account.person.firstName} ${account.person.lastName}`.trim()

  return (
    <div className="space-y-4">
      <PersonPreviewBanner personId={account.person.id} name={name} email={account.person.email} />
      <div className="rounded-2xl border border-lt-hairline overflow-hidden">
        <PersonAccountView account={account} preview />
      </div>
    </div>
  )
}

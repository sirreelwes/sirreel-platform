/** Settings — the brand the workspace wears, and where the subscription stands. */
import { requireWorkspace } from '@/lib/hq-white-label/page'
import { HQ_PLANS, HQ_PRODUCT } from '@/lib/hq-white-label/product'
import { SettingsForm } from '@/components/hq-white-label/SettingsForm'
import { LogoForm } from '@/components/hq-white-label/LogoForm'
import { CARD, H2, MUTED, PAGE, PageHead } from '@/components/hq-white-label/ui'

export const dynamic = 'force-dynamic'

export default async function SettingsPage({ params }: { params: { token: string } }) {
  const ws = await requireWorkspace(params.token)
  const plan = HQ_PLANS.find((p) => p.key === ws.plan) ?? HQ_PLANS[0]
  const trialEnds = ws.trialEndsAt ? new Date(ws.trialEndsAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : null
  return (
    <div className={`${PAGE} max-w-[760px]`}>
      <PageHead title="Settings" />
      <h2 className={`${H2} mb-2`}>Your brand</h2>
      <SettingsForm token={params.token} initial={{ brandName: ws.brandName, accentColor: ws.accentColor }} />
      <h2 className={`${H2} mt-8 mb-2`}>Your logo</h2>
      <LogoForm token={params.token} hasLogo={ws.hasLogo} />

      <h2 className={`${H2} mt-8 mb-2`}>Subscription</h2>
      <div className={`${CARD} p-5`}>
        <div className="text-[15px] font-semibold">
          {ws.status === 'TRIAL' && (ws.trialExpired ? `Free trial ended ${trialEnds}` : `Free trial · ends ${trialEnds}`)}
          {ws.status === 'ACTIVE' && `${plan.name} plan`}
        </div>
        <p className={`${MUTED} mt-1`}>{plan.blurb}</p>
        <ul className="mt-3 space-y-1 text-[14px] text-[#111827]">
          {plan.includes.map((f) => <li key={f} className="flex gap-2"><span className="text-[var(--hq-accent)]">✓</span>{f}</li>)}
        </ul>
        <p className={`${MUTED} mt-4`}>
          {plan.monthlyUsd == null
            ? `Pricing is announced before your trial ends. `
            : `$${plan.monthlyUsd}/month. `}
          Billing questions: <a href={`mailto:${HQ_PRODUCT.supportEmail}`} className="font-semibold underline">{HQ_PRODUCT.supportEmail}</a>.
        </p>
      </div>

      <h2 className={`${H2} mt-8 mb-2`}>Your link</h2>
      <div className={`${CARD} p-5 text-[14px]`}>
        <p>The address of this workspace is your login. Anyone holding it can open it, so share it only with your own team and bookmark it. If it ever gets out, write to {HQ_PRODUCT.supportEmail} and we&rsquo;ll issue a new one — the old one stops working immediately.</p>
      </div>
    </div>
  )
}

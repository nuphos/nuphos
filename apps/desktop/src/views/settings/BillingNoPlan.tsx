import clsx from 'clsx'
import { Check, Cpu, Pause, Settings2 } from 'lucide-react'

import { t } from '../../i18n'

import { BillingButton } from './BillingParts'
import { planFits } from './billingPresentation'
import { BOX_PLANS } from './boxPresentation'
import { BoxUsageChart } from './BoxUsageChart'

import type { OpenBilling } from './billing'

const HOW_IT_WORKS = [
  {
    icon: Cpu,
    text: t('You pay for the vCPU of running computers; each computer counts at its own size.'),
  },
  { icon: Pause, text: t('Paused computers are free and wake up as you left them.') },
  { icon: Settings2, text: t('Change or cancel anytime in the billing portal.') },
]

/**
 * The Box plans with price and size, and a Checkout per plan when `billing` is given. With the
 * team's `current` plan and the vCPU it `needs` running, plans too small are dimmed and the
 * smallest that fits is recommended.
 */
export function PlanCards({
  billing,
  current = null,
  needs,
}: {
  billing: OpenBilling | null
  current?: number | null
  needs?: number
}) {
  const fits = planFits(BOX_PLANS, current, needs)

  return (
    <div className="@container">
      <div className="grid grid-cols-1 gap-3 @lg:grid-cols-3">
        {BOX_PLANS.map((plan, index) => {
          const { state, recommended } = fits[index] ?? { state: 'fits', recommended: false }

          return (
            <section
              key={plan.vcpus}
              className={clsx(
                'flex flex-col gap-3 rounded-[10px] border bg-zGray-850 p-4 text-[13px] transition-opacity',
                recommended ? 'border-zViolet-500' : 'border-white/[0.09]',
                state === 'short' && 'opacity-50',
              )}
            >
              <div className="flex items-center gap-2">
                <h3 className="text-[15px] font-semibold text-main">{plan.name}</h3>
                {recommended && (
                  <span className="rounded-full bg-zViolet-accent/15 px-2 py-0.5 text-[11px] text-zViolet-accent">
                    {t('Recommended')}
                  </span>
                )}
                {state === 'current' && (
                  <span className="rounded-full bg-zGray-800 px-2 py-0.5 text-[11px] text-secondary">
                    {t('Current plan')}
                  </span>
                )}
              </div>
              <p className="text-main">
                <span className="text-[22px] font-semibold">${plan.usdPerMonth}</span>
                <span className="text-tertiary"> {t('/ month')}</span>
              </p>
              <div>
                <p className="font-medium text-main">
                  {t('Up to {n} vCPU running', { n: plan.vcpus })}
                </p>
                <p className="text-[12px] text-tertiary">{plan.example}</p>
              </div>
              <ul className="flex flex-1 flex-col gap-1.5 text-secondary">
                {plan.perks.map((perk) => (
                  <li key={perk} className="flex gap-2">
                    <Check size={14} className="mt-0.5 shrink-0 text-success" />
                    {perk}
                  </li>
                ))}
              </ul>
              {billing && state === 'fits' && (
                <BillingButton billing={billing} vcpus={plan.vcpus} className="justify-center">
                  {current === null
                    ? t('Start with {plan}', { plan: plan.name })
                    : t('Change plan')}
                </BillingButton>
              )}
              {billing && state === 'short' && needs !== undefined && (
                <p className="text-center text-[12px] text-tertiary">
                  {t('Too small for the new computer')}
                </p>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}

/** Before a plan: what a Box plan gets the team, and a Checkout per plan for administrators. */
export function NoPlan({
  teamId,
  billing,
  isAdmin,
  admin,
}: {
  teamId: string
  /** Absent for members, who can't buy one, and where this deployment bills nothing. */
  billing: OpenBilling | null
  isAdmin: boolean
  /** Who a member asks; null until known. */
  admin: string | null
}) {
  return (
    <>
      <section className="flex flex-col gap-2">
        <h2 className="text-[22px] font-semibold text-main">
          {t('Keep your agents running in the cloud')}
        </h2>
        <p className="text-[14px] text-secondary">
          {t(
            'A computer plan gives your team cloud computers that run your agents 24/7, each with its own desktop, shared with your teammates.',
          )}
        </p>
      </section>
      <PlanCards billing={billing} />
      {!billing && (
        <p className="text-[13px] text-tertiary">
          {isAdmin
            ? t('Plans can’t be bought on this deployment yet.')
            : admin
              ? t('Ask {name} to choose a plan.', { name: admin })
              : t('Ask a team administrator to choose a plan.')}
        </p>
      )}
      <section className="flex flex-col gap-2.5">
        <h2 className="text-[13px] font-semibold text-main">{t('How it works')}</h2>
        {HOW_IT_WORKS.map(({ icon: Icon, text }) => (
          <p key={text} className="flex items-center gap-2.5 text-[13px] text-secondary">
            <Icon size={14} className="shrink-0 text-tertiary" />
            {text}
          </p>
        ))}
      </section>
      <BoxUsageChart teamId={teamId} showLimit={false} pastOnly />
    </>
  )
}

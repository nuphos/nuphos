import clsx from 'clsx'
import { Check, Cpu, Pause, Settings2 } from 'lucide-react'

import { BillingButton } from './BillingParts'
import { planFits } from './billingPresentation'
import { BOX_PLANS } from './boxPresentation'
import { BoxUsageChart } from './BoxUsageChart'

import type { OpenBilling } from './billing'

const HOW_IT_WORKS = [
  {
    icon: Cpu,
    text: 'You pay for the vCPU of running computers; each computer counts at its own size.',
  },
  { icon: Pause, text: 'Paused computers are free and wake up as you left them.' },
  { icon: Settings2, text: 'Change or cancel anytime in the billing portal.' },
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
    <div className="grid grid-cols-3 gap-3">
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
                  Recommended
                </span>
              )}
              {state === 'current' && (
                <span className="rounded-full bg-zGray-800 px-2 py-0.5 text-[11px] text-secondary">
                  Current plan
                </span>
              )}
            </div>
            <p className="text-main">
              <span className="text-[22px] font-semibold">${plan.usdPerMonth}</span>
              <span className="text-tertiary"> / month</span>
            </p>
            <div>
              <p className="font-medium text-main">Up to {plan.vcpus} vCPU running</p>
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
                {current === null ? `Start with ${plan.name}` : 'Change plan'}
              </BillingButton>
            )}
            {billing && state === 'short' && needs !== undefined && (
              <p className="text-center text-[12px] text-tertiary">
                Too small for the new computer
              </p>
            )}
          </section>
        )
      })}
    </div>
  )
}

/** Before a plan: what a Box plan gets the team, and a Checkout per plan for administrators. */
export function NoPlan({
  teamId,
  billing,
}: {
  teamId: string
  /** Absent for members, who can't buy one. */
  billing: OpenBilling | null
}) {
  return (
    <>
      <section className="flex flex-col gap-2">
        <h2 className="text-[22px] font-semibold text-main">
          Keep your agents running in the cloud
        </h2>
        <p className="text-[14px] text-secondary">
          A computer plan gives your team cloud computers that run your agents 24/7, each with its
          own desktop, shared with your teammates.
        </p>
      </section>
      <PlanCards billing={billing} />
      {!billing && (
        <p className="text-[13px] text-tertiary">Ask a team administrator to choose a plan.</p>
      )}
      <section className="flex flex-col gap-2.5">
        <h2 className="text-[13px] font-semibold text-main">How it works</h2>
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

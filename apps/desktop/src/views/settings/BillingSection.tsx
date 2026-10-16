import { AlertCircle, Box, CalendarDays, Info, Lock } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api } from '../../api'
import { useOpenBilling } from './billing'
import { NoPlan } from './BillingNoPlan'
import {
  BillingButton,
  CARD,
  InUse,
  Invoices,
  LimitCallout,
  Pill,
  PlansTable,
} from './BillingParts'
import { blockedStart, boxRows, planDetail, renewal, statusTone } from './billingPresentation'
import { BOX_PLANS } from './boxPresentation'
import { BoxUsageChart } from './BoxUsageChart'
import { SectionHeader } from './shared'
import { useAgentDevices } from './useAgentDevices'
import { useBoxUsage } from './useBoxUsage'

import type { OpenBilling } from './billing'
import type { BillingSummary, BoxUsage } from '../../api/device-types'

function PlanCard({
  billing,
  isAdmin,
  usage,
  summary,
  error,
}: {
  billing: OpenBilling
  isAdmin: boolean
  usage: BoxUsage
  summary: BillingSummary | null
  error: string | null
}) {
  const plan = BOX_PLANS.find(({ vcpus }) => vcpus === usage.limitVcpus)
  const billed = summary?.plan

  return (
    <section className={CARD}>
      <div className="flex items-center gap-2.5">
        <h2 className="text-[20px] font-semibold text-main">
          {plan?.name ?? `${String(usage.limitVcpus)} vCPU`}
        </h2>
        {plan && <span className="text-[14px] text-secondary">{planDetail(plan)}</span>}
        {billed && <Pill tone={statusTone(billed.status)}>{billed.status.replace('_', ' ')}</Pill>}
        {isAdmin && usage.billingUrl && (
          <BillingButton billing={billing} className="ml-auto">
            Manage billing
          </BillingButton>
        )}
      </div>
      <p className="flex items-center gap-2 text-secondary">
        <Box size={14} className="text-zViolet-accent" />
        Your running Boxes can use {usage.limitVcpus} vCPU in total. Paused Boxes use none.
      </p>
      {isAdmin ? (
        <>
          {error && !billed ? (
            <p className="flex items-center gap-2 text-warning">
              <AlertCircle size={14} />
              {error}
            </p>
          ) : (
            <p className="flex items-center gap-2 text-tertiary">
              <CalendarDays size={14} />
              {renewal(billed, error)}
            </p>
          )}
          {usage.billingUrl && (
            <p className="text-[12px] text-tertiary">
              Manage billing opens the Stripe portal in your browser: change plan, update card,
              cancel.
            </p>
          )}
        </>
      ) : (
        <p className="flex items-center gap-2 text-[12px] text-tertiary">
          <Lock size={13} />
          Only team administrators can change the plan.
        </p>
      )}
    </section>
  )
}

function Subscribed({
  teamId,
  billing,
  isAdmin,
  usage,
  summary,
  error,
}: {
  teamId: string
  billing: OpenBilling
  isAdmin: boolean
  usage: BoxUsage
  summary: BillingSummary | null
  error: string | null
}) {
  const { list } = useAgentDevices(() => 0, teamId, { teamId })
  const rows = boxRows(usage, list?.devices ?? [])
  const blocked = blockedStart(usage, rows)

  return (
    <>
      <PlanCard billing={billing} isAdmin={isAdmin} usage={usage} summary={summary} error={error} />
      {blocked && (
        <LimitCallout billing={billing} isAdmin={isAdmin} usage={usage} message={blocked} />
      )}
      <section className="flex flex-col gap-3">
        <InUse usage={usage} rows={rows} blocked={blocked !== null} />
        <BoxUsageChart teamId={teamId} showLimit />
      </section>
      {!blocked && (
        <p className="flex gap-2.5 text-[13px] text-tertiary">
          <Info size={14} className="mt-0.5 shrink-0" />
          When running Boxes reach the plan&apos;s vCPU, they keep running; starting or resuming a
          Box that doesn&apos;t fit is refused until you pause a Box or upgrade.
        </p>
      )}
      <section className="flex flex-col gap-3">
        <h2 className="text-[13px] font-semibold text-main">Plans</h2>
        <PlansTable current={usage.limitVcpus} />
        <p className="text-[12px] text-tertiary">
          The limit counts the vCPU of running Boxes; each Box counts at its own size.{' '}
          {isAdmin
            ? 'Change plan, card or cancel in Manage billing.'
            : 'Only team administrators can change the plan.'}
        </p>
      </section>
      {summary && <Invoices invoices={summary.invoices} />}
    </>
  )
}

/**
 * The team's Box plan. Administrators start one in Stripe Checkout and change it in the
 * Stripe portal; other members see the plan and its use.
 */
export function BillingSection({ teamId, isAdmin }: { teamId: string; isAdmin: boolean }) {
  const { usage, watch } = useBoxUsage(teamId)
  const billing = useOpenBilling(teamId, watch)
  const [summary, setSummary] = useState<BillingSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const billed = isAdmin && Boolean(usage?.billingUrl)

  useEffect(() => {
    if (!billed) return
    let cancelled = false

    api.boxBillingSummary(teamId).then(
      (next) => {
        if (!cancelled) setSummary(next)
      },
      () => {
        if (!cancelled) setError('Could not load billing details.')
      },
    )

    return () => {
      cancelled = true
    }
  }, [teamId, billed, usage?.subscribed, usage?.limitVcpus])

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin">
      <div className="mx-auto flex max-w-[640px] flex-col gap-7 px-8 py-10">
        <SectionHeader title="Billing" description="Your team's Box plan, billed monthly." />
        {!usage && <p className="text-[13px] text-tertiary">Loading…</p>}
        {usage?.limitVcpus === null && (
          <p className="text-[13px] text-tertiary">Boxes have no vCPU limit on this deployment.</p>
        )}
        {usage && usage.limitVcpus !== null && usage.subscribed && (
          <Subscribed
            teamId={teamId}
            billing={billing}
            isAdmin={isAdmin}
            usage={usage}
            summary={summary}
            error={error}
          />
        )}
        {usage && usage.limitVcpus !== null && !usage.subscribed && (
          <NoPlan teamId={teamId} billing={isAdmin && usage.billingUrl ? billing : null} />
        )}
      </div>
    </div>
  )
}

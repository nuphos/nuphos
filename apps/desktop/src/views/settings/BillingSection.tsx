import clsx from 'clsx'
import { useEffect, useState } from 'react'

import { api } from '../../api'
import { Button } from '../../components/ui/button'

import { openBilling } from './billing'
import { BOX_PLANS } from './boxPresentation'
import { SectionHeader } from './shared'
import { useBoxUsage } from './useBoxUsage'

import type { BillingSummary, BoxUsage } from '../../api/device-types'

const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : '—')
const money = (cents: number, currency: string) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100)

/** The three plans side by side. Before a subscription one is picked here; after, the portal changes it. */
function PlanOptions({
  current,
  selected,
  onSelect,
}: {
  current: number | null
  selected: number | null
  onSelect: ((vcpus: number) => void) | null
}) {
  return (
    <div role="radiogroup" aria-label="Box plan" className="grid grid-cols-3 gap-3">
      {BOX_PLANS.map(({ vcpus, usdPerMonth }) => {
        const isCurrent = vcpus === current
        const marked = isCurrent || vcpus === selected

        return (
          <button
            key={vcpus}
            type="button"
            role="radio"
            aria-checked={marked}
            disabled={!onSelect}
            onClick={() => onSelect?.(vcpus)}
            className={clsx(
              'rounded-lg border px-4 py-3 text-left transition-colors disabled:cursor-default',
              marked
                ? 'border-zViolet-500/70 bg-zViolet-500/10'
                : 'border-zGray-800 enabled:hover:border-zGray-700',
            )}
          >
            <span className="flex items-baseline justify-between gap-2">
              <span className="text-[13px] font-medium text-main">{vcpus} vCPU</span>
              {isCurrent && <span className="text-[11px] text-zViolet-accent">Current</span>}
            </span>
            <span className="mt-1 block text-[18px] font-semibold text-main">
              ${usdPerMonth}
              <span className="text-[12px] font-normal text-tertiary"> / month</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

function PlanDetails({ usage, plan }: { usage: BoxUsage; plan: BillingSummary['plan'] }) {
  const limit = usage.limitVcpus ?? 0

  return (
    <dl className="grid grid-cols-[160px_1fr] gap-y-2 text-[13px]">
      <dt className="text-tertiary">vCPU in use</dt>
      <dd>
        {usage.usedVcpus === null
          ? 'Unavailable'
          : limit === 0
            ? `${String(usage.usedVcpus)}, no plan`
            : `${String(usage.usedVcpus)} of ${String(limit)}`}
      </dd>
      {plan && (
        <>
          <dt className="text-tertiary">Status</dt>
          <dd className="capitalize">{plan.status.replace('_', ' ')}</dd>
          <dt className="text-tertiary">{plan.cancelAt ? 'Ends on' : 'Renews on'}</dt>
          <dd>{date(plan.cancelAt ?? plan.currentPeriodEnd)}</dd>
          {plan.card && (
            <>
              <dt className="text-tertiary">Card</dt>
              <dd className="capitalize">
                {plan.card.brand} •••• {plan.card.last4}
              </dd>
            </>
          )}
        </>
      )}
    </dl>
  )
}

function Invoices({ invoices }: { invoices: BillingSummary['invoices'] }) {
  if (invoices.length === 0) return null

  return (
    <section>
      <h2 className="mb-2 text-[13px] font-medium text-main">Recent invoices</h2>
      <ul className="flex flex-col gap-1 text-[13px]">
        {invoices.map(({ number, created, total, currency, status, url }) => (
          <li key={number ?? created} className="flex gap-3">
            <span className="w-28 text-tertiary">{date(created)}</span>
            <span className="w-24">{money(total, currency)}</span>
            <span className="w-20 capitalize text-tertiary">{status}</span>
            {url && (
              <button
                type="button"
                className="text-secondary underline"
                onClick={() => void api.appOpenExternal(url)}
              >
                View
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

function PlanBody({
  teamId,
  isAdmin,
  usage,
  summary,
  error,
}: {
  teamId: string
  isAdmin: boolean
  usage: BoxUsage
  summary: BillingSummary | null
  error: string | null
}) {
  const [selected, setSelected] = useState(BOX_PLANS[0].vcpus)

  if (usage.limitVcpus === null)
    return <p className="text-[13px] text-tertiary">Boxes have no vCPU limit on this deployment.</p>

  const canBuy = isAdmin && usage.billingUrl !== null

  return (
    <>
      <PlanOptions
        current={usage.subscribed ? usage.limitVcpus : null}
        selected={usage.subscribed ? null : selected}
        onSelect={canBuy && !usage.subscribed ? setSelected : null}
      />
      {canBuy && (
        <div>
          <Button
            size="sm"
            onClick={() => void openBilling(teamId, usage.subscribed ? undefined : selected)}
          >
            {usage.subscribed ? 'Manage billing' : 'Choose plan'}
          </Button>
        </div>
      )}
      {!isAdmin && (
        <p className="text-[13px] text-tertiary">Only team administrators can change the plan.</p>
      )}
      <PlanDetails usage={usage} plan={summary?.plan ?? null} />
      {error && <p className="text-[13px] text-error">{error}</p>}
      {summary && <Invoices invoices={summary.invoices} />}
    </>
  )
}

/**
 * The team's Box plan. Administrators start one in Stripe Checkout and change it in the
 * Stripe portal; other members see the plan and its use.
 */
export function BillingSection({ teamId, isAdmin }: { teamId: string; isAdmin: boolean }) {
  const { usage } = useBoxUsage(teamId)
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
  }, [teamId, billed, usage])

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin">
      <div className="mx-auto flex max-w-[640px] flex-col gap-5 px-8 py-10">
        <SectionHeader title="Billing" description="Your team's Box plan, billed monthly." />
        {usage ? (
          <PlanBody
            teamId={teamId}
            isAdmin={isAdmin}
            usage={usage}
            summary={summary}
            error={error}
          />
        ) : (
          <p className="text-[13px] text-tertiary">Loading…</p>
        )}
      </div>
    </div>
  )
}

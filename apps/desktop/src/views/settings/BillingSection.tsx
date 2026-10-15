import { useEffect, useState } from 'react'

import { api } from '../../api'
import { PageHeader } from '../../components/PageHeader'
import { Button } from '../../components/ui/button'

import { openBilling } from './billing'
import { BOX_VCPU_TIERS } from './boxPresentation'
import { useBoxUsage } from './useBoxUsage'

import type { BillingSummary, BoxUsage } from '../../api/device-types'

const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : '—')
const money = (cents: number, currency: string) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100)

function PlanRows({ usage, plan }: { usage: BoxUsage; plan: BillingSummary['plan'] }) {
  const limit = usage.limitVcpus ?? 0

  return (
    <dl className="grid grid-cols-[160px_1fr] gap-y-2">
      <dt className="text-tertiary">Plan</dt>
      <dd>{limit === 0 ? 'No plan' : `${String(limit)} vCPU`}</dd>
      <dt className="text-tertiary">vCPU in use</dt>
      <dd>
        {usage.usedVcpus === null
          ? 'Unavailable'
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

/** Everything that changes the plan happens in Stripe: Checkout to start one, the portal after. */
function PlanActions({ teamId, subscribed }: { teamId: string; subscribed: boolean }) {
  if (subscribed)
    return (
      <div>
        <Button size="sm" onClick={() => void openBilling(teamId)}>
          Manage billing
        </Button>
      </div>
    )

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-secondary">Choose a plan:</span>
      {BOX_VCPU_TIERS.map((vcpus) => (
        <Button
          key={vcpus}
          size="sm"
          variant="secondary"
          onClick={() => void openBilling(teamId, vcpus)}
        >
          {vcpus} vCPU
        </Button>
      ))}
    </div>
  )
}

function Invoices({ invoices }: { invoices: BillingSummary['invoices'] }) {
  if (invoices.length === 0) return null

  return (
    <section>
      <h3 className="mb-2 text-[12px] font-medium text-secondary">Recent invoices</h3>
      <ul className="flex flex-col gap-1">
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
  if (usage.limitVcpus === null)
    return <p className="text-tertiary">Boxes have no vCPU limit on this deployment.</p>

  return (
    <>
      <PlanRows usage={usage} plan={summary?.plan ?? null} />
      {isAdmin && usage.billingUrl !== null && (
        <PlanActions teamId={teamId} subscribed={usage.subscribed} />
      )}
      {!isAdmin && <p className="text-tertiary">Only team administrators can change the plan.</p>}
      {error && <p className="text-error">{error}</p>}
      {summary && <Invoices invoices={summary.invoices} />}
    </>
  )
}

/**
 * The team's Box plan, read-only. Administrators see the Stripe details and change
 * anything in the Stripe portal; other members see only the plan's vCPU limit.
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
    <div className="flex h-full min-h-0 flex-1 flex-col bg-main">
      <PageHeader title="Billing" subtitle="Your team's Box plan" />
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-4 px-8 py-6 text-[13px]">
        {usage ? (
          <PlanBody
            teamId={teamId}
            isAdmin={isAdmin}
            usage={usage}
            summary={summary}
            error={error}
          />
        ) : (
          <p className="text-tertiary">Loading…</p>
        )}
      </div>
    </div>
  )
}

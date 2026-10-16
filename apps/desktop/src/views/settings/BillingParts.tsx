import clsx from 'clsx'
import { AlertTriangle, ArrowUpRight, Box, Loader2, Users } from 'lucide-react'

import { api } from '../../api'
import { Button } from '../../components/ui/button'

import { date, money, planDetail, statusTone } from './billingPresentation'
import { BOX_PLANS } from './boxPresentation'

import type { OpenBilling } from './billing'
import type { BoxRow } from './billingPresentation'
import type { BillingSummary, BoxUsage } from '../../api/device-types'
import type { ReactNode } from 'react'

export const CARD =
  'flex flex-col gap-2.5 rounded-[10px] border border-white/[0.09] bg-zGray-850 p-5 text-[13px]'
export const LIST = 'divide-y divide-white/[0.09] rounded-lg border border-white/[0.09] text-[13px]'
export function Pill({
  tone,
  children,
}: {
  tone: 'success' | 'warning' | 'muted'
  children: string
}) {
  return (
    <span
      className={clsx(
        'rounded-full px-2 py-0.5 text-[11px] font-medium capitalize',
        tone === 'success' && 'bg-success/10 text-success',
        tone === 'warning' && 'bg-warning/10 text-warning',
        tone === 'muted' && 'bg-zGray-800 text-tertiary',
      )}
    >
      {children}
    </span>
  )
}
/** Opens Checkout for `vcpus`, or the portal; disabled with "Opening…" while any billing page is on its way. */
export function BillingButton({
  billing,
  vcpus,
  className,
  children,
}: {
  billing: OpenBilling
  vcpus?: number
  className?: string
  children: ReactNode
}) {
  return (
    <Button
      size="sm"
      className={className}
      disabled={billing.opening !== null}
      onClick={() => billing.open(vcpus)}
    >
      {billing.opening === (vcpus ?? 0) ? (
        <>
          <Loader2 size={13} className="animate-spin" />
          Opening…
        </>
      ) : (
        <>
          {children}
          <ArrowUpRight size={13} />
        </>
      )}
    </Button>
  )
}
export function LimitCallout({
  billing,
  isAdmin,
  usage,
  message,
}: {
  billing: OpenBilling
  isAdmin: boolean
  usage: BoxUsage
  message: string
}) {
  const next = BOX_PLANS.find(({ vcpus }) => vcpus > (usage.limitVcpus ?? 0))

  return (
    <section className="flex flex-col gap-2.5 rounded-[10px] border border-warning/35 bg-warning/[0.08] p-4 text-[13px]">
      <p className="flex items-center gap-2 font-semibold text-warning">
        <AlertTriangle size={16} />
        {message}
      </p>
      <p className="text-secondary">
        Your running Boxes use {usage.usedVcpus} of {usage.limitVcpus} vCPU. They keep running;
        starting or resuming a Box that doesn&apos;t fit is refused until you pause a Box
        {next ? ' or upgrade' : ''}.
      </p>
      {next &&
        (isAdmin && usage.billingUrl ? (
          <div className="flex items-center gap-3">
            <BillingButton billing={billing}>Upgrade to {next.name}</BillingButton>
            <span className="text-[12px] text-tertiary">
              {next.name} · {planDetail(next)}
            </span>
          </div>
        ) : (
          <p className="text-[12px] text-tertiary">
            Pause one of your Boxes, or ask a team administrator to upgrade to {next.name}.
          </p>
        ))}
    </section>
  )
}

export function InUse({
  usage,
  rows,
  blocked,
}: {
  usage: BoxUsage
  rows: BoxRow[]
  blocked: boolean
}) {
  const used = usage.usedVcpus ?? 0
  const limit = usage.limitVcpus ?? 0

  return (
    <>
      <div className="flex items-center justify-between text-[13px]">
        <h2 className="font-semibold text-main">In use now</h2>
        <span className="text-tertiary">
          <span className={clsx('font-semibold', blocked ? 'text-warning' : 'text-main')}>
            {usage.usedVcpus ?? '—'}
          </span>{' '}
          of {limit} vCPU running
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-zGray-800">
        <div
          className={clsx('h-full rounded-full', blocked ? 'bg-warning' : 'bg-zViolet-500')}
          style={{ width: `${String(Math.min(100, limit ? (used / limit) * 100 : 0))}%` }}
        />
      </div>
      {rows.length > 0 && (
        <ul className={LIST}>
          {rows.map((row) => (
            <li key={row.key} className="flex h-10 items-center gap-2.5 px-3.5">
              {row.teammates ? (
                <Users size={15} className="text-tertiary" />
              ) : (
                <Box size={15} className="text-secondary" />
              )}
              <span className={row.teammates ? 'text-secondary' : 'font-medium text-main'}>
                {row.name}
              </span>
              <span className="flex items-center gap-1.5 text-[12px] text-secondary">
                <span
                  className={clsx(
                    'h-1.5 w-1.5 rounded-full',
                    row.running ? 'bg-success' : 'bg-zGray-500',
                  )}
                />
                {row.running ? 'Running' : `Paused · ${String(row.vcpus)} vCPU when running`}
              </span>
              <span
                className={clsx('ml-auto', row.running ? 'font-medium text-main' : 'text-tertiary')}
              >
                {row.running ? row.vcpus : 0} vCPU
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[12px] text-tertiary">
        Paused Boxes use no vCPU. {Math.max(0, limit - used)} vCPU free.
      </p>
    </>
  )
}

/** The three plans, the team's current one marked; the portal changes it. */
export function PlansTable({ current }: { current: number | null }) {
  return (
    <div className="overflow-hidden rounded-lg border border-white/[0.09] text-[13px]">
      <div className="flex px-3.5 py-2 text-[11px] font-medium text-tertiary">
        <span className="w-40">Plan</span>
        <span className="flex-1">Running vCPU</span>
        <span>Price</span>
      </div>
      {BOX_PLANS.map(({ name, vcpus, usdPerMonth }) => (
        <div
          key={vcpus}
          className={clsx(
            'flex h-10 w-full items-center border-t border-white/[0.09] px-3.5',
            vcpus === current && 'bg-zViolet-500/[0.08]',
          )}
        >
          <span className="flex w-40 items-center gap-2">
            <span className="font-medium text-main">{name}</span>
            {vcpus === current && (
              <span className="rounded-full bg-zViolet-accent/15 px-2 py-0.5 text-[11px] text-zViolet-accent">
                Current
              </span>
            )}
          </span>
          <span className="flex-1 text-secondary">Up to {vcpus} vCPU</span>
          <span className="font-medium text-main">
            ${usdPerMonth} <span className="text-[12px] font-normal text-tertiary">/ month</span>
          </span>
        </div>
      ))}
    </div>
  )
}

export function Invoices({ invoices }: { invoices: BillingSummary['invoices'] }) {
  if (invoices.length === 0) return null

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[13px] font-semibold text-main">Recent invoices</h2>
      <ul className={LIST}>
        {invoices.map(({ number, created, total, currency, status, url }) => (
          <li key={number ?? created} className="flex h-9 items-center gap-3 px-3.5">
            <span className="w-28 text-tertiary">{date(created)}</span>
            <span className="w-20 text-main">{money(total, currency)}</span>
            {status && <Pill tone={statusTone(status)}>{status}</Pill>}
            {url && (
              <button
                type="button"
                className="ml-auto flex items-center gap-1 text-secondary hover:text-main"
                onClick={() => void api.appOpenExternal(url)}
              >
                View
                <ArrowUpRight size={13} />
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

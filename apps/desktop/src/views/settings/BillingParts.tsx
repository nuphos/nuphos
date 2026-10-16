import clsx from 'clsx'
import { AlertTriangle, ArrowUpRight, Box, Users } from 'lucide-react'

import { api } from '../../api'
import { Button } from '../../components/ui/button'

import { openBilling } from './billing'
import { date, money, planDetail, statusTone } from './billingPresentation'
import { BOX_PLANS } from './boxPresentation'

import type { BoxRow } from './billingPresentation'
import type { BillingSummary, BoxUsage } from '../../api/device-types'

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
export function LimitCallout({
  teamId,
  isAdmin,
  usage,
  message,
}: {
  teamId: string
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
            <Button size="sm" onClick={() => void openBilling(teamId)}>
              Upgrade to {next.name}
              <ArrowUpRight size={13} />
            </Button>
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

/** The three plans. Before a subscription one is picked here; after, the portal changes it. */
export function PlansTable({
  current,
  selected,
  onSelect,
}: {
  current: number | null
  selected?: number
  onSelect?: (vcpus: number) => void
}) {
  return (
    <div
      role={onSelect ? 'radiogroup' : undefined}
      aria-label="Box plan"
      className="overflow-hidden rounded-lg border border-white/[0.09] text-[13px]"
    >
      <div className="flex px-3.5 py-2 text-[11px] font-medium text-tertiary">
        <span className="w-40">Plan</span>
        <span className="flex-1">Running vCPU</span>
        <span>Price</span>
      </div>
      {BOX_PLANS.map(({ name, vcpus, usdPerMonth }) => {
        const marked = vcpus === current || vcpus === selected
        const cells = (
          <>
            <span className="flex w-40 items-center gap-2">
              {onSelect && (
                <span
                  className={clsx(
                    'flex h-3.5 w-3.5 items-center justify-center rounded-full border-[1.5px]',
                    marked ? 'border-zViolet-500 bg-zViolet-500' : 'border-zGray-400',
                  )}
                >
                  {marked && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                </span>
              )}
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
          </>
        )
        const rowClass = clsx(
          'flex h-10 w-full items-center border-t border-white/[0.09] px-3.5 text-left',
          marked && 'bg-zViolet-500/[0.08]',
        )

        return onSelect ? (
          <button
            key={vcpus}
            type="button"
            role="radio"
            aria-checked={marked}
            onClick={() => onSelect(vcpus)}
            className={rowClass}
          >
            {cells}
          </button>
        ) : (
          <div key={vcpus} className={rowClass}>
            {cells}
          </div>
        )
      })}
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

import { t } from '../../i18n/index.ts'

import type { BOX_PLANS } from './boxPresentation'
import type { AgentDevice, BillingSummary, BoxUsage } from '../../api/device-types'

export const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : '—')
export const money = (cents: number, currency: string) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100)
export const planDetail = ({ vcpus, usdPerMonth }: (typeof BOX_PLANS)[number]) =>
  t('up to {n} vCPU running · ${price} / month', { n: vcpus, price: usdPerMonth })

export type BoxRow = {
  key: string
  name: string
  vcpus: number
  running: boolean
  teammates?: true
}

/** The team's Boxes by size: the viewer's own by name, teammates' running ones as one row. */
export function boxRows(usage: BoxUsage, devices: AgentDevice[]): BoxRow[] {
  const own = new Map(
    devices.flatMap((d) => (d.box?.sandboxId ? [[d.box.sandboxId, d] as const] : [])),
  )
  const rows: BoxRow[] = []
  let teammates = 0

  for (const box of usage.boxes ?? []) {
    const device = own.get(box.sandboxId)

    if (device) rows.push({ key: box.sandboxId, name: device.label, ...box })
    else if (box.running) teammates += box.vcpus
  }
  if (teammates > 0)
    rows.push({
      key: 'teammates',
      name: t("Teammates' computers"),
      vcpus: teammates,
      running: true,
      teammates: true,
    })

  return rows
}

/** What can't start now: one of the viewer's paused Boxes that doesn't fit, else a new Box. */
export function blockedStart(usage: BoxUsage, rows: BoxRow[]): string | null {
  if (usage.usedVcpus === null || usage.limitVcpus === null) return null
  const free = Math.max(0, usage.limitVcpus - usage.usedVcpus)
  const paused = rows.find((row) => !row.running && row.vcpus > free)

  if (paused)
    return t('Starting {name} needs {n} vCPU; {free} free.', {
      name: paused.name,
      n: paused.vcpus,
      free,
    })
  if (usage.boxVcpus !== null && usage.boxVcpus > free)
    return t('A new computer needs {n} vCPU; {free} free.', { n: usage.boxVcpus, free })

  return null
}

const STATUS_TONES: Record<string, 'success' | 'warning' | 'muted'> = {
  active: 'success',
  trialing: 'success',
  paid: 'success',
  canceled: 'muted',
}

export const statusTone = (status: string) => STATUS_TONES[status] ?? 'warning'

/** The plan's renewal (or end) date and card, as the plan card's second line. */
export function renewal(plan: BillingSummary['plan'] | undefined, error: string | null): string {
  if (!plan) return error ? t('Renewal and card details unavailable') : t('Loading renewal…')
  const card = plan.card ? ` · ${plan.card.brand} •••• ${plan.card.last4}` : ''

  const when = date(plan.cancelAt ?? plan.currentPeriodEnd)

  return (
    (plan.cancelAt ? t('Ends {date}', { date: when }) : t('Renews {date}', { date: when })) + card
  )
}

/** The usage chart's axis ticks: every 4 hours for 24h, local midnights for 7d (daily) and 30d (every 5 days). */
export function chartTicks(from: number, to: number, range: '1d' | '7d' | '30d'): number[] {
  const at = new Date(from)
  const ticks: number[] = []

  if (range === '1d') at.setHours(Math.ceil(at.getHours() / 4) * 4, 0, 0, 0)
  else at.setHours(24, 0, 0, 0)
  while (at.getTime() <= to) {
    ticks.push(at.getTime())
    if (range === '1d') at.setHours(at.getHours() + 4)
    else at.setDate(at.getDate() + (range === '7d' ? 1 : 5))
  }

  return ticks
}

/** A tick's label: a time of day for 24h, a date otherwise. */
export const tickLabel = (at: number, range: '1d' | '7d' | '30d') =>
  new Date(at).toLocaleString(
    undefined,
    range === '1d' ? { hour: 'numeric', minute: '2-digit' } : { month: 'short', day: 'numeric' },
  )

export type PlanFit = { state: 'current' | 'short' | 'fits'; recommended: boolean }

/**
 * How each plan stands for the team: the one it has, those too small for `needs` vCPU running,
 * and the rest. The smallest that fits is recommended; without a need, the catalog's own pick.
 */
export function planFits(
  plans: readonly { vcpus: number; recommended?: boolean }[],
  current: number | null,
  needs?: number,
): PlanFit[] {
  const fits = (vcpus: number) => vcpus !== current && (needs === undefined || vcpus >= needs)
  const best =
    needs === undefined
      ? plans.find((plan) => plan.recommended && fits(plan.vcpus))
      : plans.find((plan) => fits(plan.vcpus))

  return plans.map((plan) => {
    let state: PlanFit['state'] = fits(plan.vcpus) ? 'fits' : 'short'

    if (plan.vcpus === current) state = 'current'

    return { state, recommended: plan === best }
  })
}

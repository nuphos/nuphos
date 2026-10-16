import type { BOX_PLANS } from './boxPresentation'
import type { AgentDevice, BillingSummary, BoxUsage } from '../../api/device-types'

export const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : '—')
export const money = (cents: number, currency: string) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100)
export const planDetail = ({ vcpus, usdPerMonth }: (typeof BOX_PLANS)[number]) =>
  `up to ${String(vcpus)} vCPU running · $${String(usdPerMonth)} / month`

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
      name: "Teammates' Boxes",
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
    return `Starting ${paused.name} needs ${String(paused.vcpus)} vCPU; ${String(free)} free.`
  if (usage.boxVcpus !== null && usage.boxVcpus > free)
    return `A new Box needs ${String(usage.boxVcpus)} vCPU; ${String(free)} free.`

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
  if (!plan) return error ? 'Renewal and card details unavailable' : 'Loading renewal…'
  const card = plan.card ? ` · ${plan.card.brand} •••• ${plan.card.last4}` : ''

  return `${plan.cancelAt ? 'Ends' : 'Renews'} ${date(plan.cancelAt ?? plan.currentPeriodEnd)}${card}`
}

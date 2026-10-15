import { Box, Loader2 } from 'lucide-react'
import { useState } from 'react'

import { Button } from '../../components/ui/button'

import { openBilling } from './billing'
import { BOX_VCPU_TIERS } from './boxPresentation'

import type { BoxUsage } from '../../api/device-types'

function usageLabel({ limitVcpus, usedVcpus }: BoxUsage): string {
  if (limitVcpus === 0) return 'No Box plan'
  if (usedVcpus === null) return `vCPU usage unavailable · limit ${String(limitVcpus)} vCPU`

  return `${String(usedVcpus)} of ${String(limitVcpus)} vCPU running`
}

/** The team's running vCPUs against its plan; administrators choose or manage the plan in the billing service. */
export function BoxPlanBar({
  teamId,
  isAdmin,
  usage,
  blocked,
}: {
  teamId: string
  isAdmin: boolean
  usage: BoxUsage | null
  /** Why a new Box cannot start, shown under the bar. */
  blocked: string | null
}) {
  const [busy, setBusy] = useState(false)
  const open = async (vcpus?: number) => {
    setBusy(true)
    await openBilling(teamId, vcpus)
    setBusy(false)
  }

  if (usage?.limitVcpus == null) return null

  const canBuy = isAdmin && usage.billingUrl !== null

  return (
    <>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px] text-secondary">
        <span>{usageLabel(usage)}</span>
        {canBuy && usage.subscribed && (
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void open()}>
            Manage plan
          </Button>
        )}
        {canBuy &&
          !usage.subscribed &&
          BOX_VCPU_TIERS.map((vcpus) => (
            <Button
              key={vcpus}
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => void open(vcpus)}
            >
              {vcpus} vCPU plan
            </Button>
          ))}
      </div>
      {blocked && <p className="mt-1 text-[12px] text-tertiary">{blocked}</p>}
    </>
  )
}

/** New Box, held back with the reason while the team's plan has no room for one. */
export function NewBoxButton({ creating, blocked }: { creating: boolean; blocked: string | null }) {
  return (
    <Button
      type="submit"
      size="sm"
      variant="secondary"
      disabled={creating || blocked !== null}
      title={blocked ?? undefined}
    >
      {creating ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Box className="h-3.5 w-3.5" />
      )}
      New Box
    </Button>
  )
}

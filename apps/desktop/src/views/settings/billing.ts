import { useState } from 'react'

import { api } from '../../api.ts'
import { toast } from '../../components/ui/toast.ts'

/** Shown when the billing service can't be reached: opening billing must never fail silently. */
export const BILLING_UNREACHABLE = "Couldn't reach billing. Try again later."

/** Opens Checkout for a `vcpus` plan, or the portal without one; false when it couldn't. */
export async function openBilling(teamId: string, vcpus?: number): Promise<boolean> {
  try {
    await api.appOpenExternal((await api.boxBillingPage(teamId, vcpus)).url)

    return true
  } catch (error) {
    toast.apiError('Could not open billing', error, { fallback: BILLING_UNREACHABLE })

    return false
  }
}

/** `openBilling` with the page being opened (a plan's vCPU, `0` for the portal) while it is on its way. */
export function useOpenBilling(teamId: string, onOpened: () => void) {
  const [opening, setOpening] = useState<number | null>(null)

  const open = (vcpus?: number) => {
    if (opening !== null) return
    setOpening(vcpus ?? 0)
    void openBilling(teamId, vcpus).then((opened) => {
      setOpening(null)
      if (opened) onOpened()
    })
  }

  return { opening, open }
}

export type OpenBilling = ReturnType<typeof useOpenBilling>

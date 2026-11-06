import { useEffect, useRef, useState } from 'react'

import { api } from '../../api'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'

import { boxCreateSize, boxQuota, nextBoxName } from './boxCreatePresentation'
import { boxPaywall, openBoxPaywall } from './boxPaywallStore'
import { boxSizeChoices } from './boxPresentation'
import { useBoxAccessChoice } from './useBoxAccessChoice'
import { useBoxAccount } from './useInstaboxAccounts'

import type { BoxUsage, InstaboxAccount } from '../../api/device-types'

/**
 * True while the plans are open or just closed. They open over the dialog making the Box,
 * and Escape there must not close that dialog too.
 */
function useBoxPlansOpen() {
  const plansClosedAt = useRef(0)

  useEffect(
    () =>
      boxPaywall.subscribe(() => {
        if (!boxPaywall.current()) plansClosedAt.current = Date.now()
      }),
    [],
  )

  return () => Boolean(boxPaywall.current()) || Date.now() - plansClosedAt.current < 300
}

/** Where a create ended: made, handed to the paywall (which makes it once a plan is bought), or failed. */
export type NewBoxResult = 'created' | 'paywall' | 'failed'

/** The New Box form's state: its name, size and access, and making the Box with them. */
export function useNewBox({
  teamId,
  usage,
  labels,
  onCreated,
  accounts = [],
  deployment = true,
}: {
  teamId: string
  usage: BoxUsage | null
  /** The team's own instabox accounts, which a Box may go on instead of Nuphos's. */
  accounts?: InstaboxAccount[]
  /** Whether Nuphos's own account can make Boxes here. */
  deployment?: boolean
  /** The names already taken, to suggest the next "Box N". */
  labels: string[]
  /** Also after the paywall, when the plan bought there lets the Box be made. */
  onCreated: (deviceId: string) => void
}) {
  const account = useBoxAccount(teamId, accounts, deployment)
  // A team's own account is billed by instabox: its own sizes, and no Nuphos plan or limit.
  const choices = boxSizeChoices((account.accountId ? account.sizes : usage?.sizes) ?? [])
  const quota = usage && !account.accountId ? boxQuota(usage) : null
  const [name, setName] = useState('')
  const [picked, setPicked] = useState<number>()
  const vcpus = boxCreateSize(choices, picked, quota?.left ?? null)
  const access = useBoxAccessChoice()
  const [creating, setCreating] = useState(false)
  const placeholder = nextBoxName(labels)
  const plansOpen = useBoxPlansOpen()

  const create = async (): Promise<NewBoxResult> => {
    // The name shown as the default is the one sent, so the hint is what the Box is called.
    const request = [
      name.trim() || placeholder,
      teamId,
      vcpus,
      access.payload(),
      account.accountId,
    ] as const
    // After the paywall: make this same Box once the plan allows it, creating again meanwhile so
    // a form still open cannot make a second one.
    const retry = () => {
      setCreating(true)
      void api
        .boxCreate(...request)
        .then(
          (made) => onCreated(made.deviceId),
          (again: unknown) => {
            toast.apiError(t('Could not create computer'), again)
          },
        )
        .finally(() => setCreating(false))
    }

    setCreating(true)
    try {
      onCreated((await api.boxCreate(...request)).deviceId)

      return 'created'
    } catch (error) {
      // No plan, or past it: the paywall offers one, then retries.
      if (!account.accountId && openBoxPaywall(teamId, error, retry)) return 'paywall'
      toast.apiError(t('Could not create computer'), error)

      return 'failed'
    } finally {
      setCreating(false)
    }
  }

  return {
    teamId,
    usage,
    choices,
    quota,
    name,
    setName,
    placeholder,
    vcpus,
    setPicked,
    access,
    account,
    creating,
    create,
    /** Whether a close now would be the user's: not while creating, nor an Escape meant for the plans. */
    canClose: () => !creating && !plansOpen(),
  }
}

export type NewBoxState = ReturnType<typeof useNewBox>

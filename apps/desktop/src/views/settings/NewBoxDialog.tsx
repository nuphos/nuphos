import { useEffect, useRef, useState } from 'react'

import { api } from '../../api'
import { Modal } from '../../components/Modal'
import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'

import { BoxAccessFields } from './BoxAccessFields'
import { boxQuota, nextBoxName } from './boxCreatePresentation'
import { boxPaywall, openBoxPaywall, openBoxPlans } from './boxPaywallStore'
import { boxSizeChoices } from './boxPresentation'
import { BoxQuotaMeter } from './BoxQuotaMeter'
import { BoxSizePicker } from './BoxSizePicker'
import { Field } from './shared'
import { inputClasses } from './styles'
import { useBoxAccessChoice } from './useBoxAccessChoice'

import type { BoxUsage } from '../../api/device-types'

/** Make a Box with its name, size and access chosen up front, seeing the plan's vCPU left. */
export function NewBoxDialog({
  teamId,
  usage,
  labels,
  onClose,
  onCreated,
  onPlanChanged,
}: {
  teamId: string
  usage: BoxUsage | null
  /** The names already taken, to suggest the next "Box N". */
  labels: string[]
  onClose: () => void
  onCreated: () => void
  /** A bigger plan was bought from here: read the plan again. */
  onPlanChanged: () => void
}) {
  const sizes = usage?.sizes ?? []
  const choices = boxSizeChoices(sizes)
  const quota = usage ? boxQuota(usage) : null
  const [name, setName] = useState('')
  const [picked, setPicked] = useState<number>()
  const fits = (size: number) => quota?.left == null || size <= quota.left
  // The pick while it fits, else the smallest that does, else the smallest: the backend then offers the plans.
  const vcpus = (
    choices.find((choice) => choice.vcpus === picked && fits(choice.vcpus)) ??
    choices.find((choice) => fits(choice.vcpus)) ??
    choices.at(0)
  )?.vcpus
  const access = useBoxAccessChoice()
  const [creating, setCreating] = useState(false)
  const placeholder = nextBoxName(labels)
  // The plans open over this dialog, and Escape there must not close this one too.
  const plansClosedAt = useRef(0)

  useEffect(
    () =>
      boxPaywall.subscribe(() => {
        if (!boxPaywall.current()) plansClosedAt.current = Date.now()
      }),
    [],
  )
  const close = () => {
    if (creating || boxPaywall.current() || Date.now() - plansClosedAt.current < 300) return
    onClose()
  }

  const create = async () => {
    // The name shown as the default is the one sent, so the hint is what the Box is called.
    const request = [name.trim() || placeholder, teamId, vcpus, access.payload()] as const
    // After the paywall: make this same Box once the plan allows it.
    const retry = () =>
      void api.boxCreate(...request).then(onCreated, (again: unknown) => {
        toast.apiError('Could not create Box', again)
      })

    setCreating(true)
    try {
      await api.boxCreate(...request)
      onCreated()
      onClose()
    } catch (error) {
      // No plan, or past it: the paywall offers one, then retries.
      if (openBoxPaywall(teamId, error, retry)) onClose()
      else toast.apiError('Could not create Box', error)
    } finally {
      setCreating(false)
    }
  }

  return (
    <Modal
      open
      onClose={close}
      title="New Box"
      description="A Linux computer in the cloud with Claude Code and Codex on it. Running Boxes count against your plan's vCPU; paused ones do not."
      width={560}
      closeOnBackdrop={!creating}
      footer={
        <div className="flex justify-end gap-2 px-5 py-3">
          <Button size="sm" variant="secondary" disabled={creating} onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" type="submit" form="new-box-form" disabled={creating}>
            {creating ? 'Creating…' : 'Create Box'}
          </Button>
        </div>
      }
    >
      <form
        id="new-box-form"
        className="space-y-5 p-5"
        onSubmit={(event) => {
          event.preventDefault()
          void create()
        }}
      >
        <Field label="Name" hint={`Leave it empty to call it ${placeholder}.`}>
          <input
            autoFocus
            aria-label="Name"
            className={inputClasses}
            value={name}
            placeholder={placeholder}
            maxLength={200}
            disabled={creating}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <div className="space-y-2">
          <span className="block text-[12.5px] font-medium text-secondary">Size</span>
          <BoxQuotaMeter usage={usage} adding={vcpus} />
          {choices.length === 0 && usage && (
            <p className="text-[12.5px] text-tertiary">
              The sizes could not be loaded, so this Box will be the smallest size.
            </p>
          )}
          {choices.length > 0 && (
            <BoxSizePicker
              choices={choices}
              value={vcpus}
              left={quota?.left ?? null}
              disabled={creating}
              onChange={setPicked}
              onUpgrade={(choice) =>
                openBoxPlans(
                  teamId,
                  `${choice.name} needs ${String(choice.vcpus)} vCPU and your plan has ${String(quota?.left ?? 0)} left. Choose a bigger plan to unlock it.`,
                  () => {
                    setPicked(choice.vcpus)
                    onPlanChanged()
                  },
                  {
                    afterPaid: `Once the plan changes, ${choice.name} is unlocked and selected in New Box.`,
                    needs: (quota?.used ?? 0) + choice.vcpus,
                  },
                )
              }
            />
          )}
        </div>
        <div className="space-y-2">
          <span className="block text-[12.5px] font-medium text-secondary">Who can use it</span>
          <BoxAccessFields teamId={teamId} choice={access} />
        </div>
      </form>
    </Modal>
  )
}

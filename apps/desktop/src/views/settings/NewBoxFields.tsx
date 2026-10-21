import { BoxAccessFields } from './BoxAccessFields'
import { openBoxPlans } from './boxPaywallStore'
import { BoxQuotaMeter } from './BoxQuotaMeter'
import { BoxSizePicker } from './BoxSizePicker'
import { Field } from './shared'
import { inputClasses } from './styles'

import type { NewBoxState } from './useNewBox'

/** The form's id, for a submit button outside it such as a dialog footer. */
export const NEW_BOX_FORM = 'new-box-form'

export const NEW_BOX_DESCRIPTION =
  "A Linux computer in the cloud with Claude Code and Codex on it. Running Boxes count against your plan's vCPU; paused ones do not."

/** New Box's name, size and access, made with `useNewBox` when submitted. Used by New Box and Add agent. */
export function NewBoxFields({
  box,
  className,
  onSubmit = () => void box.create(),
  onPlanChanged,
}: {
  box: NewBoxState
  className?: string
  /** Makes the Box; by default only `box.create`, for a caller that does nothing after it. */
  onSubmit?: () => void
  /** A bigger plan was bought from here: read the plan again. */
  onPlanChanged: () => void
}) {
  const { teamId, usage, choices, quota, vcpus, creating } = box

  return (
    <form
      id={NEW_BOX_FORM}
      className={className}
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <Field label="Name" hint={`Leave it empty to call it ${box.placeholder}.`}>
        <input
          autoFocus
          aria-label="Name"
          className={inputClasses}
          value={box.name}
          placeholder={box.placeholder}
          maxLength={200}
          disabled={creating}
          onChange={(event) => box.setName(event.target.value)}
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
            onChange={box.setPicked}
            onUpgrade={(choice) =>
              openBoxPlans(
                teamId,
                `${choice.name} needs ${String(choice.vcpus)} vCPU and your plan has ${String(quota?.left ?? 0)} left. Choose a bigger plan to unlock it.`,
                () => {
                  box.setPicked(choice.vcpus)
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
        <BoxAccessFields teamId={teamId} choice={box.access} />
      </div>
    </form>
  )
}

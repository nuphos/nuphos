import { Modal } from '../../components/Modal'
import { Button } from '../../components/ui/button'

import { NEW_BOX_DESCRIPTION, NEW_BOX_FORM, NewBoxFields } from './NewBoxFields'
import { useNewBox } from './useNewBox'

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
  const box = useNewBox({ teamId, usage, labels, onCreated })
  const { creating } = box

  return (
    <Modal
      open
      onClose={() => {
        if (box.canClose()) onClose()
      }}
      title="New Box"
      description={NEW_BOX_DESCRIPTION}
      width={560}
      closeOnBackdrop={!creating}
      footer={
        <div className="flex justify-end gap-2 px-5 py-3">
          <Button size="sm" variant="secondary" disabled={creating} onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" type="submit" form={NEW_BOX_FORM} disabled={creating}>
            {creating ? 'Creating…' : 'Create Box'}
          </Button>
        </div>
      }
    >
      <NewBoxFields
        box={box}
        className="space-y-5 p-5"
        // Made, or the paywall makes it once a plan is bought: either way this dialog is done.
        onSubmit={() =>
          void box.create().then((result) => {
            if (result !== 'failed') onClose()
          })
        }
        onPlanChanged={onPlanChanged}
      />
    </Modal>
  )
}

import { deleteTriggerGroup } from './groupOverviewLogic'
import { confirmRemoveTrigger } from './triggerFormActions'

import type { TriggerListRow } from './triggerRows'
import type { ListState } from './TriggersList'

/** The list reflects deletes itself; the settings page's staged-save hooks
 *  have nothing to do here. */
const NOOP = () => {
  /* nothing to stage */
}

/**
 * Delete a row from the Triggers list.
 *
 * Both paths reuse the delete the settings pages already use, because both are
 * about provider cleanup rather than about removing a row: a provider-backed
 * trigger does not vanish on delete — it comes back in a `deleting` state and
 * the list's own poll follows the cleanup through — and a Watch group is
 * deleted by deleting its partition triggers, idempotently.
 */
export async function deleteTriggerRow(
  row: TriggerListRow,
  deps: {
    teamId?: string
    canDelete: boolean
    setState: React.Dispatch<React.SetStateAction<ListState>>
    /** Re-list, so a group's partition rows disappear with it. */
    onRetry: () => void
    onSettled: () => void
  },
): Promise<void> {
  const { teamId, canDelete, setState, onRetry, onSettled } = deps
  const removeRow = (key: string) =>
    setState((prev) =>
      prev.kind === 'ready'
        ? {
            kind: 'ready',
            triggers: prev.triggers.filter((trigger) => trigger.id !== key),
            groups: prev.groups.filter((group) => group.id !== key),
          }
        : prev,
    )

  if (row.kind === 'trigger') {
    await confirmRemoveTrigger({
      triggerId: row.trigger.id,
      teamId,
      canDelete,
      setLoaded: (updated) =>
        setState((prev) =>
          prev.kind === 'ready'
            ? {
                ...prev,
                triggers: prev.triggers.map((trigger) =>
                  trigger.id === updated.id ? updated : trigger,
                ),
              }
            : prev,
        ),
      onSaved: NOOP,
      onDeleted: removeRow,
    })
    onSettled()

    return
  }
  await deleteTriggerGroup({
    group: row.group,
    canDelete,
    setAction: NOOP,
    setConfirmDeleteOpen: (open) => {
      if (!open) onSettled()
    },
    onDeleted: () => {
      removeRow(row.group.id)
      onRetry()
    },
  })
}

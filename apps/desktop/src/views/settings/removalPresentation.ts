import { t } from '../../i18n/index.ts'

import { isOwner } from './boxPresentation.ts'

import type { AgentDevice } from '../../api/device-types'

/** Shown when the backend gives no reason, e.g. an older backend without the route. */
const REMOVE_FALLBACK = t('Could not remove it. Update Nuphos and try again.')

/** How its owner removes a machine, any time: a Box is deleted, a computer forgotten. */
export function removal(device: AgentDevice) {
  const always = { allowed: isOwner(device), fallback: REMOVE_FALLBACK }

  if (device.box)
    return {
      ...always,
      title: t('Delete {name}?', { name: device.label }),
      action: t('Delete'),
      confirm: t('Delete computer'),
      error: t('Could not delete computer'),
      description: t(
        "This permanently deletes the computer, its files and its runtimes' sign-ins, and stops tasks running on it. Your task history stays in Nuphos.",
      ),
    }

  return {
    ...always,
    title: t('Remove {name}?', { name: device.label }),
    action: t('Remove computer'),
    confirm: t('Remove computer'),
    error: t('Could not remove computer'),
    description: device.online
      ? t(
          '{name} is online. Removing it disconnects it now and stops any task running on it. Tasks it ran stay in Nuphos. To add it back, open Nuphos on that computer.',
          { name: device.label },
        )
      : t(
          'This removes the computer and its runtimes from Nuphos. Opening Nuphos on it registers it again. Your task history stays in Nuphos.',
        ),
  }
}

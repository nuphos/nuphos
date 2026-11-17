import { t } from '../../i18n/index.ts'

import type { AgentDevice } from '../../api/device-types.ts'

function updateHint(device: AgentDevice, thisComputer: boolean): string {
  if (device.box)
    return device.access === 'use'
      ? t('Ask a workspace administrator to update it.')
      : t('Update it from its ⋯ menu.')
  if (thisComputer) return t('Restart Nuphos from the Help menu to update it.')
  // Nuphos on a person's computer is theirs to update, whoever else manages the computer.
  if (device.access !== 'owner') return t('Ask its owner to update Nuphos on it.')
  if (device.outdated === 'cli') return t('Run “nuphos update” on it.')

  return device.app?.update?.ready
    ? t('Update it from its ⋯ menu.')
    : t('Open Nuphos on it and restart to update.')
}

/** What a computer's card says when its Nuphos is older than the backend supports, and the way this viewer updates it. */
export function outdatedNotice(
  device: AgentDevice,
  thisComputer: boolean,
): { text: string; hint: string } | null {
  if (!device.outdated) return null

  return {
    text: t('Nuphos on this computer is out of date'),
    hint: updateHint(device, thisComputer),
  }
}

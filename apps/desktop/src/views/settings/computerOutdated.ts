import { t } from '../../i18n/index.ts'
import { newerVersion } from '../../lib/agentUpdate.ts'

import type { AgentDevice } from '../../api/device-types.ts'

function updateHint(device: AgentDevice, thisComputer: boolean): string {
  if (device.box)
    return device.access === 'use'
      ? t('Ask a team administrator to update it.')
      : t('Update it from its ⋯ menu.')
  if (thisComputer) return t('Restart Nuphos from the Help menu to update it.')
  // Nuphos on a person's computer is theirs to update, whoever else manages the computer.
  if (device.access !== 'owner') return t('Ask its owner to update Nuphos on it.')
  if (device.outdated === 'cli') return t('Run “nuphos update” on it.')

  // An outdated Nuphos Desktop is older than 0.133.2, so it is quit by hand, not restarted.
  return device.app?.update?.ready
    ? t('Quit Nuphos fully on it (⌘Q on a Mac) and reopen it. If it doesn’t close, quit it again.')
    : t(
        'Open Nuphos on it and let the update download, then quit it fully (⌘Q on a Mac) and reopen it.',
      )
}

/** Whether Nuphos Desktop restarts into its update when asked to. Before 0.133.2 the restart can
 *  leave it running without windows and the update uninstalled (#4524). */
export const restartsIntoUpdate = (app: NonNullable<AgentDevice['app']>) =>
  !newerVersion('0.133.2', app.version)

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

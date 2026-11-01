import { t } from '../../i18n/index.ts'

import type { RuntimeUpdateStatus } from '../../types/team'

export function runtimeUpdatePresentation(
  update: RuntimeUpdateStatus,
  managed: boolean,
  canUpdate: boolean,
  enabled: boolean,
) {
  const pending = update.state === 'waiting' || update.state === 'updating'
  const titles = {
    available: t('Update available'),
    waiting: t('Update queued'),
    updating: t('Updating runtime…'),
    failed: t('Update failed'),
    unknown: t('Version check unavailable'),
    current: t('Up to date'),
  }
  let detail = t(
    'The running version or latest release could not be verified. We’ll check again automatically.',
  )

  if (update.state === 'waiting')
    detail = enabled
      ? t('The update will start when agents finish replying.')
      : t('Enable this runtime to finish the update.')
  if (update.state === 'updating') detail = t('Waiting for the updated runtime to come online.')
  if (update.state === 'failed')
    detail = update.error ?? t('Could not complete the update. Try again.')
  if (update.state === 'available') {
    detail = t('Update the runtime on its host to get the latest models and fixes.')
    if (managed)
      detail = canUpdate
        ? t('Updates wait for agents to finish replying.')
        : t('Ask a workspace administrator to update this runtime.')
  }
  let button = t('Update')

  if (update.state === 'failed') button = t('Retry update')
  if (update.state === 'waiting') button = t('Update queued')
  if (update.state === 'updating') button = t('Updating…')

  return {
    pending,
    title: titles[update.state],
    detail,
    button,
    version: pending || update.state === 'failed' ? update.targetVersion : update.latestVersion,
    showButton: canUpdate && (pending || update.state === 'available' || update.state === 'failed'),
  }
}

/**
 * The newer version a host can update to, from its latest status: '' when that version is
 * unknown, undefined when there is nothing to update. Every answer counts, so a host that comes
 * back current after an update clears what an earlier answer offered.
 */
export function hostUpdateVersion(
  update: Pick<RuntimeUpdateStatus, 'state' | 'latestVersion'> | undefined,
) {
  return update?.state === 'available' || update?.state === 'failed'
    ? (update.latestVersion ?? '')
    : undefined
}

import type { RuntimeUpdateStatus } from '../../types/team'

export function runtimeUpdatePresentation(
  update: RuntimeUpdateStatus,
  managed: boolean,
  canUpdate: boolean,
  enabled: boolean,
) {
  const pending = update.state === 'waiting' || update.state === 'updating'
  const titles = {
    available: 'Update available',
    waiting: 'Update queued',
    updating: 'Updating runtime…',
    failed: 'Update failed',
    unknown: 'Version check unavailable',
    current: 'Up to date',
  }
  let detail =
    'The running version or latest release could not be verified. We’ll check again automatically.'

  if (update.state === 'waiting')
    detail = enabled
      ? 'The update will start when active conversations finish.'
      : 'Enable this agent to finish the update.'
  if (update.state === 'updating') detail = 'Waiting for the updated agent to come online.'
  if (update.state === 'failed')
    detail = update.error ?? 'Could not complete the update. Try again.'
  if (update.state === 'available') {
    detail = 'Update the runtime on its host to get the latest models and fixes.'
    if (managed)
      detail = canUpdate
        ? 'Updates wait for active conversations to finish.'
        : 'Ask a workspace administrator to update this agent.'
  }
  let button = 'Update'

  if (update.state === 'failed') button = 'Retry update'
  if (update.state === 'waiting') button = 'Update queued'
  if (update.state === 'updating') button = 'Updating…'

  return {
    pending,
    title: titles[update.state],
    detail,
    button,
    version: pending || update.state === 'failed' ? update.targetVersion : update.latestVersion,
    showButton: canUpdate && (pending || update.state === 'available' || update.state === 'failed'),
  }
}

import { AppError } from '@/lib/errors'

import { requestBoxUpdate } from './box-update'
import { latestRuntimeRelease, newerRuntimeVersion, RUNTIME_RELEASES_URL } from './runtime-release'
import { claudeCodePreviewRuntimeStatus } from './runtime-status'

import type { RuntimeInstance } from './runtime-instances'
import type { PreviewRuntimeStatus } from './runtime-status'

/** Whether the release a runtime reports is the latest; its host applies any update. */
export async function runtimeUpdateStatus(
  provider: RuntimeInstance['provider'],
  observed: Pick<PreviewRuntimeStatus, 'runtimeVersion'>,
) {
  const release = await latestRuntimeRelease(provider)
  const currentVersion = observed.runtimeVersion
  let state: 'unknown' | 'current' | 'available' = 'unknown'

  if (currentVersion && release)
    state = newerRuntimeVersion(release.version, currentVersion) ? 'available' : 'current'

  return {
    state,
    currentVersion,
    latestVersion: release?.version,
    releaseUrl: release?.url ?? RUNTIME_RELEASES_URL,
  }
}

/** A Nuphos-side runtime's status card, with the release it could update to. */
export async function runtimeStatusWithUpdate(
  teamId: string,
  userId: string,
  instance: RuntimeInstance,
) {
  const status = await claudeCodePreviewRuntimeStatus(
    teamId,
    userId,
    instance.provider,
    instance.id,
  )

  return { ...status, runtimeUpdate: await runtimeUpdateStatus(instance.provider, status) }
}

/** Only a team administrator's route can request an update; only a Box's agents update from here. */
export async function requestRuntimeUpdate(
  teamId: string,
  instance: RuntimeInstance,
  actorId?: string,
) {
  if (instance.kind === 'local' && actorId) return requestBoxUpdate(teamId, instance.id, actorId)
  throw new AppError(409, 'runtime_not_managed', 'Update this agent on its host.')
}

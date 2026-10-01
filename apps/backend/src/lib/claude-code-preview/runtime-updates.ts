import { provisionerKubeClient } from './provisioner-kube'
import { managedRuntimeImage } from './runtime-image'
import { assertRuntimeNotDeleting } from './runtime-portability-store'
import { runtimes } from './runtime-registry'
import { latestRuntimeRelease, newerRuntimeVersion, RUNTIME_RELEASES_URL } from './runtime-release'
import { runtimeServiceName } from './runtime-service-name'

import type { RuntimeInstance } from './runtime-instances'

import { config } from '@/config'
import { AppError } from '@/lib/errors'

export async function runtimeUpdateStatus(
  teamId: string,
  instance: RuntimeInstance,
  currentVersion?: string,
) {
  const release = await latestRuntimeRelease(instance.provider)
  const doc =
    instance.kind === 'managed' ? await runtimes().findOne({ _id: instance.id, teamId }) : null
  const target = doc?.requestedRuntimeVersion
  let state: 'unknown' | 'current' | 'available' | 'waiting' | 'updating' | 'failed' = 'unknown'

  if (currentVersion && release)
    state = newerRuntimeVersion(release.version, currentVersion) ? 'available' : 'current'
  let error = doc?.runtimeUpdateError

  if (target && (!currentVersion || newerRuntimeVersion(target, currentVersion))) {
    state = error ? 'failed' : 'waiting'
    const namespace = config.claudeCodeRuntimeProvisioner.namespace
    const name = doc && runtimeServiceName(doc.url, namespace)
    const kube = name ? provisionerKubeClient() : null
    const deployment = name
      ? await kube
          ?.getResource?.({
            apiVersion: 'apps/v1',
            kind: 'Deployment',
            metadata: { name, namespace },
          })
          .catch(() => null)
      : null
    const image = deployment?.spec?.template?.spec?.containers?.find(
      (container) => container.name === 'openab',
    )?.image

    if (!error && image === managedRuntimeImage(instance.provider, target)) state = 'updating'
    if (
      image === managedRuntimeImage(instance.provider, target) &&
      deployment?.status?.conditions?.some(
        (condition) => condition.reason === 'ProgressDeadlineExceeded',
      )
    ) {
      state = 'failed'
      error = 'The updated agent could not start. Retry the update or contact support.'
    }
  }

  return {
    state,
    currentVersion,
    latestVersion: release?.version,
    targetVersion: target,
    releaseUrl:
      target && ['waiting', 'updating', 'failed'].includes(state)
        ? `${RUNTIME_RELEASES_URL}/tag/v${target}`
        : (release?.url ?? RUNTIME_RELEASES_URL),
    ...(state === 'failed' ? { error } : {}),
  }
}

/** Only a team administrator's route can request an update. The normal idle-safe reconciler executes it. */
export async function requestRuntimeUpdate(teamId: string, instance: RuntimeInstance) {
  await assertRuntimeNotDeleting(teamId, instance.id)
  if (instance.kind !== 'managed')
    throw new AppError(409, 'runtime_not_managed', 'Update this agent on its host.')
  const namespace = config.claudeCodeRuntimeProvisioner.namespace
  const doc = await runtimes().findOne({ _id: instance.id, teamId, hostedBy: 'nuphos' })

  if (
    !doc ||
    !runtimeServiceName(doc.url, namespace) ||
    !config.claudeCodeRuntimeProvisioner.enabled ||
    !provisionerKubeClient()
  )
    throw new AppError(409, 'runtime_update_unavailable', 'This server cannot update this agent.')
  const release = await latestRuntimeRelease(instance.provider, true)

  if (!release)
    throw new AppError(
      503,
      'runtime_release_unavailable',
      'Could not check the latest release. Try again shortly.',
    )
  if (
    doc.requestedRuntimeVersion &&
    newerRuntimeVersion(doc.requestedRuntimeVersion, release.version)
  )
    throw new AppError(409, 'runtime_update_stale', 'A newer update is already selected.')
  const updated = await runtimes().updateOne(
    {
      _id: instance.id,
      teamId,
      hostedBy: 'nuphos',
      requestedRuntimeVersion: doc.requestedRuntimeVersion ?? { $exists: false },
    },
    {
      $set: { requestedRuntimeVersion: release.version, updatedAt: new Date() },
      $unset: { runtimeUpdateError: '' },
    },
  )

  if (!updated.matchedCount)
    throw new AppError(409, 'runtime_update_changed', 'The agent changed. Refresh and try again.')

  return { version: release.version }
}

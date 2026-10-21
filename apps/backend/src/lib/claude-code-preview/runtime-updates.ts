import { config } from '@/config'
import { localRuntimeId } from '@/lib/agent/devices/local-runtime/address'
import { AppError } from '@/lib/errors'

import { requestBoxUpdate } from './box-update'
import { localRuntimeStatus } from './local-runtime-catalog'
import { provisionerKubeClient } from './provisioner-kube'
import { managedRuntimeImage, runtimeImageVersion } from './runtime-image'
import { assertRuntimeNotDeleting } from './runtime-portability-store'
import { runtimes } from './runtime-registry'
import {
  latestRuntimeRelease,
  newerRuntimeVersion,
  runtimeReleaseUrl,
  RUNTIME_RELEASES_URL,
} from './runtime-release'
import { runtimeServiceName } from './runtime-service-name'
import { claudeCodePreviewRuntimeStatus } from './runtime-status'

import type { KubeResourceState } from './kube-client'
import type { RuntimeInstance } from './runtime-instances'
import type { ClaudeCodeRuntimeDoc } from './runtime-registry'
import type { PreviewRuntimeStatus } from './runtime-status'

function readDeployment(doc: ClaudeCodeRuntimeDoc) {
  const namespace = config.claudeCodeRuntimeProvisioner.namespace
  const name = runtimeServiceName(doc.url, namespace)
  const kube = name ? provisionerKubeClient() : null

  return name
    ? (kube
        ?.getResource?.({
          apiVersion: 'apps/v1',
          kind: 'Deployment',
          metadata: { name, namespace },
        })
        .catch(() => null) ?? null)
    : null
}

function openabImage(deployment: KubeResourceState | null | undefined) {
  return deployment?.spec?.template?.spec?.containers?.find(
    (container) => container.name === 'openab',
  )?.image
}

/** What a joined pod runs: its Deployment's image, once every pod runs it and the device is online. */
function joinedVersion(deployment: KubeResourceState | null, online: boolean | undefined) {
  const status = deployment?.status
  const updated = status?.updatedReplicas ?? 0
  const rolledOut =
    updated > 0 &&
    (status?.observedGeneration ?? 0) >= (deployment?.metadata.generation ?? Infinity) &&
    status?.replicas === updated &&
    status.availableReplicas === updated

  return online && rolledOut ? runtimeImageVersion(openabImage(deployment)) : undefined
}

export async function runtimeUpdateStatus(
  provider: RuntimeInstance['provider'],
  doc: ClaudeCodeRuntimeDoc | null,
  observed: Pick<PreviewRuntimeStatus, 'online' | 'runtimeVersion'>,
) {
  const release = await latestRuntimeRelease(provider)
  const target = doc?.requestedRuntimeVersion
  // A joined pod serves no status page, so its Deployment says what it runs.
  const joined = doc?.device ? await readDeployment(doc) : undefined
  const currentVersion =
    joined === undefined ? observed.runtimeVersion : joinedVersion(joined, observed.online)
  let state: 'unknown' | 'current' | 'available' | 'waiting' | 'updating' | 'failed' = 'unknown'

  if (currentVersion && release)
    state = newerRuntimeVersion(release.version, currentVersion) ? 'available' : 'current'
  let error = doc?.runtimeUpdateError

  if (doc && target && (!currentVersion || newerRuntimeVersion(target, currentVersion))) {
    state = error ? 'failed' : 'waiting'
    const deployment = joined === undefined ? await readDeployment(doc) : joined
    const image = openabImage(deployment)

    const targetImage = doc.deploymentImage
    // Both sides can be absent — an unreadable Deployment, an unresolved digest — and two
    // absences are not a match: that would report an update as live without evidence.
    const running = Boolean(image) && image === targetImage

    if (!error && running) state = 'updating'
    if (
      running &&
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
        ? await runtimeReleaseUrl(target, release)
        : (release?.url ?? RUNTIME_RELEASES_URL),
    ...(state === 'failed' ? { error } : {}),
  }
}

/** A Nuphos-side runtime's status card, with the update it is waiting on. */
export async function runtimeStatusWithUpdate(
  teamId: string,
  userId: string,
  instance: RuntimeInstance,
) {
  const { provider } = instance
  const doc =
    instance.kind === 'managed' ? await runtimes().findOne({ _id: instance.id, teamId }) : null
  const joined =
    doc?.device && (provider === 'claude-code' || provider === 'codex')
      ? { ...doc.device, provider }
      : undefined
  // A joined pod answers through the device it joined as, the way a Box does.
  const status = joined
    ? await localRuntimeStatus(localRuntimeId(joined))
    : await claudeCodePreviewRuntimeStatus(teamId, userId, provider, instance.id)

  return { ...status, runtimeUpdate: await runtimeUpdateStatus(provider, doc, status) }
}

/** Only a team administrator's route can request an update. The normal idle-safe reconciler executes it. */
export async function requestRuntimeUpdate(
  teamId: string,
  instance: RuntimeInstance,
  actorId?: string,
) {
  if (instance.kind === 'local' && actorId) return requestBoxUpdate(teamId, instance.id, actorId)
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
  const image = await managedRuntimeImage(instance.provider, release.version)

  if (!image)
    throw new AppError(
      503,
      'runtime_release_unavailable',
      'The release image is unavailable. Try again shortly.',
    )
  const updated = await runtimes().updateOne(
    {
      _id: instance.id,
      teamId,
      hostedBy: 'nuphos',
      requestedRuntimeVersion: doc.requestedRuntimeVersion ?? { $exists: false },
      deploymentImage: doc.deploymentImage ?? { $exists: false },
    },
    {
      $set: {
        requestedRuntimeVersion: release.version,
        deploymentImage: image,
        updatedAt: new Date(),
      },
      $unset: { runtimeUpdateError: '' },
    },
  )

  if (!updated.matchedCount)
    throw new AppError(409, 'runtime_update_changed', 'The agent changed. Refresh and try again.')

  return { version: release.version }
}

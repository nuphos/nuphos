import { AppError } from '@/lib/errors'
import { logError, logEvent } from '@/lib/observability'

import { placementNamespace, runtimeControllerGone } from './runtime-controllers'
import { deleteRuntimeAuthSecret } from './runtime-credential-secret'
import { inspectClaim, removeClaim } from './runtime-deletion-volumes'
import { runtimeHomeClaimName, runtimeWorkspaceClaimName } from './runtime-objects'
import { withRuntimePlacementLease } from './runtime-placement-lease'
import { runtimeDeletions } from './runtime-portability-store'
import { removeTeamRuntime, runtimes, setTeamRuntimeStatus } from './runtime-registry'
import { clearRuntimeAuthKey } from './runtime-registry-credentials'
import { runtimeServiceName } from './runtime-service-name'

import type { KubeClient, KubeResource } from './kube-client'
import type { RuntimeInstance } from './runtime-instances'
import type { RuntimeDeletion } from './runtime-portability-store'
import type { OpenAbProvider } from './runtime-provider'

export async function requestRuntimeDeletion(
  teamId: string,
  instance: RuntimeInstance,
  userId: string,
) {
  const existing = await runtimeDeletions().findOne({ _id: instance.id, teamId })

  if (existing) return
  const runtime = await runtimes().findOne({ _id: instance.id, teamId, hostedBy: 'nuphos' })

  await runtimeDeletions().updateOne(
    { _id: instance.id, teamId },
    {
      $setOnInsert: {
        teamId,
        provider: instance.provider,
        requestedBy: userId,
        requestedAt: new Date(),
        placements: runtime
          ? [{ id: runtime._id, url: runtime.url, state: 'pending' as const }]
          : [],
      },
    },
    { upsert: true },
  )
}

type Placement = RuntimeDeletion['placements'][number]
/** Each environment only removes its own verified placement. */
async function deletePlacement(
  job: RuntimeDeletion,
  placement: Placement,
  namespace: string,
  kube: KubeClient,
) {
  const name = runtimeServiceName(placement.url, namespace)
  const getResource = kube.getResource?.bind(kube)

  if (!getResource || !name)
    throw new Error('Runtime deletion requires Kubernetes resource inspection.')
  const resource = (kind: string, resourceName = name): KubeResource => ({
    apiVersion: kind === 'Deployment' ? 'apps/v1' : 'v1',
    kind,
    metadata: { name: resourceName, namespace },
  })
  const homeClaim = resource('PersistentVolumeClaim', runtimeHomeClaimName(name))
  const workspaceClaim = resource('PersistentVolumeClaim', runtimeWorkspaceClaimName(name))
  const home = await inspectClaim({ getResource }, homeClaim, placement)
  const workspace = await inspectClaim({ getResource }, workspaceClaim, {
    claimUid: placement.workspaceClaimUid,
    volumeName: placement.workspaceVolumeName,
    volumeUid: placement.workspaceVolumeUid,
  })
  const deploymentResource = resource('Deployment')
  const deployment = await getResource(deploymentResource)

  if (deployment && placement.deploymentUid && placement.deploymentUid !== deployment.metadata.uid)
    throw new Error('Runtime deployment identity changed.')
  const field = (key: string) => `placements.$.${key}`
  const setState = async (state: Placement['state']) => {
    await runtimeDeletions().updateOne(
      { _id: job._id, teamId: job.teamId, 'placements.id': placement.id },
      {
        $set: {
          [field('state')]: state,
          ...Object.fromEntries(
            Object.entries(home.identity).map(([key, value]) => [field(key), value]),
          ),
          ...(workspace.identity.claimUid
            ? { [field('workspaceClaimUid')]: workspace.identity.claimUid }
            : {}),
          ...(workspace.identity.volumeName
            ? { [field('workspaceVolumeName')]: workspace.identity.volumeName }
            : {}),
          ...(workspace.identity.volumeUid
            ? { [field('workspaceVolumeUid')]: workspace.identity.volumeUid }
            : {}),
          ...(deployment ? { [field('deploymentUid')]: deployment.metadata.uid } : {}),
        },
        $unset: { error: '' },
      },
    )
  }

  await setState('deleting')
  if (deployment) {
    if (!deployment.metadata.deletionTimestamp)
      await kube.delete(deploymentResource, deployment.metadata.uid)

    // Foreground deletion keeps the Deployment until its pods have terminated.
    return
  }
  const homePending = await removeClaim(kube, homeClaim, home)
  const workspacePending = await removeClaim(kube, workspaceClaim, workspace)
  const serviceResource = resource('Service')
  const service = await getResource(serviceResource)

  if (service && !service.metadata.deletionTimestamp)
    await kube.delete(serviceResource, service.metadata.uid)
  if (homePending || workspacePending || service) return
  await deleteRuntimeAuthSecret(job.teamId, placement.id, kube, namespace)
  await clearRuntimeAuthKey(job.teamId, placement.id)
  await setTeamRuntimeStatus(job.teamId, placement.id, 'disabled')
  await setState('deleted')
}

const placementSettled = (placement: RuntimeDeletion['placements'][number]) =>
  placement.state === 'deleted' || placement.state === 'abandoned'

/** The placement's own cluster objects stay behind; only its registry row and
 *  key, which live in the shared database, are retired from here. */
async function abandonOrphanedPlacement(
  job: RuntimeDeletion,
  placement: RuntimeDeletion['placements'][number],
) {
  const foreignNamespace = placementNamespace(placement.url)

  if (
    !foreignNamespace ||
    !(await runtimeControllerGone(job.provider, foreignNamespace, job.requestedAt))
  )
    return
  await clearRuntimeAuthKey(job.teamId, placement.id)
  await setTeamRuntimeStatus(job.teamId, placement.id, 'disabled')
  await runtimeDeletions().updateOne(
    { _id: job._id, teamId: job.teamId, 'placements.id': placement.id },
    { $set: { 'placements.$.state': 'abandoned' } },
  )
  logEvent('warn', 'runtime.deletion.placement_abandoned', {
    team_id: job.teamId,
    runtime_id: job._id,
    placement_id: placement.id,
    namespace: foreignNamespace,
  })
}

export async function reconcileRuntimeDeletions(
  namespace: string,
  provider: OpenAbProvider,
  kube: KubeClient,
) {
  const jobs = await runtimeDeletions()
    .find({ provider, completedAt: { $exists: false } })
    .toArray()

  for (const job of jobs) {
    try {
      for (const placement of job.placements) {
        if (placementSettled(placement)) continue
        if (placementNamespace(placement.url) !== namespace) {
          await abandonOrphanedPlacement(job, placement)
          continue
        }
        await withRuntimePlacementLease(job.teamId, placement.id, kube, async (guarded) => {
          const current = await runtimeDeletions().findOne({ _id: job._id, teamId: job.teamId })
          const currentPlacement = current?.placements.find((entry) => entry.id === placement.id)

          if (current && currentPlacement && currentPlacement.state !== 'deleted')
            await deletePlacement(current, currentPlacement, namespace, guarded)
        })
      }
      const latest = await runtimeDeletions().findOne({ _id: job._id, teamId: job.teamId })

      if (latest?.placements.every(placementSettled)) {
        await removeTeamRuntime(job.teamId, job._id, kube)
        await runtimeDeletions().updateOne(
          { _id: job._id, teamId: job.teamId },
          { $set: { completedAt: new Date() }, $unset: { error: '' } },
        )
      }
    } catch (error) {
      logError('runtime.deletion.paused', error, { team_id: job.teamId, runtime_id: job._id })
      // Runtime command stderr and Kubernetes response details may contain
      // private paths. Present a bounded action, never raw command output.
      await runtimeDeletions().updateOne(
        { _id: job._id, teamId: job.teamId },
        {
          $set: {
            error:
              error instanceof AppError
                ? error.message
                : 'Could not finish deleting this agent. Its remaining resources have been kept. Nuphos will retry automatically.',
          },
        },
      )
    }
  }
}

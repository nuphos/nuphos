// Deploys the runtimes Nuphos hosts. Everything past the Kubernetes objects —
// keys, sign-in, status, usage — is the same as for a self-hosted runtime.

import { placementNamespace, recordRuntimeController } from './runtime-controllers'
import { reconcileRuntimeDeletions } from './runtime-deletion'
import { hostedRuntimeDeploymentObject } from './runtime-deployment'
import { managedRuntimeImage } from './runtime-image'
import {
  PROVISIONER_FIELD_MANAGER,
  hostedRuntimeSecretObject,
  hostedRuntimeServiceObject,
  runtimeConfigMapObject,
  runtimeVolumeObjects,
} from './runtime-objects'
import { withRuntimePlacementLease } from './runtime-placement-lease'
import { runtimeDeletions } from './runtime-portability-store'
import { listHostedRuntimes, runtimes } from './runtime-registry'
import { storedAuthKey } from './runtime-registry-credentials'
import { reconcileRuntimeDeployment, TEMPLATE_ROLLOUTS_PER_TICK } from './runtime-rollout'
import { runtimeServiceName } from './runtime-service-name'

import type { KubeClient } from './kube-client'
import type { RuntimeScheduling } from './runtime-deployment'
import type { OpenAbProvider } from './runtime-provider'
import type { ClaudeCodeRuntimeDoc } from './runtime-registry'
import type { HasActiveRuntimeTurn, RolloutBudget } from './runtime-rollout'

import { logError } from '@/lib/observability'

export type ProvisionerDeps = {
  kube: KubeClient
  namespace: string
  provider: OpenAbProvider
  scheduling?: RuntimeScheduling
  hasActiveRuntimeTurn?: HasActiveRuntimeTurn
  /** Shared by one reconcile tick, so a fleet-wide change rolls a few at a time. */
  rolloutBudget?: RolloutBudget
}

/** Never throws: the Deployment mounts each claim by name and its pod waits for it. */
async function ensureVolumes(name: string, runtime: ClaudeCodeRuntimeDoc, deps: ProvisionerDeps) {
  for (const claim of runtimeVolumeObjects(name, runtime.teamId, deps.namespace)) {
    try {
      // A claim may not shrink, so an existing one is left exactly as it is.
      if (await deps.kube.getResource?.(claim)) continue
      await deps.kube.createIfAbsent(claim)
    } catch (error) {
      logError('openab.provisioner.volume_failed', error, {
        team_id: runtime.teamId,
        runtime_id: runtime._id,
        claim: claim.metadata.name,
      })
    }
  }
}

async function applyHostedRuntime(runtime: ClaudeCodeRuntimeDoc, deps: ProvisionerDeps) {
  const name = runtimeServiceName(runtime.url, deps.namespace)
  const authKey = storedAuthKey(runtime.authKeyEnvelope)

  if (!name || !authKey) throw new Error('Hosted runtime has no placement or key')
  const image = await managedRuntimeImage(deps.provider, runtime.requestedRuntimeVersion)

  // The next tick retries. Leaving the live Deployment alone beats rolling it to a guess.
  if (!image) throw new Error('No published nuphos-runtime release to deploy')
  const { teamId, _id: runtimeId } = runtime

  await deps.kube.apply(
    hostedRuntimeSecretObject({ teamId, runtimeId, namespace: deps.namespace, authKey }),
    PROVISIONER_FIELD_MANAGER,
  )
  await ensureVolumes(name, runtime, deps)
  await reconcileRuntimeDeployment({
    kube: deps.kube,
    deployment: hostedRuntimeDeploymentObject({
      name,
      teamId,
      runtimeId,
      namespace: deps.namespace,
      image,
      provider: deps.provider,
      running: runtime.status === 'active',
      ...(deps.scheduling ? { scheduling: deps.scheduling } : {}),
    }),
    teamId,
    runtimeId,
    provider: deps.provider,
    hasActiveRuntimeTurn: deps.hasActiveRuntimeTurn,
    rolloutBudget: deps.rolloutBudget,
  })
  await deps.kube.apply(
    hostedRuntimeServiceObject(name, teamId, deps.namespace),
    PROVISIONER_FIELD_MANAGER,
  )
}

/** Brings one hosted runtime's objects up to date, serialized with every other replica. */
export async function provisionHostedRuntime(
  runtime: ClaudeCodeRuntimeDoc,
  deps: ProvisionerDeps,
): Promise<void> {
  if (await runtimeDeletions().findOne({ _id: runtime._id, teamId: runtime.teamId })) return
  await withRuntimePlacementLease(runtime.teamId, runtime._id, deps.kube, (kube) =>
    applyHostedRuntime(runtime, { ...deps, kube }),
  )
}

export async function reconcileHostedRuntimes(deps: ProvisionerDeps): Promise<void> {
  await recordRuntimeController(deps.namespace, deps.provider)
  await deps.kube.apply(
    runtimeConfigMapObject(deps.namespace, deps.provider),
    PROVISIONER_FIELD_MANAGER,
  )
  const rolloutBudget: RolloutBudget = { remaining: TEMPLATE_ROLLOUTS_PER_TICK }

  for (const runtime of await listHostedRuntimes(deps.provider)) {
    // The registry is shared across environments; each deploys only its own namespace.
    if (placementNamespace(runtime.url) !== deps.namespace) continue
    try {
      await provisionHostedRuntime(runtime, { ...deps, rolloutBudget })
      if (runtime.runtimeUpdateError)
        await runtimes().updateOne(
          { _id: runtime._id, teamId: runtime.teamId },
          { $unset: { runtimeUpdateError: '' } },
        )
    } catch (error) {
      if (runtime.requestedRuntimeVersion)
        await runtimes()
          .updateOne(
            { _id: runtime._id, teamId: runtime.teamId },
            {
              $set: {
                runtimeUpdateError:
                  'Could not apply the update. The agent will retry automatically.',
              },
            },
          )
          .catch((persistError: unknown) => {
            logError('openab.provisioner.update_status_failed', persistError, {
              runtime_id: runtime._id,
            })
          })
      logError('openab.provisioner.instance_reconcile_failed', error, {
        team_id: runtime.teamId,
        runtime_id: runtime._id,
        provider: deps.provider,
      })
    }
  }
  await reconcileRuntimeDeletions(deps.namespace, deps.provider, deps.kube)
}

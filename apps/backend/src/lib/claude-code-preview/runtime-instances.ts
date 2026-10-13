import { randomBytes, randomUUID } from 'node:crypto'

import { config } from '@/config'
import { AppError } from '@/lib/errors'
import { logError } from '@/lib/observability'

import { provisionerKubeClient } from './provisioner-kube'
import { managedRuntimeImage } from './runtime-image'
import { hostedRuntimeName, hostedRuntimeUrl } from './runtime-objects'
import { runtimeProvider } from './runtime-provider'
import { provisionHostedRuntime } from './runtime-reconcile'
import { registerTeamRuntime, runtimes } from './runtime-registry'

import type { LocalRuntimeSummary } from './local-runtime-catalog'
import type { OpenAbProvider } from './runtime-provider'

export type RuntimeInstance = {
  /** Registered but not reachable from here yet, so nothing can move onto it. */
  notReady?: true
  id: string
  provider: OpenAbProvider
  label: string
  /** The image a runtime Nuphos hosts runs. */
  image?: string
  status: 'active' | 'disabled'
  /** `managed` is a self-hosted runtime that Nuphos deploys. */
  kind: 'managed' | 'external' | 'development' | 'local'
  /** Self-hosted only: whether this team holds its own pairing or the runtime's shared password. */
  connection?: 'paired' | 'password'
  /** Set for `local`: one of the requesting user's own computers. */
  local?: LocalRuntimeSummary
  deletion?: { state: 'deleting'; error?: string }
  createdAt: string
}

/**
 * Registers a runtime the way an administrator registers a self-hosted one with its
 * password, and deploys a pod started with that password. The reconcile loop retries a
 * deploy that fails here.
 */
export async function createManagedRuntimeInstance(args: {
  teamId: string
  userId: string
  provider: OpenAbProvider
  label: string
}): Promise<RuntimeInstance> {
  const image = await managedRuntimeImage(args.provider)

  if (!image)
    throw new AppError(
      503,
      'runtime_release_unavailable',
      'No published runtime image is available.',
    )
  const id = randomUUID()
  const name = hostedRuntimeName(args.teamId, args.provider, id)
  const runtime = await registerTeamRuntime({
    id,
    teamId: args.teamId,
    userId: args.userId,
    url: hostedRuntimeUrl(name, config.claudeCodeRuntimeProvisioner.namespace),
    provider: args.provider,
    authKey: randomBytes(32).toString('hex'),
    label: args.label,
    hostedBy: 'nuphos',
    deploymentImage: image,
  })
  const { enabled, namespace, scheduling } = config.claudeCodeRuntimeProvisioner
  const kube = enabled ? provisionerKubeClient() : null
  const hosted = kube && (await runtimes().findOne({ _id: runtime.id, teamId: args.teamId }))

  if (kube && hosted)
    await provisionHostedRuntime(hosted, {
      kube,
      namespace,
      scheduling,
      provider: runtimeProvider(args.provider),
    }).catch((error: unknown) => {
      logError('openab.provisioner.instance_create_failed', error, {
        team_id: args.teamId,
        runtime_id: runtime.id,
      })
    })

  return {
    id: runtime.id,
    provider: args.provider,
    label: args.label,
    image,
    status: runtime.status,
    kind: 'managed',
    createdAt: runtime.createdAt,
  }
}

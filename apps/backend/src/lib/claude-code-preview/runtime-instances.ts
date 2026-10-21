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

/** Every hosted runtime is a pod in one shared namespace; this keeps one team
 *  from taking the whole runtime node pool. */
const MAX_HOSTED_RUNTIMES_PER_TEAM = 20

/** The team's hosted runtimes that hold a slot: the oldest ones, ties broken by
 *  id, so every concurrent create agrees on who got in. */
async function hostedRuntimesWithSlot(teamId: string): Promise<string[]> {
  const docs = await runtimes()
    .find({ teamId, hostedBy: 'nuphos', managedBy: { $exists: false } })
    .project<{ _id: string; createdAt: Date }>({ _id: 1, createdAt: 1 })
    .toArray()

  return docs
    .toSorted((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a._id.localeCompare(b._id))
    .slice(0, MAX_HOSTED_RUNTIMES_PER_TEAM)
    .map((doc) => doc._id)
}
function runtimeLimitReached() {
  return new AppError(409, 'runtime_limit_reached', 'This team has reached its hosted agent limit.')
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
  if ((await hostedRuntimesWithSlot(args.teamId)).length >= MAX_HOSTED_RUNTIMES_PER_TEAM)
    throw runtimeLimitReached()
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

  // Concurrent creates can all pass the check above; the ones left without a
  // slot once every row is in back out before anything is deployed.
  if (!(await hostedRuntimesWithSlot(args.teamId)).includes(runtime.id)) {
    await runtimes().deleteOne({ _id: runtime.id, teamId: args.teamId })
    throw runtimeLimitReached()
  }
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

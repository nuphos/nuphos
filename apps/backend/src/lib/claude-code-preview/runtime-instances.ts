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
import type { ClaudeCodeRuntime } from './runtime-registry'

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

/** Each hosted runtime holds one of its team's numbered slots. The unique index
 *  makes concurrent creates for the same slot fail on insert, across replicas. */
export async function setupHostedRuntimeSlotIndexes(): Promise<void> {
  await runtimes().createIndex(
    { teamId: 1, hostedSlot: 1 },
    {
      unique: true,
      name: 'claude_code_runtimes_hosted_slot',
      partialFilterExpression: { hostedSlot: { $type: 'number' } },
    },
  )
}

/** Slots the team can still take. Runtimes created before slots existed hold
 *  none, so they shorten the range instead; none are created any more. */
async function freeHostedSlots(teamId: string): Promise<number[]> {
  const docs = await runtimes()
    .find({ teamId, hostedBy: 'nuphos', managedBy: { $exists: false } })
    .project<{ hostedSlot?: number }>({ hostedSlot: 1 })
    .toArray()
  const taken = new Set(docs.map((doc) => doc.hostedSlot))
  const unslotted = docs.filter((doc) => typeof doc.hostedSlot !== 'number').length

  return Array.from(
    { length: Math.max(0, MAX_HOSTED_RUNTIMES_PER_TEAM - unslotted) },
    (_, slot) => slot,
  ).filter((slot) => !taken.has(slot))
}
function runtimeLimitReached() {
  return new AppError(409, 'runtime_limit_reached', 'This team has reached its hosted agent limit.')
}
const isDuplicateKey = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 11000

/** Another create can take a slot between the read and the insert; move on to the next. */
async function registerInFreeSlot(
  slots: number[],
  register: (slot: number) => Promise<ClaudeCodeRuntime>,
): Promise<ClaudeCodeRuntime> {
  for (const slot of slots) {
    try {
      return await register(slot)
    } catch (error) {
      if (!isDuplicateKey(error)) throw error
    }
  }
  throw runtimeLimitReached()
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
  const slots = await freeHostedSlots(args.teamId)

  if (!slots.length) throw runtimeLimitReached()
  const image = await managedRuntimeImage(args.provider)

  if (!image)
    throw new AppError(
      503,
      'runtime_release_unavailable',
      'No published runtime image is available.',
    )
  const id = randomUUID()
  const name = hostedRuntimeName(args.teamId, args.provider, id)
  const runtime = await registerInFreeSlot(slots, (hostedSlot) =>
    registerTeamRuntime({
      id,
      teamId: args.teamId,
      userId: args.userId,
      url: hostedRuntimeUrl(name, config.claudeCodeRuntimeProvisioner.namespace),
      provider: args.provider,
      authKey: randomBytes(32).toString('hex'),
      label: args.label,
      hostedBy: 'nuphos',
      deploymentImage: image,
      hostedSlot,
    }),
  )
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

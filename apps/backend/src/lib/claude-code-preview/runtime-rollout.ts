import { reachableRuntimeEndpoint } from './dev-runtime-forward'
import { OpenAbAcpClient } from './openab-acp-client'
import { PROVISIONER_FIELD_MANAGER } from './runtime-objects'
import { runtimeProvider } from './runtime-provider'
import { resolveTeamRuntimeEndpoints, runtimes } from './runtime-registry'
import { podTemplateChanged } from './runtime-template-diff'

import type { KubeClient, KubeResourceState } from './kube-client'
import type { KubeObject } from './runtime-objects'
import type { OpenAbProvider } from './runtime-provider'

import { logEvent } from '@/lib/observability'

export type HasActiveRuntimeTurn = (teamId: string, runtimeId: string) => Promise<boolean>

/** Template rollouts one reconcile tick may start, shared by every runtime in it. */
export type RolloutBudget = { remaining: number }

export const TEMPLATE_ROLLOUTS_PER_TICK = 3

type DeploymentRevision = {
  image?: string
  template?: unknown
}

function deploymentRevision(resource: KubeObject | KubeResourceState): DeploymentRevision {
  const spec = resource.spec as
    | {
        template?: { spec?: { containers?: { name?: string; image?: string }[] } }
      }
    | undefined
  const containers = spec?.template?.spec?.containers ?? []

  return {
    image: (containers.find((container) => container.name === 'openab') ?? containers[0])?.image,
    template: spec?.template,
  }
}

/**
 * Whether applying the desired Deployment would recreate the pod.
 *
 * `apply` ships the whole pod template, so the whole template decides this;
 * the image is only a cheap first look that settles the common case.
 */
function deploymentNeedsRollout(current: KubeResourceState, desired: KubeObject): boolean {
  const currentRevision = deploymentRevision(current)
  const desiredRevision = deploymentRevision(desired)

  return (
    currentRevision.image !== desiredRevision.image ||
    podTemplateChanged(desiredRevision.template, currentRevision.template)
  )
}

async function defaultHasActiveRuntimeTurn(teamId: string, runtimeId: string): Promise<boolean> {
  const record = await runtimes().findOne({ _id: runtimeId, teamId })
  const endpoints = await resolveTeamRuntimeEndpoints(
    teamId,
    undefined,
    runtimeProvider(record?.provider),
    'control',
  )
  const endpoint = endpoints.find((candidate) => candidate.runtimeId === runtimeId)

  if (!endpoint) return false
  let client: OpenAbAcpClient | undefined

  // Only a turn the runtime reports as running holds a rollout. Anything the
  // guard cannot read as one (unreachable, an older runtime's answer, leftover
  // background tools) lets it through: holding on those deadlocks the update
  // that would fix them.
  try {
    client = await OpenAbAcpClient.connect({
      ...(await reachableRuntimeEndpoint(endpoint)),
      connectTimeoutMs: 3_000,
      callTimeoutMs: 3_000,
    })
    await client.initialize()
    const inventory = await client.getRuntimeExecutionState()

    return (
      Array.isArray(inventory.sessions) &&
      inventory.sessions.some((snapshot: { state?: string }) => snapshot.state === 'active')
    )
  } catch {
    return false
  } finally {
    client?.close()
  }
}

export type RolloutHold = 'active_turn' | 'rate_limited'

/**
 * Whether a template rollout has to wait, claiming a slot of the tick's budget
 * when it does not. An unchanged template holds nothing and costs no round
 * trip: applying it again cannot recreate the pod.
 */
export async function runtimeRolloutHold(args: {
  kube: KubeClient
  deployment: KubeObject
  teamId: string
  runtimeId: string
  hasActiveRuntimeTurn?: HasActiveRuntimeTurn
  rolloutBudget?: RolloutBudget
}): Promise<RolloutHold | null> {
  if (!args.kube.getResource) return null
  const current = await args.kube.getResource(args.deployment)

  if (!current || !deploymentNeedsRollout(current, args.deployment)) return null
  if (args.rolloutBudget && args.rolloutBudget.remaining <= 0) return 'rate_limited'
  if (await (args.hasActiveRuntimeTurn ?? defaultHasActiveRuntimeTurn)(args.teamId, args.runtimeId))
    return 'active_turn'
  if (args.rolloutBudget) args.rolloutBudget.remaining -= 1

  return null
}

/** Applies the desired Deployment unless recreating its pod now would cut off a turn. */
export async function reconcileRuntimeDeployment(args: {
  kube: KubeClient
  deployment: KubeObject
  teamId: string
  runtimeId: string
  provider?: OpenAbProvider
  hasActiveRuntimeTurn?: HasActiveRuntimeTurn
  rolloutBudget?: RolloutBudget
}): Promise<void> {
  const hold = await runtimeRolloutHold(args)

  if (hold) {
    logEvent(
      'info',
      hold === 'active_turn'
        ? 'openab.provisioner.rollout_deferred_active_turn'
        : 'openab.provisioner.rollout_rate_limited',
      {
        team_id: args.teamId,
        runtime_id: args.runtimeId,
        provider: args.provider,
      },
    )

    return
  }
  await args.kube.apply(args.deployment, PROVISIONER_FIELD_MANAGER)
}

import { randomInt } from 'node:crypto'

import { controlRegistry } from '@/lib/claude-code-preview/agent-chat-registry'
import { OPENAB_PROVIDERS } from '@/lib/claude-code-preview/runtime-provider'
import { resolveTeamRuntimeEndpoints } from '@/lib/claude-code-preview/runtime-registry'
import { RuntimeCapabilityError } from '@/lib/claude-code-preview/team-openab-runtime'
import { logEvent } from '@/lib/observability'

import { PanelExecError } from './errors'

import type { OpenAbAcpClient } from '@/lib/claude-code-preview/openab-acp-client'
import type { TeamRuntimeEndpoint } from '@/lib/claude-code-preview/team-openab-runtime'

export const PANEL_JOB = 'panel'

export type PanelRuntimeContext = { teamId: string; panelId: string }

/** Orders a team's usable runtimes by preference; the first reachable one that
 *  can run the panel job wins. */
export type PanelRuntimeStrategy = (
  candidates: readonly TeamRuntimeEndpoint[],
  context: PanelRuntimeContext,
) => TeamRuntimeEndpoint[]

export const randomRuntimeOrder: PanelRuntimeStrategy = (candidates) => {
  const order = [...candidates]

  for (let i = order.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    const swap = order[i]!

    order[i] = order[j]!
    order[j] = swap
  }

  return order
}

export type PanelRuntimeClient = Pick<OpenAbAcpClient, 'runJob'> & {
  supportsRuntimeJob: (job: string) => boolean
}

export type PanelRuntime = {
  endpoint: TeamRuntimeEndpoint
  client: PanelRuntimeClient
}

export type PanelRuntimeDeps = {
  listEndpoints: (teamId: string) => Promise<TeamRuntimeEndpoint[]>
  acquire: (teamId: string, endpoint: TeamRuntimeEndpoint) => Promise<PanelRuntimeClient>
}

const defaultDeps: PanelRuntimeDeps = {
  listEndpoints: async (teamId) =>
    (
      await Promise.all(
        OPENAB_PROVIDERS.map((provider) =>
          resolveTeamRuntimeEndpoints(teamId, undefined, provider, 'control'),
        ),
      )
    ).flat(),
  acquire: async (teamId, endpoint) => {
    const client = await controlRegistry.acquire(teamId, endpoint)

    return {
      runJob: (request, callTimeoutMs) => client.runJob(request, callTimeoutMs),
      supportsRuntimeJob: (job) => controlRegistry.runtimeJobs(teamId, endpoint).includes(job),
    }
  },
}

export const NO_RUNTIME_MESSAGE =
  'This team has no agent online. Dashboard panels run on one of your agents: add one or bring one back online in Settings → Agent, then refresh.'
export const UNREACHABLE_RUNTIME_MESSAGE =
  "None of this team's agents could be reached. Check that an agent is online in Settings → Agent, then refresh."
export const PARTLY_UNREACHABLE_RUNTIME_MESSAGE =
  "Some of this team's agents could not be reached, and the reachable ones run an image that cannot run dashboard panels. Bring an agent online or update one to the latest image in Settings → Agent, then refresh."
export const OUTDATED_RUNTIME_MESSAGE =
  "This team's agents run an image that cannot run dashboard panels. Update an agent to the latest image in Settings → Agent, then refresh."

export async function selectPanelRuntime(
  context: PanelRuntimeContext,
  strategy: PanelRuntimeStrategy = randomRuntimeOrder,
  deps: PanelRuntimeDeps = defaultDeps,
): Promise<PanelRuntime> {
  const candidates = await deps.listEndpoints(context.teamId)

  if (candidates.length === 0) throw new PanelExecError('runtime_unavailable', NO_RUNTIME_MESSAGE)
  let unreachable = 0

  for (const endpoint of strategy(candidates, context)) {
    let reason: string

    try {
      const client = await deps.acquire(context.teamId, endpoint)

      if (client.supportsRuntimeJob(PANEL_JOB)) return { endpoint, client }
      reason = `runtime does not advertise the ${PANEL_JOB} job`
    } catch (err) {
      if (!(err instanceof RuntimeCapabilityError)) unreachable++
      reason = err instanceof Error ? err.message : String(err)
    }
    logEvent('warn', 'dashboard.panel.runtime_unusable', {
      team_id: context.teamId,
      runtime_id: endpoint.runtimeId ?? null,
      reason,
    })
  }

  if (unreachable === 0) throw new PanelExecError('runtime_outdated', OUTDATED_RUNTIME_MESSAGE)
  throw new PanelExecError(
    'runtime_unavailable',
    unreachable === candidates.length
      ? UNREACHABLE_RUNTIME_MESSAGE
      : PARTLY_UNREACHABLE_RUNTIME_MESSAGE,
  )
}

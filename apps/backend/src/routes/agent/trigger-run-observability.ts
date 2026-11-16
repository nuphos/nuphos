import { AppError } from '@/lib/errors'
import { captureException } from '@/lib/posthog'

import { traceAgentChatError } from './trace'

import type { AgentRunTrace } from './types'

const isOfflineError = (e: unknown) => e instanceof AppError && e.code === 'runtime_offline'

/** The agent's computer is offline: a state the person fixes by opening Nuphos
 *  on it, not a fault. The state probe keeps it as its cause. */
function isRuntimeOffline(error: unknown): boolean {
  return isOfflineError(error) || (error instanceof Error && isOfflineError(error.cause))
}

export function recordTriggerRunFailure(
  error: unknown,
  trace: AgentRunTrace,
  source: string,
  runtime: { buildSha?: string; adapterVersion?: string } = {},
): void {
  const errorContext = {
    source,
    build_sha: runtime.buildSha ?? null,
    adapter_version: runtime.adapterVersion ?? null,
  }

  traceAgentChatError('agent.trigger.request.error', error, trace, errorContext)
  if (isRuntimeOffline(error)) return
  captureException(error, {
    source: 'agent.trigger.request',
    distinctId: trace.userId,
    properties: {
      request_id: trace.requestId,
      session_id: trace.sessionId,
      team_id: trace.teamId,
      stream_id: trace.streamId,
      route: trace.route,
      ...errorContext,
    },
  })
}

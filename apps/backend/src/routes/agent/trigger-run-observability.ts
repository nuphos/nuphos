import { config } from '@/config'
import { captureException } from '@/lib/posthog'

import { traceAgentChatError } from './trace'

import type { AgentRunTrace } from './types'

export function recordTriggerRunFailure(
  error: unknown,
  trace: AgentRunTrace,
  source: string,
): void {
  const errorContext = {
    source,
    provider: config.agent.modelProvider,
    model_id: config.agent.agentModelId,
  }

  traceAgentChatError('agent.trigger.request.error', error, trace, errorContext)
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

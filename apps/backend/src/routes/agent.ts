import './agent/routes-chat'
import './agent/routes-chat-post'
import './agent/routes-memories'
import './agent/routes-memories-insights'
import './agent/routes-memories-item'
import './agent/routes-conversations'
import './agent/routes-suggestions'
import './agent/routes-conversations-mutations'
import './agent/routes-conversations-slack-pickup'
import './agent/routes-conversations-read'
import './agent/routes-plans'
import './agent/routes-auto-mode'
import './agent/routes-devices'
import './agent/routes-device-runtime'

import { agent } from './agent/router'
import { conversationParticipantsRoutes } from './agent/routes-conversation-participants'
import { sessionConfigRoutes } from './agent/routes-session-config'

agent.route('/', conversationParticipantsRoutes)
agent.route('/', sessionConfigRoutes)

export { chatSurfaceMessage } from './agent/chat-surface'
export { resolveTriggerCredentialAccess } from './agent/credential-access'
export { renderAgentCredentialPrompt } from './agent/credential-prompt'
export { resolveAgentCredentialAccess } from './agent/credential-resolve'
export { renderPermissionWallPrompt } from './agent/permission-wall'
export { agent } from './agent/router'
export { isPlanReadyForApproval } from '@/lib/agent/plan-readiness'
export { drainInFlightAgentRuns } from './agent/run-frames'
export { startAgentRunStallSweeper } from './agent/run-stall'
export {
  claimAgentRunForSession,
  claimAgentRunOrEnqueue,
  hasActiveAgentRunForSession,
} from './agent/run-registry'
export { resolveVerifiedTeamId } from './agent/team-scope'
export { runAgentForTrigger } from './agent/trigger-run'

export type { AgentRunOutcome } from './agent/run-pump-helpers'
export type { ClaimOrEnqueueResult } from './agent/run-registry'
export type { AgentRunFrameSink, TriggerRunParams } from './agent/trigger-run'

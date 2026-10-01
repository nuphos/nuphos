import { Hono } from 'hono'

import { registerSlackCommandRoutes } from '@/routes/slack/commands'
import { registerSlackEventRoutes } from '@/routes/slack/events'
import { registerSlackInteractionRoutes } from '@/routes/slack/interactions'
import { registerSlackMappingRoutes } from '@/routes/slack/mappings'
import { registerSlackUserMappingRoutes } from '@/routes/slack/user-mappings'

import type { AuthVariables } from '@/middleware/auth'

export const slackRoutes = new Hono<{ Variables: AuthVariables }>()

registerSlackCommandRoutes(slackRoutes)
registerSlackEventRoutes(slackRoutes)
registerSlackInteractionRoutes(slackRoutes)
registerSlackMappingRoutes(slackRoutes)
registerSlackUserMappingRoutes(slackRoutes)

export { handleAppMention } from '@/routes/slack/mention'
export { persistedMessageToUiMessage } from '@/routes/slack/messages'
export { beginNuphosSlackTurn } from '@/routes/slack/nuphos-turn'
export type { NuphosSlackTurnDelivery, NuphosSlackTurnOutcome } from '@/routes/slack/nuphos-turn'
export { handlePermissionGrantInteraction } from '@/routes/slack/permission-decide'
export { handlePlanApproveInteraction } from '@/routes/slack/plan-approve'
export { handleToolApprovalInteraction } from '@/routes/slack/tool-approval-decide'
export { resumeApprovedPlanTurnFromNuphos } from '@/routes/slack/plan-resume'
export { handleThreadMessage } from '@/routes/slack/thread-message'

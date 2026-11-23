import { conversationSettingsApiOperations } from './conversation-settings'
import { credentialApiOperations } from './credentials'
import { databaseConnectionApiOperations } from './database-connections'
import { feedbackApiOperations } from './feedback'
import { oauthApiOperations } from './oauth'
import { planApiOperations } from './plans'
import { reminderApiOperations } from './reminders'
import { triggerHistoryApiOperations } from './trigger-history'
import { zeaburProviderApiOperations } from './zeabur-providers'

export const atlasApiOperations = [
  ...credentialApiOperations,
  ...conversationSettingsApiOperations,
  ...zeaburProviderApiOperations,
  ...planApiOperations,
  ...databaseConnectionApiOperations,
  ...feedbackApiOperations,
  ...oauthApiOperations,
  ...triggerHistoryApiOperations,
  ...reminderApiOperations,
] as const

export { assertApiOperationSchemas, byOperationId, routePathForMount } from './registry'
export type { ApiOperation, ApiAuth, HttpMethod } from './registry'

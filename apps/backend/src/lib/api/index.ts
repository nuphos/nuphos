import { credentialApiOperations } from './credentials'
import { databaseConnectionApiOperations } from './database-connections'
import { feedbackApiOperations } from './feedback'
import { planApiOperations } from './plans'
import { zeaburProviderApiOperations } from './zeabur-providers'

export const atlasApiOperations = [
  ...credentialApiOperations,
  ...zeaburProviderApiOperations,
  ...planApiOperations,
  ...databaseConnectionApiOperations,
  ...feedbackApiOperations,
] as const

export { assertApiOperationSchemas, byOperationId, routePathForMount } from './registry'
export type { ApiOperation, ApiAuth, HttpMethod } from './registry'

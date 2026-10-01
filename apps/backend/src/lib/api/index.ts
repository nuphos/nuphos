import { credentialApiOperations } from './credentials'
import { databaseConnectionApiOperations } from './database-connections'
import { planApiOperations } from './plans'
import { zeaburProviderApiOperations } from './zeabur-providers'

export const atlasApiOperations = [
  ...credentialApiOperations,
  ...zeaburProviderApiOperations,
  ...planApiOperations,
  ...databaseConnectionApiOperations,
] as const

export { assertApiOperationSchemas, byOperationId, routePathForMount } from './registry'
export type { ApiOperation, ApiAuth, HttpMethod } from './registry'

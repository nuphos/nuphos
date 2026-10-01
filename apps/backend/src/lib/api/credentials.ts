import { agentCredentialOperations } from './credentials/operations-agent'
import { infraCredentialOperations } from './credentials/operations-infra'

import type { ApiOperation } from './registry'

export { agentCredentialSelectionSchema } from './credentials/agent-schemas'
export { gcpCloudRunServicePathSchema } from './credentials/paths'

export const credentialApiOperations = [
  ...agentCredentialOperations,
  ...infraCredentialOperations,
] as const satisfies readonly ApiOperation[]

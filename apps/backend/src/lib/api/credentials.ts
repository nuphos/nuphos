import { agentCredentialOperations } from './credentials/operations-agent'
import { firebaseOperations } from './credentials/firebase'
import { infraCredentialOperations } from './credentials/operations-infra'

import type { ApiOperation } from './registry'

export { agentCredentialSelectionSchema } from './credentials/agent-schemas'
export { gcpCloudRunServicePathSchema } from './credentials/paths'

export const credentialApiOperations = [
  ...agentCredentialOperations,
  ...infraCredentialOperations,
  ...firebaseOperations,
] as const satisfies readonly ApiOperation[]

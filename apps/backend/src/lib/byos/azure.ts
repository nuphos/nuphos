export { generateAksKubeconfig, listAksClusters } from './azure/aks'
export {
  AZURE_GUID_PATTERN,
  assumeAzureViaOidc,
  azureOidcConfigured,
  azureOidcInfo,
  verifyAzureBinding,
} from './azure/core'
export type { AzureHandle, AzureIdentity } from './azure/core'
export { listAzureRoleAssignments } from './azure/rbac-read'
export type { AzureRoleAssignment } from './azure/rbac-read'

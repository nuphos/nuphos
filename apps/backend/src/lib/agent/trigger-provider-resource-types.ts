export type ManagedProviderResourceOwnership = 'created' | 'modified' | 'referenced'
export type ManagedProviderCleanupAction = 'delete' | 'detach' | 'restore' | 'preserve' | 'manual'
export type ManagedProviderCleanupStepAction =
  'disable' | 'delete' | 'detach' | 'restore' | 'preserve' | 'manual'

export type ManagedProviderResource = {
  kind: string
  name: string
  id: string
  url?: string
  ownership: ManagedProviderResourceOwnership
  cleanupAction: ManagedProviderCleanupAction
  description: string
}

export type ManagedProviderCleanupStep = {
  action: ManagedProviderCleanupStepAction
  description: string
  resourceId?: string
}

export type ManagedProviderResourcePlan = {
  provider: string
  providerLabel?: string
  cleanupMode?: 'automatic' | 'manual'
  integrationLabel?: string
  recordedAt?: string
  resources: ManagedProviderResource[]
  cleanupSteps: ManagedProviderCleanupStep[]
}

export type ManagedProviderResourceContext = {
  integrationLabel?: string
  grafanaUrl?: string
  betterStackDashboardTeamId?: string
}

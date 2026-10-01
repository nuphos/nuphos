export type PosthogRegion = 'us' | 'eu'

export type PosthogProject = {
  id: number
  name: string
  organizationId: string
  organizationName: string | null
}

export type PosthogIntegration = {
  id: string
  label: string
  region: PosthogRegion
  apiBaseUrl: string
  userEmail: string | null
  projects: PosthogProject[]
  status: 'connected' | 'reconnect_required'
  requestedScopes: string[]
  grantedScopes: string[]
  permissions: PosthogPermissions
  missingScopes: string[]
  extraScopes: string[]
  createdAt: string
}

export type PosthogAccess = 'none' | 'read' | 'write'

export type PosthogPermissions = Record<string, PosthogAccess>

export type PosthogScopeResource = {
  id: string
  label: string
  description: string
  writable: boolean
  writeWarning: string | null
}

export type PosthogPreset = {
  id: 'read_only' | 'read_write'
  label: string
  permissions: PosthogPermissions
}

export type PosthogScopeCatalog = {
  fixedScopes: string[]
  resources: PosthogScopeResource[]
  presets: PosthogPreset[]
}

export type PosthogOAuthInput = {
  label?: string
  region?: PosthogRegion
  integrationId?: string
  permissions?: PosthogPermissions
}

export type PosthogOAuthResult =
  | { ok: true; bindingId: string; teamId: string; accountName: string }
  | { ok: false; error: string; description: string }

export const POSTHOG_RECONNECT_REQUIRED = 'posthog_reconnect_required'

export const POSTHOG_REGION_LABELS: Record<PosthogRegion, string> = {
  us: 'US Cloud',
  eu: 'EU Cloud',
}

export function posthogStatusLine(integration: PosthogIntegration): string {
  if (integration.status === 'reconnect_required') return 'Reconnect required'
  const count = integration.projects.length
  const projects = count === 1 ? '1 project' : `${String(count)} projects`

  return `${projects} · ${POSTHOG_REGION_LABELS[integration.region]}`
}

import { call } from './client'

import type { BindingAccess } from './teams'

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
  permissions: Record<string, PosthogAccess>
  missingScopes: string[]
  extraScopes: string[]
  createdAt: string
}

export type PosthogAccess = 'none' | 'read' | 'write'

export type PosthogScopeCatalog = {
  fixedScopes: string[]
  resources: {
    id: string
    label: string
    description: string
    writable: boolean
    writeWarning: string | null
  }[]
  presets: { id: string; label: string; permissions: Record<string, PosthogAccess> }[]
}

export type PosthogOAuthInput = {
  label?: string
  region?: PosthogRegion
  integrationId?: string
  permissions?: Record<string, PosthogAccess>
}

export type PosthogOAuthStart = {
  authorizeUrl: string
  state: string
  expiresAt: string
}

const base = (teamId: string) => `/teams/${teamId}/posthog-integrations`

export async function listPosthogIntegrations(teamId: string): Promise<PosthogIntegration[]> {
  const data = await call<{ integrations: PosthogIntegration[] }>('GET', base(teamId))

  return data.integrations
}

export async function getPosthogScopeCatalog(teamId: string): Promise<PosthogScopeCatalog> {
  return call<PosthogScopeCatalog>('GET', `${base(teamId)}/scope-catalog`)
}

export async function startPosthogOAuth(
  teamId: string,
  input: PosthogOAuthInput,
): Promise<PosthogOAuthStart> {
  return call<PosthogOAuthStart>('POST', `${base(teamId)}/start-oauth`, input, { retry: false })
}

export async function cancelPosthogOAuth(teamId: string, state: string): Promise<void> {
  await call<unknown>(
    'DELETE',
    `${base(teamId)}/start-oauth/${encodeURIComponent(state)}`,
    undefined,
    { retry: false },
  )
}

export async function unbindPosthogIntegration(
  teamId: string,
  integrationId: string,
): Promise<void> {
  await call<unknown>('DELETE', `${base(teamId)}/${integrationId}`, undefined, { retry: false })
}

export async function listPosthogAvailableProjects(
  teamId: string,
  integrationId: string,
): Promise<PosthogProject[]> {
  const data = await call<{ projects: PosthogProject[] }>(
    'GET',
    `${base(teamId)}/${integrationId}/available-projects`,
  )

  return data.projects
}

export async function updatePosthogProjects(
  teamId: string,
  integrationId: string,
  projectIds: number[],
): Promise<PosthogIntegration> {
  return call<PosthogIntegration>(
    'PUT',
    `${base(teamId)}/${integrationId}/projects`,
    { projectIds },
    { retry: false },
  )
}

export async function getPosthogIntegrationAccess(
  teamId: string,
  integrationId: string,
): Promise<BindingAccess> {
  return call<BindingAccess>('GET', `${base(teamId)}/${integrationId}/access`)
}

export async function updatePosthogIntegrationAccess(
  teamId: string,
  integrationId: string,
  access: Pick<BindingAccess, 'memberAllowList'>,
): Promise<BindingAccess> {
  return call<BindingAccess>('PUT', `${base(teamId)}/${integrationId}/access`, access)
}

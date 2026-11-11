import { impersonateSa } from './gcp'

import type { GcpHandle } from './gcp'

import { firebaseAppsSchema, firebaseProjectSchema } from '@/lib/api/credentials/firebase-schemas'
import { AppError } from '@/lib/errors'

export async function firebaseGet(
  handle: GcpHandle,
  operation: 'project' | 'apps',
  pageToken?: string,
  request: typeof fetch = fetch,
) {
  const path = `projects/${encodeURIComponent(handle.projectId)}`
  const url = new URL(
    `https://firebase.googleapis.com/v1beta1/${path}${operation === 'apps' ? ':searchApps' : ''}`,
  )

  if (operation === 'apps') {
    url.searchParams.set('pageSize', '100')
    if (pageToken) url.searchParams.set('pageToken', pageToken)
  }
  const client = await impersonateSa(handle.serviceAccountEmail, handle.teamId)
  const { token } = await client.getAccessToken()

  if (!token) throw new AppError(502, 'token_unavailable', 'Failed to mint GCP access token')
  const response = await request(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
    redirect: 'error',
  })

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: { details?: { reason?: string }[] }
    }
    const disabled = body.error?.details?.some((detail) => detail.reason === 'SERVICE_DISABLED')
    const code = disabled ? 'firebase_api_disabled' : 'firebase_upstream_error'
    const message = disabled
      ? 'Firebase Management API is disabled. No API was enabled automatically.'
      : `Firebase ${operation} request failed (HTTP ${String(response.status)}). Check Firebase enablement and the selected service account permissions.`

    throw new AppError(response.status === 403 ? 403 : 502, code, message, {
      upstreamStatus: response.status,
      projectId: handle.projectId,
      serviceAccountEmail: handle.serviceAccountEmail,
      permission: operation === 'project' ? 'firebase.projects.get' : 'firebase.clients.list',
    })
  }

  const data: unknown = await response.json()

  return operation === 'project'
    ? firebaseProjectSchema.parse(data)
    : firebaseAppsSchema.parse(data)
}

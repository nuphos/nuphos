import { impersonateSa } from './gcp'

import type { GcpHandle } from './gcp'

const GCP_FETCH_TIMEOUT_MS = 30_000

export type GcpUpstreamError = Error & {
  code: number
  upstreamStatus: number
  reason?: string
  service?: string
  serviceTitle?: string
  activationUrl?: string
  project?: string
  /** IAM permission named by GCP as missing (e.g. "run.services.list"). */
  permission?: string
  /** Full resource name the call targeted, when GCP reports it. */
  resource?: string
  rawBody: string
}

type GcpErrorDetail = {
  '@type'?: string
  reason?: string
  metadata?: {
    service?: string
    serviceTitle?: string
    activationUrl?: string
    consumer?: string
    containerInfo?: string
    permission?: string
    resource?: string
  }
  links?: { url?: string }[]
}

// Some 403 responses don't echo the permission in ErrorInfo.metadata —
// it only appears in the human-readable message like:
//   "Permission 'run.services.list' denied on resource '...'."
function permissionFromMessage(message: string): string | undefined {
  const m = /Permission ['"]([\w.]+)['"] denied/i.exec(message)

  return m?.[1]
}

function parseGcpError(status: number, body: string): GcpUpstreamError {
  let parsed: { error?: { message?: string; details?: GcpErrorDetail[] } } | undefined

  try {
    parsed = JSON.parse(body)
  } catch {
    // non-JSON body — fall through with rawMessage = body
  }
  const inner = parsed?.error
  const upstreamMessage = inner?.message?.trim() || body.trim() || `HTTP ${String(status)}`
  const details = Array.isArray(inner?.details) ? inner!.details! : []
  const errorInfo = details.find((d) => (d['@type'] ?? '').endsWith('ErrorInfo'))
  const help = details.find((d) => (d['@type'] ?? '').endsWith('Help'))

  const reason = errorInfo?.reason
  const meta = errorInfo?.metadata ?? {}
  const service = meta.service
  const serviceTitle = meta.serviceTitle
  const activationUrl = meta.activationUrl ?? help?.links?.[0]?.url
  const project =
    meta.containerInfo ?? (meta.consumer ? meta.consumer.replace(/^projects\//, '') : undefined)
  const permission = meta.permission ?? permissionFromMessage(upstreamMessage)
  const resource = meta.resource

  let message = upstreamMessage

  if (reason === 'SERVICE_DISABLED') {
    const svc = serviceTitle ?? service ?? 'Google Cloud API'

    message = project ? `${svc} is not enabled in project ${project}.` : `${svc} is not enabled.`
  } else if (reason === 'IAM_PERMISSION_DENIED' || (status === 403 && !reason)) {
    const perm = permission ? ` (missing ${permission})` : ''

    message = project
      ? `Permission denied when calling the Cloud Run API in project ${project}${perm}.`
      : `Permission denied when calling the Cloud Run API${perm}.`
  } else if (status === 404) {
    message = upstreamMessage
  }

  return Object.assign(new Error(message), {
    code: status === 404 ? 5 : status,
    upstreamStatus: status,
    reason,
    service,
    serviceTitle,
    activationUrl,
    project,
    permission,
    resource,
    rawBody: body,
  })
}

export async function gcpFetch(handle: GcpHandle, url: string): Promise<unknown> {
  const impersonated = await impersonateSa(handle.serviceAccountEmail, handle.teamId)
  const tokenResp = await impersonated.getAccessToken()

  if (!tokenResp.token) throw new Error('Failed to mint impersonated access token')
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${tokenResp.token}` },
    signal: AbortSignal.timeout(GCP_FETCH_TIMEOUT_MS),
  })

  if (!resp.ok) {
    const body = await resp.text().catch(() => '')

    throw parseGcpError(resp.status, body)
  }

  return resp.json()
}

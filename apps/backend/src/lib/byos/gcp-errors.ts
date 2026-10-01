export type GcpServiceDisabled = {
  service: string
  serviceTitle: string
  project: string
  activationUrl: string
  enableCommand: string
}

type GaxLikeError = {
  reason?: unknown
  errorInfoMetadata?: unknown
  message?: unknown
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

function errorInfoMetadata(e: GaxLikeError): Record<string, string> {
  const meta = e.errorInfoMetadata

  if (!meta || typeof meta !== 'object') return {}
  const out: Record<string, string> = {}

  for (const [k, v] of Object.entries(meta as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v
  }

  return out
}

// Only consulted when Google sent no ErrorInfo at all, so a tagged IAM denial
// can never reach it.
const DISABLED_TEXT =
  /\bSERVICE_DISABLED\b|\baccessNotConfigured\b|has not been used in project .*? before or it is disabled/i

/**
 * gRPC code 7 / HTTP 403 covers both a real IAM denial and an API that is
 * simply off on the project. `google.rpc.ErrorInfo` — which google-gax promotes
 * onto the error as `reason` / `errorInfoMetadata` on both the gRPC and the
 * REST-fallback transport — is what tells them apart.
 */
export function gcpServiceDisabledInfo(
  e: unknown,
  fallback: { service: string; serviceTitle: string; projectId: string },
): GcpServiceDisabled | null {
  if (!e || typeof e !== 'object') return null
  const err = e as GaxLikeError
  const reason = str(err.reason)
  const message = str(err.message) ?? ''

  const disabled = reason ? reason === 'SERVICE_DISABLED' : DISABLED_TEXT.test(message)

  if (!disabled) return null

  const meta = errorInfoMetadata(err)
  const service = meta.service ?? fallback.service
  const serviceTitle = meta.serviceTitle ?? fallback.serviceTitle
  const project =
    meta.containerInfo ?? meta.consumer?.replace(/^projects\//, '') ?? fallback.projectId

  return {
    service,
    serviceTitle,
    project,
    activationUrl:
      meta.activationUrl ??
      `https://console.developers.google.com/apis/api/${service}/overview?project=${encodeURIComponent(project)}`,
    enableCommand: `gcloud services enable ${service} --project=${project}`,
  }
}

import { ExternalLink, RotateCcw, Sparkles } from 'lucide-react'

import { api } from '../../api'
import { useReportVisibleError } from '../../components/VisibleErrorReporter'

import { ErrorBlock } from './ErrorBlock'

import type { AtlasError } from '../../api'

export function CloudRunErrorBlock({
  error,
  onRetry,
  onFixInChat,
}: {
  error: AtlasError
  onRetry: () => void
  /** Shown only when the Nuphos agent can self-grant IAM in this project. */
  onFixInChat?: () => void
}) {
  useReportVisibleError(error.message, 'cloud_run_error_block')

  const details = (error.details ?? {}) as {
    activationUrl?: string
    project?: string
    serviceTitle?: string
    service?: string
    serviceAccountEmail?: string
    permission?: string
    resource?: string
  }
  const apiDisabled = error.code === 'cloud_run_api_disabled'
  const permDenied = error.code === 'cloud_run_permission_denied'

  if (!apiDisabled && !permDenied) return <ErrorBlock message={error.message} />

  const title = apiDisabled
    ? `${details.serviceTitle ?? 'Cloud Run Admin API'} is not enabled`
    : 'Cloud Run access denied'
  const body = apiDisabled
    ? details.project
      ? `Enable the API in project ${details.project} to list Cloud Run services.`
      : 'Enable the API to list Cloud Run services.'
    : details.permission
      ? `The bound service account is missing the ${details.permission} permission on run.googleapis.com. Grant roles/run.viewer (or another role that includes ${details.permission}) and retry.`
      : 'The bound service account does not have permission to call run.googleapis.com. Grant roles/run.viewer (or equivalent) and retry.'

  const iamUrl =
    permDenied && details.project
      ? `https://console.cloud.google.com/iam-admin/iam?project=${encodeURIComponent(details.project)}`
      : null

  return (
    <div className="p-8 flex flex-col items-start gap-3 text-[13px] max-w-[640px]">
      <div className="text-error font-medium">{title}</div>
      <div className="text-secondary">{body}</div>
      {(details.serviceAccountEmail || details.resource) && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
          {details.serviceAccountEmail && (
            <>
              <dt className="text-tertiary">Service account</dt>
              <dd className="font-mono text-secondary break-all">{details.serviceAccountEmail}</dd>
            </>
          )}
          {details.resource && (
            <>
              <dt className="text-tertiary">Resource</dt>
              <dd className="font-mono text-secondary break-all">{details.resource}</dd>
            </>
          )}
        </dl>
      )}
      <div className="flex items-center gap-2 mt-1 flex-wrap">
        {apiDisabled && details.activationUrl && (
          <button
            onClick={() => void api.appOpenExternal(details.activationUrl!).catch(() => {})}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-zViolet-accent/15 text-zViolet-accent hover:bg-zViolet-accent/25 text-[12px]"
          >
            <ExternalLink className="w-3.5 h-3.5" strokeWidth={1.8} />
            Enable in Google Cloud Console
          </button>
        )}
        {iamUrl && (
          <button
            onClick={() => void api.appOpenExternal(iamUrl).catch(() => {})}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-zViolet-accent/15 text-zViolet-accent hover:bg-zViolet-accent/25 text-[12px]"
          >
            <ExternalLink className="w-3.5 h-3.5" strokeWidth={1.8} />
            Open IAM in Google Cloud Console
          </button>
        )}
        {onFixInChat && (
          <button
            onClick={onFixInChat}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-zViolet-accent text-white hover:bg-zViolet-accent/85 text-[12px]"
            title={
              apiDisabled
                ? 'Ask the Nuphos agent to enable the API'
                : 'Ask the Nuphos agent to grant the missing role'
            }
          >
            <Sparkles className="w-3.5 h-3.5" strokeWidth={1.8} />
            Fix with Agent
          </button>
        )}
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-zGray-800 text-main hover:bg-zGray-700 text-[12px]"
        >
          <RotateCcw className="w-3.5 h-3.5" strokeWidth={1.8} />
          Retry
        </button>
      </div>
    </div>
  )
}

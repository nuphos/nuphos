import { AlertTriangle, ExternalLink, Sparkles } from 'lucide-react'

import { api, parseAtlasError } from '../../api'
import { useReportVisibleError } from '../../components/VisibleErrorReporter'
import { useWorkspaceRowLink } from '../../lib/workspaceRowLink'

export function ErrorBlock({ message }: { message: string }) {
  const { openInChat } = useWorkspaceRowLink()
  const error = parseAtlasError(message)

  useReportVisibleError(error.message, 'cloud_error_block')
  const details =
    error.details && typeof error.details === 'object'
      ? (error.details as {
          provider?: string
          operation?: string
          regions?: string[]
          upstreamMessage?: string
          serviceTitle?: string
          project?: string
          activationUrl?: string
          enableCommand?: string
        })
      : null

  if (error.code === 'gcp_api_disabled') {
    return (
      <div className="flex min-h-full items-start px-6 py-8">
        <div className="flex max-w-2xl items-start gap-3 border-l-2 border-error/70 bg-error/5 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-error" strokeWidth={2} />
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-main">
              {details?.serviceTitle ?? 'A Google Cloud API'} is not enabled
              {details?.project ? ` in ${details.project}` : ''}
            </div>
            <div className="mt-1 text-[12.5px] leading-relaxed text-secondary">
              This is not a missing IAM role — the API is turned off on the project.
            </div>
            {details?.enableCommand && (
              <div className="mt-2 overflow-x-auto rounded bg-black/20 px-2 py-1.5 font-mono text-[11.5px] text-secondary scrollbar-thin">
                {details.enableCommand}
              </div>
            )}
            {details?.upstreamMessage && (
              <div className="mt-2 max-h-24 overflow-auto font-mono text-[11.5px] leading-relaxed text-tertiary scrollbar-thin">
                {details.upstreamMessage}
              </div>
            )}
            {details?.activationUrl && (
              <button
                type="button"
                onClick={() => void api.appOpenExternal(details.activationUrl!).catch(() => {})}
                className="mt-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-zViolet-accent/15 text-zViolet-accent hover:bg-zViolet-accent/25 text-[12px]"
              >
                <ExternalLink className="w-3.5 h-3.5" strokeWidth={1.8} />
                Enable in Google Cloud Console
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  const permissionDenied =
    error.code === 'aws_role_permission_denied' ||
    error.code === 'gcp_service_account_permission_denied' ||
    error.code === 'cloud_run_permission_denied' ||
    /access denied|not authorized|permission/i.test(error.message)

  if (permissionDenied) {
    const credentialLabel =
      details?.provider === 'aws'
        ? 'AWS role'
        : details?.provider === 'gcp'
          ? 'GCP service account'
          : 'credential'
    const fixWithAgent = () => {
      const prompt = [
        `The Nuphos-bound ${credentialLabel} hit a permission error: ${error.message}`,
        details?.operation ? `Missing or blocked operation: \`${details.operation}\`.` : null,
        details?.regions && details.regions.length > 0
          ? `Regions checked: ${details.regions.join(', ')}.`
          : null,
        details?.upstreamMessage ? `Upstream error: ${details.upstreamMessage}` : null,
        'Please diagnose and fix the missing permission so Nuphos can perform this operation, then verify it works.',
      ]
        .filter(Boolean)
        .join(' ')

      openInChat(prompt)
    }

    return (
      <div className="flex min-h-full items-start px-6 py-8">
        <div className="flex max-w-2xl items-start gap-3 border-l-2 border-error/70 bg-error/5 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-error" strokeWidth={2} />
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-main">
              Selected credential does not have permission
            </div>
            <div className="mt-1 text-[12.5px] leading-relaxed text-secondary">{error.message}</div>
            {details?.operation && (
              <div className="mt-2 text-[12px] text-tertiary">
                Missing or blocked operation:{' '}
                <span className="font-mono text-secondary">{details.operation}</span>
              </div>
            )}
            {details?.regions && details.regions.length > 0 && (
              <div className="mt-1 text-[12px] text-tertiary">
                Checked regions:{' '}
                <span className="font-mono text-secondary">{details.regions.join(', ')}</span>
              </div>
            )}
            {details?.upstreamMessage && (
              <div className="mt-2 max-h-24 overflow-auto font-mono text-[11.5px] leading-relaxed text-tertiary scrollbar-thin">
                {details.upstreamMessage}
              </div>
            )}
            <button
              type="button"
              onClick={fixWithAgent}
              className="mt-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-zViolet-accent text-white hover:bg-zViolet-accent/85 text-[12px]"
              title="Seed the agent chat with this permission error"
            >
              <Sparkles className="w-3.5 h-3.5" strokeWidth={1.8} />
              Fix with Agent
            </button>
          </div>
        </div>
      </div>
    )
  }

  return <div className="p-8 text-error text-[13px]">{error.message}</div>
}

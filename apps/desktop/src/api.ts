import { agentApi } from './api/agent-api.ts'
import { appApi } from './api/app-api.ts'
import { channelsApi } from './api/channels-api.ts'
import { awsApi } from './api/aws-api.ts'
import { browserExtensionsApi } from './api/browser-extensions-api.ts'
import { cloudflareApi } from './api/cloudflare-api.ts'
import { cloudflarePagesApi } from './api/cloudflare-pages-api.ts'
import { databaseApi } from './api/database-api.ts'
import { deviceApi } from './api/device-api.ts'
import { isAccountGone, isNetworkError, isSessionRejected, parseAtlasError } from './api/errors.ts'
import { gcpClustersApi } from './api/gcp-clusters-api.ts'
import { gitApi } from './api/git-api.ts'
import { instructionsApi } from './api/instructions-api.ts'
import { integrationsApi } from './api/integrations-api.ts'
import { k8sApi } from './api/k8s-api.ts'
import { monitoringApi } from './api/monitoring-api.ts'
import { plaudApi } from './api/plaud-api.ts'
import { posthogApi } from './api/posthog-api.ts'
import { providerAccessApi } from './api/provider-access-api.ts'
import { shellApi } from './api/shell-api.ts'
import { teamApi } from './api/team-api.ts'
import { reportFrontendError } from './lib/frontendErrorReporter.ts'
import { instrumentApi } from './lib/instrumentApi.ts'

import type { WindowAgentApi } from './api/window-agent.ts'
import type { WindowAppApi } from './api/window-app.ts'
import type { WindowChannelsApi } from './api/window-channels.ts'
import type { WindowAwsApi } from './api/window-aws.ts'
import type { WindowBrowserExtensionsApi } from './api/window-browser-extensions.ts'
import type { WindowCloudflarePagesApi } from './api/window-cloudflare-pages.ts'
import type { WindowCloudflareApi } from './api/window-cloudflare.ts'
import type { WindowDatabaseApi } from './api/window-database.ts'
import type { WindowDeviceApi } from './api/window-device.ts'
import type { WindowGcpClustersApi } from './api/window-gcp-clusters.ts'
import type { WindowGitApi } from './api/window-git.ts'
import type { WindowInstructionsApi } from './api/window-instructions.ts'
import type { WindowIntegrationsApi } from './api/window-integrations.ts'
import type { WindowK8sApi } from './api/window-k8s.ts'
import type { WindowMonitoringApi } from './api/window-monitoring.ts'
import type { WindowPlaudApi } from './api/window-plaud.ts'
import type { WindowPosthogApi } from './api/window-posthog.ts'
import type { WindowProviderAccessApi } from './api/window-provider-access.ts'
import type { WindowSessionAccessApi } from './api/window-session-access.ts'
import type { WindowShellApi } from './api/window-shell.ts'
import type { WindowTeamApi } from './api/window-team.ts'

export * from './api/agent-audit-types.ts'
export * from './api/agent-trigger-types.ts'
export * from './api/agent-types.ts'
export * from './api/app-types.ts'
export * from './api/device-types.ts'
export * from './api/errors.ts'
export * from './api/plan-types.ts'
export * from './api/watch-types.ts'

declare global {
  // Augmenting the DOM's `Window` is declaration merging, which only interfaces
  // do — a type alias here is a redeclaration error, and the rule ships no
  // autofix for this shape for that reason.
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface Window {
    api: WindowK8sApi &
      WindowAppApi &
      WindowTeamApi &
      WindowCloudflareApi &
      WindowCloudflarePagesApi &
      WindowProviderAccessApi &
      WindowDatabaseApi &
      WindowMonitoringApi &
      WindowIntegrationsApi &
      WindowPosthogApi &
      WindowPlaudApi &
      WindowSessionAccessApi &
      WindowChannelsApi &
      WindowAwsApi &
      WindowGcpClustersApi &
      WindowGitApi &
      WindowAgentApi &
      WindowShellApi &
      WindowInstructionsApi &
      WindowDeviceApi &
      WindowBrowserExtensionsApi
  }
}

const rawApi = {
  ...k8sApi,
  ...appApi,
  ...teamApi,
  ...cloudflareApi,
  ...cloudflarePagesApi,
  ...providerAccessApi,
  ...databaseApi,
  ...monitoringApi,
  ...integrationsApi,
  ...posthogApi,
  ...plaudApi,
  ...awsApi,
  ...gcpClustersApi,
  ...gitApi,
  ...agentApi,
  ...channelsApi,
  ...shellApi,
  ...instructionsApi,
  ...deviceApi,
  ...browserExtensionsApi,
}

let sessionRejected: (() => void) | null = null

/** Called once when any API call reports that the stored session is no longer
 * accepted (expired or revoked). The app signs out; no retry can succeed. */
export function onSessionRejected(handler: (() => void) | null): void {
  sessionRejected = handler
}

export const api = instrumentApi(
  rawApi,
  (operation, error) => {
    // Offline, asleep, or backend unreachable: the user's connectivity, not an
    // app defect. Every poll would report it again, so it never reaches Error
    // Tracking; backend availability is watched server-side. A request cut off
    // by a sign-out or account switch is not a failure either.
    if (isNetworkError(error) || isAccountGone(error)) return
    if (isSessionRejected(error)) {
      const handler = sessionRejected

      sessionRejected = null
      handler?.()

      return
    }
    const parsed = parseAtlasError(error)

    // A file transfer is deleted a day after upload, so every view of an older
    // message resolves a group that is gone; its callers show it as expired.
    if (parsed.code === 'transfer_not_found' || parsed.code === 'transfer_expired') return

    reportFrontendError(
      {
        source: 'api',
        phase: operation,
        message: parsed.message,
        errorCode: parsed.code ?? null,
        apiOperation: operation,
      },
      error,
    )
  },
  {
    stallAfterMs: 30_000,
    observeStall: (operation, elapsedMs, error) => {
      // A call that ends offline is the user's connectivity, like the failure
      // itself; sign-in waits on the user in the browser, so its time is not ours.
      if (operation === 'authLogin' || isNetworkError(error)) return
      reportFrontendError({
        source: 'api',
        phase: `${operation}_stalled`,
        message: `${operation} took ${String(Math.round(elapsedMs / 1000))} seconds to settle.`,
        apiOperation: operation,
        elapsedMs,
      })
    },
  },
)

import { agentApi } from './api/agent-api.ts'
import { appApi } from './api/app-api.ts'
import { awsApi } from './api/aws-api.ts'
import { cloudflareApi } from './api/cloudflare-api.ts'
import { cloudflarePagesApi } from './api/cloudflare-pages-api.ts'
import { databaseApi } from './api/database-api.ts'
import { deviceApi } from './api/device-api.ts'
import { apiErrorPhase, parseAtlasError } from './api/errors.ts'
import { gcpClustersApi } from './api/gcp-clusters-api.ts'
import { gitApi } from './api/git-api.ts'
import { instructionsApi } from './api/instructions-api.ts'
import { integrationsApi } from './api/integrations-api.ts'
import { k8sApi } from './api/k8s-api.ts'
import { monitoringApi } from './api/monitoring-api.ts'
import { posthogApi } from './api/posthog-api.ts'
import { providerAccessApi } from './api/provider-access-api.ts'
import { shellApi } from './api/shell-api.ts'
import { teamApi } from './api/team-api.ts'
import { reportFrontendError } from './lib/frontendErrorReporter.ts'
import { instrumentApi } from './lib/instrumentApi.ts'

import type { WindowAgentApi } from './api/window-agent.ts'
import type { WindowAppApi } from './api/window-app.ts'
import type { WindowAwsApi } from './api/window-aws.ts'
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
      WindowSessionAccessApi &
      WindowAwsApi &
      WindowGcpClustersApi &
      WindowGitApi &
      WindowAgentApi &
      WindowShellApi &
      WindowInstructionsApi &
      WindowDeviceApi
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
  ...awsApi,
  ...gcpClustersApi,
  ...gitApi,
  ...agentApi,
  ...shellApi,
  ...instructionsApi,
  ...deviceApi,
}

export const api = instrumentApi(
  rawApi,
  (operation, error) => {
    const parsed = parseAtlasError(error)

    reportFrontendError(
      {
        source: 'api',
        phase: apiErrorPhase(operation, error),
        message: parsed.message,
        errorCode: parsed.code ?? null,
        apiOperation: operation,
      },
      error,
    )
  },
  {
    stallAfterMs: 30_000,
    observeStall: (operation, elapsedMs) => {
      reportFrontendError({
        source: 'api',
        phase: `${operation}_stalled`,
        message: `${operation} did not settle after ${String(elapsedMs / 1000)} seconds.`,
        apiOperation: operation,
        elapsedMs,
      })
    },
  },
)

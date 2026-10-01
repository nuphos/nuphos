// Read-only monitoring aggregation across the team's bound observability
// providers. This is a VIEW over provider APIs — no Nuphos storage, no
// reconciliation, no mutations.
//
// Per-provider failures degrade to an entry in `providerErrors` so one
// unreachable provider doesn't blank the page.

import { canUseAllowList } from '@/lib/byos/access'
import { teamByosBindings } from '@/models'

import { collectBetterStack } from './overview-betterstack'
import { collectGcp } from './overview-gcp'
import { collectGrafana } from './overview-grafana'

import type {
  MonitoringOverview,
  MonitoringOverviewRow,
  MonitoringProviderError,
} from './overview-types'
import type { ObjectId } from 'mongodb'

export type {
  MonitoringOverview,
  MonitoringOverviewRow,
  MonitoringProviderError,
} from './overview-types'

export async function aggregateMonitoringOverview(
  teamId: ObjectId,
  userId: string,
): Promise<MonitoringOverview> {
  const bindings = await teamByosBindings().findOne({ _id: teamId })
  const rows: MonitoringOverviewRow[] = []
  const providerErrors: MonitoringProviderError[] = []

  const tasks: Promise<void>[] = []

  for (const integration of bindings?.betterStackIntegrations ?? []) {
    // Respect per-binding member allow-lists — the aggregation must not
    // become a side channel around the access control the dedicated
    // routes enforce.
    if (!canUseAllowList(integration.access?.memberAllowList, userId)) continue
    if (!integration.encryptedUptimeApiToken) continue
    const integrationId = integration.id.toHexString()
    const integrationLabel = integration.label

    tasks.push(
      collectBetterStack(
        integration.encryptedUptimeApiToken,
        integrationId,
        integrationLabel,
        integration.dashboardTeamId,
      )
        .then((r) => {
          rows.push(...r)
        })
        .catch((err: unknown) => {
          providerErrors.push({
            provider: 'betterstack',
            integrationId,
            integrationLabel,
            message: err instanceof Error ? err.message : String(err),
          })
        }),
    )
  }

  for (const instance of bindings?.grafanaInstances ?? []) {
    const integrationId = instance.id.toHexString()

    tasks.push(
      collectGrafana(instance.grafanaUrl, instance.saToken, integrationId, instance.name)
        .then((r) => {
          rows.push(...r)
        })
        .catch((err: unknown) => {
          providerErrors.push({
            provider: 'grafana',
            integrationId,
            integrationLabel: instance.name,
            message: err instanceof Error ? err.message : String(err),
          })
        }),
    )
  }

  for (const binding of bindings?.gcpServiceAccounts ?? []) {
    // Purpose-scoped bindings (permission-admin) exist for grant flows, not
    // resource browsing — querying them just produces a guaranteed 403 row.
    if (binding.purpose) continue
    if (!canUseAllowList(binding.access?.memberAllowList, userId)) continue
    const integrationId = binding.id.toHexString()
    const integrationLabel = binding.projectId

    tasks.push(
      collectGcp(
        binding.serviceAccountEmail,
        binding.projectId,
        integrationId,
        teamId.toHexString(),
      )
        .then((r) => {
          rows.push(...r)
        })
        .catch((err: unknown) => {
          providerErrors.push({
            provider: 'gcp',
            integrationId,
            integrationLabel,
            message: err instanceof Error ? err.message : String(err),
          })
        }),
    )
  }

  await Promise.all(tasks)

  // Stable order: down first (most actionable), then pending, then the rest;
  // alphabetical within a band so polling doesn't shuffle rows.
  const rank: Record<MonitoringOverviewRow['status'], number> = {
    down: 0,
    pending: 1,
    unknown: 2,
    paused: 3,
    up: 4,
  }

  rows.sort((a, b) => rank[a.status] - rank[b.status] || a.name.localeCompare(b.name))

  return { rows, providerErrors }
}

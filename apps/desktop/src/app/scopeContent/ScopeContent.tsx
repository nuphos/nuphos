import { useEffect } from 'react'

import { toast } from '../../components/ui/toast'
import { useClusterAccessProbe } from '../../hooks/useClusterAccessProbe'
import { isDatabaseEngineReleased } from '../../lib/databaseRelease'
import { selectedAwsRoleId, selectedGcpServiceAccountId } from '../accountScopes'
import { activeNavItemFor } from '../navItems'
import { PageMeta } from '../pageMeta'

import { renderAwsComputePages } from './awsComputePages'
import { renderAwsIamStoragePages } from './awsIamStoragePages'
import { renderAwsObservabilityPages } from './awsObservabilityPages'
import { renderCloudflarePages } from './cloudflarePages'
import { renderClusterGatePages } from './clusterGatePages'
import { renderClusterResourcePages } from './clusterResourcePages'
import { renderClusterStoragePages } from './clusterStoragePages'
import { renderClusterWorkloadPages } from './clusterWorkloadPages'
import { renderGcpPages } from './gcpPages'
import { renderIntegrationPages } from './integrationPages'
import { renderProviderAccountPages } from './providerAccountPages'
import { renderSshTerminalPage } from './sshTerminalPage'
import { renderTeamHomePages } from './teamHomePages'
import { renderTeamPages } from './teamPages'
import { renderTeamToolPages } from './teamToolPages'

import type { ScopeContentProps, ScopeRenderContext, ScopeSectionRenderer } from './context'

const SECTION_RENDERERS: ScopeSectionRenderer[] = [
  renderSshTerminalPage,
  renderTeamPages,
  renderTeamToolPages,
  renderTeamHomePages,
  renderAwsComputePages,
  renderAwsObservabilityPages,
  renderAwsIamStoragePages,
  renderGcpPages,
  renderCloudflarePages,
  renderProviderAccountPages,
  renderIntegrationPages,
  renderClusterGatePages,
  renderClusterWorkloadPages,
  renderClusterResourcePages,
  renderClusterStoragePages,
]

export function ScopeContent(props: ScopeContentProps) {
  const {
    scope,
    active,
    kubeconfigContext,
    databaseConnections,
    grafanaInstance,
    sshTerminal,
    accounts,
    onSelectActive,
    onExitToConnectors,
  } = props
  // Probe in-cluster access once per resolved kubeconfig context. When the
  // identity is authenticated but has NO in-cluster RBAC (every list call
  // 403s — e.g. a VKE role the cluster creator hasn't authorized yet), the
  // cluster routes below render a guided authorization mask instead of raw
  // 403 JSON and empty tables.
  const clusterAccess = useClusterAccessProbe(scope.kind === 'cluster' ? kubeconfigContext : null)
  const scopedDatabaseConnection =
    scope.kind === 'database-connection' && databaseConnections
      ? databaseConnections.find((connection) => connection.id === scope.connectionId)
      : undefined

  // If we land on the dashboards route without a picked instance (e.g. after a
  // hard reload), bounce the user back to the picker. Done in an effect to
  // avoid mutating Workspace state while ScopeContent is rendering.
  useEffect(() => {
    if (sshTerminal) return
    if (scope.kind === 'aws-account' && active === 'aws.iam') {
      onSelectActive('aws.roles')

      return
    }
    if (
      (active === 'observability.dashboards' ||
        active === 'observability.alerts' ||
        active === 'observability.datasources') &&
      !grafanaInstance
    ) {
      onSelectActive('team.observability')
    }
  }, [active, grafanaInstance, onSelectActive, scope.kind, sshTerminal])

  // Deep links and restored tabs can outlive a release gate. Do not mount an
  // unreleased database engine's detail view even when the connection remains
  // present in backend data.
  useEffect(() => {
    if (scope.kind !== 'database-connection' || databaseConnections === undefined) {
      return
    }
    if (scopedDatabaseConnection && isDatabaseEngineReleased(scopedDatabaseConnection.engine)) {
      return
    }
    toast.error(
      scopedDatabaseConnection ? 'Database engine unavailable' : 'Database unavailable',
      scopedDatabaseConnection
        ? 'This database engine is not available in the current release.'
        : 'This database connection no longer exists or is unavailable.',
    )
    onExitToConnectors()
  }, [databaseConnections, onExitToConnectors, scope.kind, scopedDatabaseConnection])

  const activeNavItem = activeNavItemFor(scope, active)
  const renderPage = (
    pageKey: string,
    title: string,
    icon: React.ReactNode,
    content: React.ReactNode,
  ) => (
    <PageMeta pageKey={pageKey} title={title} icon={icon}>
      {content}
    </PageMeta>
  )
  const renderActiveNavPage = (
    fallbackTitle: string,
    fallbackIcon: React.ReactNode,
    content: React.ReactNode,
  ) =>
    renderPage(
      active,
      activeNavItem?.label ?? fallbackTitle,
      activeNavItem?.icon ?? fallbackIcon,
      content,
    )

  const ctx: ScopeRenderContext = {
    ...props,
    renderPage,
    renderActiveNavPage,
    clusterAccess,
    scopedDatabaseConnection,
    awsRoleId: selectedAwsRoleId(scope, accounts),
    gcpServiceAccountId: selectedGcpServiceAccountId(scope, accounts),
  }

  for (const renderSection of SECTION_RENDERERS) {
    const rendered = renderSection(ctx)

    if (rendered !== undefined) return rendered
  }

  return null
}

import {
  faDatabase,
  faGaugeHigh,
  faServer,
  faTableColumns,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { Container, FolderTree, Server, ShieldAlert } from 'lucide-react'

import { api } from '../../api'
import {
  BetterStackIntegrationView,
  ComplianceIntegrationView,
  UptimeKumaInstanceView,
} from '../../views/CloudViews'
import {
  EcsInfrastructureView,
  EcsMetricsView,
  EcsServicesView,
  EcsTasksView,
} from '../../views/EcsClusterViews'
import { TailscaleDevicesView } from '../../views/TailscaleViews'
import { ZeaburProjectsView, ZeaburServersView } from '../../views/ZeaburViews'

import type { ScopeRenderContext } from './context'

export function renderIntegrationPages(ctx: ScopeRenderContext): React.ReactNode | undefined {
  const { scope, active, filter, refreshKey, accounts, onCount, onLoading, renderActiveNavPage } =
    ctx

  if (scope.kind === 'betterstack-integration') {
    const integration = accounts?.betterstack.find((item) => item.id === scope.integrationId)
    const betterStackPage =
      active === 'betterstack.incidents'
        ? 'incidents'
        : active === 'betterstack.sources'
          ? 'sources'
          : active === 'betterstack.dashboards'
            ? 'dashboards'
            : 'monitors'
    const betterStackMeta = {
      monitors: { title: 'Monitors', icon: faGaugeHigh },
      incidents: { title: 'Incidents', icon: faTriangleExclamation },
      sources: { title: 'Sources', icon: faDatabase },
      dashboards: { title: 'Dashboards', icon: faTableColumns },
    }[betterStackPage]

    return renderActiveNavPage(
      betterStackMeta.title,
      <FontAwesomeIcon icon={betterStackMeta.icon} className="w-3.5 h-3.5 text-tertiary" />,
      <BetterStackIntegrationView
        teamId={scope.teamId}
        integration={integration}
        page={betterStackPage}
        filter={filter}
        refreshKey={refreshKey}
        onCount={onCount}
        onLoading={onLoading}
      />,
    )
  }

  if (scope.kind === 'uptime-kuma-instance') {
    const instance = accounts?.uptimeKuma.find((item) => item.id === scope.instanceId)

    return renderActiveNavPage(
      'Monitors',
      <FontAwesomeIcon icon={faGaugeHigh} className="w-3.5 h-3.5 text-tertiary" />,
      <UptimeKumaInstanceView
        teamId={scope.teamId}
        instance={instance}
        filter={filter}
        refreshKey={refreshKey}
        onCount={onCount}
        onLoading={onLoading}
      />,
    )
  }

  if (scope.kind === 'compliance-integration') {
    const list = scope.provider === 'vanta' ? accounts?.vanta : accounts?.secureframe
    // Treat "accounts not loaded yet" as still-loading rather than not-found, so
    // navigating into this scope doesn't flash "integration not found" before the
    // team's account list resolves.
    const found =
      accounts === undefined || Boolean(list?.some((item) => item.id === scope.integrationId))

    return renderActiveNavPage(
      'Failed Tests',
      <ShieldAlert className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <ComplianceIntegrationView
        teamId={scope.teamId}
        provider={scope.provider}
        integrationId={scope.integrationId}
        found={found}
        filter={filter}
        refreshKey={refreshKey}
        onCount={onCount}
        onLoading={onLoading}
      />,
    )
  }

  if (scope.kind === 'tailscale-client') {
    return renderActiveNavPage(
      'Devices',
      <FontAwesomeIcon icon={faServer} className="w-3.5 h-3.5 text-tertiary" />,
      <TailscaleDevicesView
        teamId={scope.teamId}
        clientId={scope.clientId}
        filter={filter}
        refreshKey={refreshKey}
        onCount={onCount}
        onLoading={onLoading}
      />,
    )
  }

  if (scope.kind === 'zeabur-provider') {
    if (active === 'zeabur.servers') {
      return renderActiveNavPage(
        'Servers',
        <Server className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
        <ZeaburServersView
          teamId={scope.teamId}
          zeaburId={scope.zeaburId}
          filter={filter}
          refreshKey={refreshKey}
          onCount={onCount}
          onLoading={onLoading}
        />,
      )
    }

    return renderActiveNavPage(
      'Projects',
      <FolderTree className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <ZeaburProjectsView
        teamId={scope.teamId}
        zeaburId={scope.zeaburId}
        filter={filter}
        refreshKey={refreshKey}
        onCount={onCount}
        onLoading={onLoading}
      />,
    )
  }

  if (scope.kind === 'aws-ecs-cluster') {
    if (active === 'ecs.tasks') {
      return renderActiveNavPage(
        scope.clusterName,
        <Container className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
        <EcsTasksView
          loader={(status) =>
            api.atlasListAwsEcsTasks(
              scope.teamId,
              scope.accountId,
              scope.region,
              scope.clusterName,
              status,
              scope.roleId,
            )
          }
          filter={filter}
          refreshKey={refreshKey}
          onCount={onCount}
          onLoading={onLoading}
        />,
      )
    }
    if (active === 'ecs.infrastructure') {
      return renderActiveNavPage(
        scope.clusterName,
        <Container className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
        <EcsInfrastructureView
          loader={() =>
            api.atlasListAwsEcsContainerInstances(
              scope.teamId,
              scope.accountId,
              scope.region,
              scope.clusterName,
              scope.roleId,
            )
          }
          capacityProviders={scope.capacityProviders ?? []}
          filter={filter}
          refreshKey={refreshKey}
          onCount={onCount}
          onLoading={onLoading}
        />,
      )
    }
    if (active === 'ecs.metrics') {
      return renderActiveNavPage(
        scope.clusterName,
        <Container className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
        <EcsMetricsView
          loader={(m) =>
            api.atlasGetAwsEcsClusterMetrics(
              scope.teamId,
              scope.accountId,
              scope.region,
              scope.clusterName,
              m,
              scope.roleId,
            )
          }
          refreshKey={refreshKey}
          onCount={onCount}
          onLoading={onLoading}
        />,
      )
    }

    return renderActiveNavPage(
      scope.clusterName,
      <Container className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <EcsServicesView
        loader={() =>
          api.atlasListAwsEcsServices(
            scope.teamId,
            scope.accountId,
            scope.region,
            scope.clusterName,
            scope.roleId,
          )
        }
        filter={filter}
        refreshKey={refreshKey}
        onCount={onCount}
        onLoading={onLoading}
      />,
    )
  }

  return undefined
}

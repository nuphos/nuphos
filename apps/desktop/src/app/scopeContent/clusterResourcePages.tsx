import { Cloud, FolderTree } from 'lucide-react'

import { t } from '../../i18n'
import { ConfigMapsView } from '../../views/ConfigMapsView'
import { EndpointSlicesView } from '../../views/EndpointSlicesView'
import { IngressesView } from '../../views/IngressesView'
import {
  ClusterRoleBindingsView,
  ClusterRolesView,
  NetworkPoliciesView,
  RoleBindingsView,
  RolesView,
  ServiceAccountsView,
} from '../../views/K8sAdditionalResourceViews'
import { SecretsView } from '../../views/SecretsView'
import { ServicesView } from '../../views/ServicesView'

import type { ScopeRenderContext } from './context'

export function renderClusterResourcePages(ctx: ScopeRenderContext): React.ReactNode | undefined {
  const {
    scope,
    active,
    filter,
    refreshKey,
    namespace,
    setTarget,
    onCount,
    onLoading,
    renderActiveNavPage,
  } = ctx

  if (scope.kind !== 'cluster') return undefined

  if (active === 'networking.services') {
    return renderActiveNavPage(
      t('Services'),
      <Cloud className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <ServicesView
        namespace={namespace}
        filter={filter}
        refreshKey={refreshKey}
        onSelect={(s) => setTarget({ kind: 'Service', namespace: s.namespace, name: s.name })}
        onCount={onCount}
        onLoading={onLoading}
      />,
    )
  }
  if (active === 'networking.network-policies') {
    return renderActiveNavPage(
      t('Network Policies'),
      <Cloud className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <NetworkPoliciesView
        namespace={namespace}
        filter={filter}
        refreshKey={refreshKey}
        onSelect={(n) => setTarget({ kind: 'NetworkPolicy', namespace: n.namespace, name: n.name })}
        onCount={onCount}
        onLoading={onLoading}
      />,
    )
  }
  if (active === 'networking.ingresses') {
    return renderActiveNavPage(
      t('Ingresses'),
      <Cloud className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <IngressesView
        namespace={namespace}
        filter={filter}
        refreshKey={refreshKey}
        onSelect={(i) => setTarget({ kind: 'Ingress', namespace: i.namespace, name: i.name })}
        onCount={onCount}
        onLoading={onLoading}
      />,
    )
  }
  if (active === 'networking.endpoint-slices') {
    return renderActiveNavPage(
      t('Endpoint Slices'),
      <Cloud className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <EndpointSlicesView
        namespace={namespace}
        filter={filter}
        refreshKey={refreshKey}
        onSelect={(e) => setTarget({ kind: 'EndpointSlice', namespace: e.namespace, name: e.name })}
        onCount={onCount}
        onLoading={onLoading}
      />,
    )
  }
  if (active === 'config.configmaps') {
    return renderActiveNavPage(
      t('ConfigMaps'),
      <FolderTree className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <ConfigMapsView
        namespace={namespace}
        filter={filter}
        refreshKey={refreshKey}
        onSelect={(c) => setTarget({ kind: 'ConfigMap', namespace: c.namespace, name: c.name })}
        onCount={onCount}
        onLoading={onLoading}
      />,
    )
  }
  if (active === 'config.secrets') {
    return renderActiveNavPage(
      t('Secrets'),
      <FolderTree className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <SecretsView
        namespace={namespace}
        filter={filter}
        refreshKey={refreshKey}
        onSelect={(s) => setTarget({ kind: 'Secret', namespace: s.namespace, name: s.name })}
        onCount={onCount}
        onLoading={onLoading}
      />,
    )
  }
  if (active === 'access.service-accounts') {
    return renderActiveNavPage(
      t('Service Accounts'),
      <FolderTree className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <ServiceAccountsView
        namespace={namespace}
        filter={filter}
        refreshKey={refreshKey}
        onSelect={(s) =>
          setTarget({ kind: 'ServiceAccount', namespace: s.namespace, name: s.name })
        }
        onCount={onCount}
        onLoading={onLoading}
      />,
    )
  }
  if (active === 'access.roles') {
    return renderActiveNavPage(
      t('Roles'),
      <FolderTree className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <RolesView
        namespace={namespace}
        filter={filter}
        refreshKey={refreshKey}
        onSelect={(r) => setTarget({ kind: 'Role', namespace: r.namespace, name: r.name })}
        onCount={onCount}
        onLoading={onLoading}
      />,
    )
  }
  if (active === 'access.role-bindings') {
    return renderActiveNavPage(
      t('Role Bindings'),
      <FolderTree className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <RoleBindingsView
        namespace={namespace}
        filter={filter}
        refreshKey={refreshKey}
        onSelect={(r) => setTarget({ kind: 'RoleBinding', namespace: r.namespace, name: r.name })}
        onCount={onCount}
        onLoading={onLoading}
      />,
    )
  }
  if (active === 'access.cluster-roles') {
    return renderActiveNavPage(
      t('Cluster Roles'),
      <FolderTree className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <ClusterRolesView
        filter={filter}
        refreshKey={refreshKey}
        onSelect={(r) => setTarget({ kind: 'ClusterRole', namespace: null, name: r.name })}
        onCount={onCount}
        onLoading={onLoading}
      />,
    )
  }
  if (active === 'access.cluster-role-bindings') {
    return renderActiveNavPage(
      t('Cluster Role Bindings'),
      <FolderTree className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <ClusterRoleBindingsView
        filter={filter}
        refreshKey={refreshKey}
        onSelect={(r) => setTarget({ kind: 'ClusterRoleBinding', namespace: null, name: r.name })}
        onCount={onCount}
        onLoading={onLoading}
      />,
    )
  }

  return undefined
}

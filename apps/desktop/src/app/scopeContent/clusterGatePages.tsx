import { FolderTree } from 'lucide-react'

import { k8sResourceIcon } from '../../app/navItems'
import { ClusterRbacNotice, ClusterUnreachableNotice } from '../../components/ClusterRbacGate'
import { toast } from '../../components/ui/toast'
import { DetailView } from '../../views/DetailView'

import type { ScopeRenderContext } from './context'

export function renderClusterGatePages(ctx: ScopeRenderContext): React.ReactNode | undefined {
  const {
    scope,
    active,
    kubeconfigContext,
    kubeconfigContextError,
    target,
    setTarget,
    refreshKey,
    refreshClusterKubeconfig,
    renderPage,
    renderActiveNavPage,
    clusterAccess,
  } = ctx

  if (scope.kind !== 'cluster') return undefined

  // cluster scope
  // Cluster-scoped pages require a resolved kubeconfig context. Until
  // `enterCluster` (or the history rehydration effect) has populated it,
  // render a placeholder rather than mounting any view that would throw on
  // `useRequiredKubeContext`.
  if (!kubeconfigContext) {
    if (kubeconfigContextError) {
      return renderActiveNavPage(
        'Cluster unavailable',
        <FolderTree className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
        <div className="p-8 text-center">
          <div className="text-error text-[13px] mb-2">Failed to connect to cluster</div>
          <div className="text-tertiary text-[12px] selectable">{kubeconfigContextError}</div>
          <div className="text-tertiary text-[12px] mt-3">
            Re-pick the cluster from the breadcrumb to retry.
          </div>
        </div>,
      )
    }

    return renderActiveNavPage(
      'Connecting…',
      <FolderTree className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <div className="p-8 text-center text-tertiary text-[13px]">Connecting to cluster…</div>,
    )
  }
  // Gate ALL cluster pages behind the access probe: authenticated-but-
  // unauthorized identities (no in-cluster RBAC) get one guided mask instead
  // of a different raw 403 on every page.
  if (clusterAccess.state === 'denied') {
    return renderActiveNavPage(
      'Cluster access required',
      <FolderTree className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <ClusterRbacNotice
        provider={scope.parentKind}
        teamId={scope.teamId}
        accountId={'parentId' in scope ? scope.parentId : undefined}
        region={'region' in scope ? scope.region : undefined}
        subject={clusterAccess.subject}
        onRetry={async () => {
          // Refresh the credential first: a grant made after connecting only
          // applies to newly issued kubeconfigs (VKE), and the new context
          // re-triggers the probe by itself. A failed refresh must be visible —
          // silently falling through would make a backend/network failure look
          // like "RBAC still not granted" — but the plain re-probe still runs
          // so the old context gets a chance too.
          try {
            await refreshClusterKubeconfig()
          } catch (e) {
            toast.apiError('Failed to refresh the cluster credential', e, {
              fallback: 'Check your connection and retry.',
            })
          }
          clusterAccess.retry()
        }}
      />,
    )
  }
  if (clusterAccess.state === 'unreachable') {
    return renderActiveNavPage(
      'Cluster unreachable',
      <FolderTree className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <ClusterUnreachableNotice
        provider={scope.parentKind}
        onRetry={async () => {
          // Same order as the RBAC mask: re-issue the credential first (it may
          // have expired while we were stuck), then re-probe.
          try {
            await refreshClusterKubeconfig()
          } catch (e) {
            toast.apiError('Failed to refresh the cluster credential', e, {
              fallback: 'Check your connection and retry.',
            })
          }
          clusterAccess.retry()
        }}
      />,
    )
  }
  if (clusterAccess.state === 'checking') {
    return renderActiveNavPage(
      'Connecting…',
      <FolderTree className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <div className="p-8 text-center text-tertiary text-[13px]">Checking cluster access…</div>,
    )
  }
  if (target) {
    return renderPage(
      `${active}.detail`,
      target.displayName ?? target.name,
      k8sResourceIcon(target.kind),
      <DetailView
        target={target}
        refreshKey={refreshKey}
        onClose={() => setTarget(null)}
        onNavigate={setTarget}
      />,
    )
  }

  return undefined
}

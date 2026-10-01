import { FolderTree } from 'lucide-react'

import { parseCustomResourceNavigationKey } from '../../lib/customResourceNavigation'
import {
  CustomResourceDefinitionsView,
  CustomResourcesView,
  PersistentVolumeClaimsView,
  PersistentVolumesView,
} from '../../views/K8sAdditionalResourceViews'
import { PodsView } from '../../views/PodsView'
import { StorageClassesView } from '../../views/StorageClassesView'

import type { ScopeRenderContext } from './context'

export function renderClusterStoragePages(ctx: ScopeRenderContext): React.ReactNode | undefined {
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

  if (active === 'storage.storage-classes' || active === 'config.storage') {
    return renderActiveNavPage(
      'Storage Classes',
      <FolderTree className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <StorageClassesView
        filter={filter}
        refreshKey={refreshKey}
        onSelect={(s) => setTarget({ kind: 'StorageClass', namespace: null, name: s.name })}
        onCount={onCount}
        onLoading={onLoading}
      />,
    )
  }
  if (active === 'storage.persistent-volumes') {
    return renderActiveNavPage(
      'Persistent Volumes',
      <FolderTree className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <PersistentVolumesView
        filter={filter}
        refreshKey={refreshKey}
        onSelect={(p) => setTarget({ kind: 'PersistentVolume', namespace: null, name: p.name })}
        onSelectClaim={(claimNamespace, name) =>
          setTarget({ kind: 'PersistentVolumeClaim', namespace: claimNamespace, name })
        }
        onSelectStorageClass={(name) => setTarget({ kind: 'StorageClass', namespace: null, name })}
        onCount={onCount}
        onLoading={onLoading}
      />,
    )
  }
  if (active === 'storage.persistent-volume-claims') {
    return renderActiveNavPage(
      'PVCs',
      <FolderTree className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <PersistentVolumeClaimsView
        namespace={namespace}
        filter={filter}
        refreshKey={refreshKey}
        onSelect={(p) =>
          setTarget({ kind: 'PersistentVolumeClaim', namespace: p.namespace, name: p.name })
        }
        onSelectVolume={(name) => setTarget({ kind: 'PersistentVolume', namespace: null, name })}
        onSelectStorageClass={(name) => setTarget({ kind: 'StorageClass', namespace: null, name })}
        onCount={onCount}
        onLoading={onLoading}
      />,
    )
  }
  if (active === 'custom.crds') {
    return renderActiveNavPage(
      'CRDs',
      <FolderTree className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <CustomResourceDefinitionsView
        filter={filter}
        refreshKey={refreshKey}
        onSelect={(c) =>
          setTarget({ kind: 'CustomResourceDefinition', namespace: null, name: c.name })
        }
        onCount={onCount}
        onLoading={onLoading}
      />,
    )
  }
  // One CRD type (sidebar destination) or every kind at once (`custom.resources`).
  const customResourceType = parseCustomResourceNavigationKey(active)

  if (customResourceType || active === 'custom.resources') {
    return renderActiveNavPage(
      customResourceType?.kind ?? 'Custom Resources',
      <FolderTree className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
      <CustomResourcesView
        namespace={namespace}
        filter={filter}
        refreshKey={refreshKey}
        resourceType={customResourceType ?? undefined}
        onSelect={(c) =>
          setTarget({
            kind: 'CustomResource',
            namespace: c.namespace,
            name: c.name,
            apiVersion: c.apiVersion,
            plural: c.plural,
            resourceKind: c.kind,
            uid: c.uid,
          })
        }
        onCount={onCount}
        onLoading={onLoading}
      />,
    )
  }

  // default workloads.pods
  return renderActiveNavPage(
    'Pods',
    <FolderTree className="w-3.5 h-3.5 text-tertiary" strokeWidth={1.8} />,
    <PodsView
      namespace={namespace}
      filter={filter}
      refreshKey={refreshKey}
      onSelect={(p) => setTarget({ kind: 'Pod', namespace: p.namespace, name: p.name })}
      onSelectNode={(name) => setTarget({ kind: 'Node', namespace: null, name })}
      onExec={(p) =>
        setTarget({ kind: 'Pod', namespace: p.namespace, name: p.name, initialTab: 'Terminal' })
      }
      onCount={onCount}
      onLoading={onLoading}
    />,
  )
}

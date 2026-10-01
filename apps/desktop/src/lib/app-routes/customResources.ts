import { pathSegment } from './sections.ts'

import type { CustomResourceType } from '../../types'
import type { DetailTarget } from '../../views/DetailView'

export function customResourceTypeForTarget(
  target: DetailTarget | null,
): CustomResourceType | null {
  if (
    target?.kind !== 'CustomResource' ||
    !target.apiVersion ||
    !target.resourceKind ||
    !target.plural
  ) {
    return null
  }

  return {
    apiVersion: target.apiVersion,
    kind: target.resourceKind,
    plural: target.plural,
    namespaced: target.namespace !== null,
  }
}

export function customResourcePagePath(resource: CustomResourceType): string | null {
  const [group, version] = resource.apiVersion.split('/', 2)

  if (!group || !version) return null

  return [
    'custom-resources',
    pathSegment(group),
    pathSegment(version),
    pathSegment(resource.kind),
    pathSegment(resource.plural),
    resource.namespaced ? 'namespaced' : 'cluster-scoped',
  ].join('/')
}

export function customResourceForPageSegments(segs: string[]): CustomResourceType | null {
  if (segs.length !== 6 || segs[0] !== 'custom-resources') return null
  const [, group, version, kind, plural, scope] = segs

  if (!group || !version || !kind || !plural) return null
  if (scope !== 'namespaced' && scope !== 'cluster-scoped') return null

  return {
    apiVersion: `${group}/${version}`,
    kind,
    plural,
    namespaced: scope === 'namespaced',
  }
}

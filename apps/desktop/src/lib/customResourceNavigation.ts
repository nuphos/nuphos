import type { CustomResourceType } from '../types'

const CUSTOM_RESOURCE_PREFIX = 'custom.resource:'

/**
 * Encodes the CRD identity in a sidebar key so an item click can open that
 * resource type without relying on sidebar-local state.
 */
export function customResourceNavigationKey(resource: CustomResourceType): string {
  return `${CUSTOM_RESOURCE_PREFIX}${[
    resource.apiVersion,
    resource.kind,
    resource.plural,
    resource.namespaced ? '1' : '0',
  ]
    .map(encodeURIComponent)
    .join(':')}`
}

export function parseCustomResourceNavigationKey(key: string): CustomResourceType | null {
  if (!key.startsWith(CUSTOM_RESOURCE_PREFIX)) return null

  const parts = key.slice(CUSTOM_RESOURCE_PREFIX.length).split(':')

  if (parts.length !== 4 || (parts[3] !== '0' && parts[3] !== '1')) return null

  try {
    const [apiVersion, kind, plural, namespaced] = parts.map(decodeURIComponent)

    if (!apiVersion || !kind || !plural) return null

    return { apiVersion, kind, plural, namespaced: namespaced === '1' }
  } catch {
    return null
  }
}

export function customResourceNavigationMetadata(
  key: string,
): { key: string; label: string; group: 'Custom Resources' } | null {
  const resource = parseCustomResourceNavigationKey(key)

  return resource ? { key, label: resource.kind, group: 'Custom Resources' } : null
}

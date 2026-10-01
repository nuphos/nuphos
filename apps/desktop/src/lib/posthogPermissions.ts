import type {
  PosthogAccess,
  PosthogIntegration,
  PosthogPermissions,
  PosthogScopeCatalog,
} from '../types/posthog.ts'

export type PosthogPresetChoice = 'read_only' | 'read_write' | 'custom'

export const POSTHOG_ACCESS_LABELS: Record<PosthogAccess, string> = {
  none: 'No access',
  read: 'Read',
  write: 'Write',
}

/** Every catalog resource with an explicit level; unknown ids are dropped. */
export function normalizePermissions(
  catalog: PosthogScopeCatalog,
  permissions: PosthogPermissions,
): PosthogPermissions {
  return Object.fromEntries(
    catalog.resources.map((resource) => {
      const level = permissions[resource.id] ?? 'none'

      return [resource.id, level === 'write' && !resource.writable ? 'read' : level]
    }),
  )
}

export function defaultPermissions(catalog: PosthogScopeCatalog): PosthogPermissions {
  const readOnly = catalog.presets.find((preset) => preset.id === 'read_only')

  return normalizePermissions(catalog, readOnly?.permissions ?? {})
}

export function detectPreset(
  catalog: PosthogScopeCatalog,
  permissions: PosthogPermissions,
): PosthogPresetChoice {
  const current = normalizePermissions(catalog, permissions)
  const match = catalog.presets.find((preset) => {
    const expected = normalizePermissions(catalog, preset.permissions)

    return catalog.resources.every((resource) => expected[resource.id] === current[resource.id])
  })

  return match?.id ?? 'custom'
}

export type PosthogGrantNotice = { kind: 'missing' | 'extra'; text: string }

export function grantNotices(
  integration: Pick<PosthogIntegration, 'missingScopes' | 'extraScopes'>,
): PosthogGrantNotice[] {
  const notices: PosthogGrantNotice[] = []

  if (integration.missingScopes.length > 0) {
    notices.push({
      kind: 'missing',
      text: `PostHog granted less than requested: ${integration.missingScopes.join(', ')}`,
    })
  }
  if (integration.extraScopes.length > 0) {
    notices.push({
      kind: 'extra',
      text: `PostHog granted more than requested: ${integration.extraScopes.join(', ')}`,
    })
  }

  return notices
}

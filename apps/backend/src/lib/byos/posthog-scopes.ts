export type PosthogAccessLevel = 'none' | 'read' | 'write'

export type PosthogPermissions = Record<string, PosthogAccessLevel>

type PosthogResource = {
  id: string
  label: string
  description: string
  writable: boolean
  writeWarning: string | null
}

// The identity and project listing the bind flow itself needs.
export const POSTHOG_FIXED_SCOPES = ['user:read', 'project:read'] as const

// Every entry is an unprivileged `<object>:read|write` scope PostHog lists in
// its authorization-server metadata `scopes_supported`.
export const POSTHOG_RESOURCES: readonly PosthogResource[] = [
  {
    id: 'query',
    label: 'Queries',
    description: 'Run HogQL / SQL over events, persons and sessions.',
    writable: false,
    writeWarning: null,
  },
  {
    id: 'insight',
    label: 'Insights',
    description: 'Saved trends, funnels, retention and SQL insights.',
    writable: true,
    writeWarning: null,
  },
  {
    id: 'dashboard',
    label: 'Dashboards',
    description: 'Dashboards and their tiles.',
    writable: true,
    writeWarning: null,
  },
  {
    id: 'feature_flag',
    label: 'Feature flags',
    description: 'Flag definitions, rollout conditions and status.',
    writable: true,
    writeWarning: 'Changing a flag changes production behaviour for real users.',
  },
  {
    id: 'experiment',
    label: 'Experiments',
    description: 'A/B experiments and their results.',
    writable: true,
    writeWarning: 'Launching or stopping an experiment changes what real users see.',
  },
  {
    id: 'survey',
    label: 'Surveys',
    description: 'In-app surveys and responses.',
    writable: true,
    writeWarning: 'Launching a survey shows it to real users.',
  },
  {
    id: 'cohort',
    label: 'Cohorts',
    description: 'Saved user cohorts.',
    writable: true,
    writeWarning: null,
  },
  {
    id: 'person',
    label: 'Persons',
    description: 'People and their properties (personal data).',
    writable: true,
    writeWarning: 'Write access can edit or permanently delete people and their data.',
  },
  {
    id: 'session_recording',
    label: 'Session recordings',
    description: 'Session replays (may contain personal data).',
    writable: true,
    writeWarning: 'Write access can delete recordings.',
  },
  {
    id: 'action',
    label: 'Actions',
    description: 'Named combinations of events.',
    writable: true,
    writeWarning: null,
  },
  {
    id: 'event_definition',
    label: 'Event definitions',
    description: 'The event catalogue and its descriptions.',
    writable: true,
    writeWarning: null,
  },
  {
    id: 'property_definition',
    label: 'Property definitions',
    description: 'The property catalogue and its descriptions.',
    writable: true,
    writeWarning: null,
  },
  {
    id: 'annotation',
    label: 'Annotations',
    description: 'Deploy markers and notes on charts.',
    writable: true,
    writeWarning: null,
  },
  {
    id: 'notebook',
    label: 'Notebooks',
    description: 'Collaborative analysis notebooks.',
    writable: true,
    writeWarning: null,
  },
  {
    id: 'error_tracking',
    label: 'Error tracking',
    description: 'Exceptions and error issues.',
    writable: true,
    writeWarning: null,
  },
]

const RESOURCE_IDS = new Set(POSTHOG_RESOURCES.map((resource) => resource.id))

function uniformPermissions(write: boolean): PosthogPermissions {
  return Object.fromEntries(
    POSTHOG_RESOURCES.map((resource) => [
      resource.id,
      write && resource.writable ? 'write' : 'read',
    ]),
  )
}

export const POSTHOG_PRESETS = [
  { id: 'read_only', label: 'Read only', permissions: uniformPermissions(false) },
  { id: 'read_write', label: 'Read & write', permissions: uniformPermissions(true) },
] as const

export const DEFAULT_POSTHOG_PERMISSIONS = uniformPermissions(false)

/** Every scope the matrix can request: the app's ceiling in its metadata document. */
export const POSTHOG_SCOPE_CEILING: string[] = [
  ...POSTHOG_FIXED_SCOPES,
  ...POSTHOG_RESOURCES.flatMap((resource) =>
    resource.writable ? [`${resource.id}:read`, `${resource.id}:write`] : [`${resource.id}:read`],
  ),
]

export class PosthogPermissionError extends Error {}

// A scope set as a hex bitmask over POSTHOG_SCOPE_CEILING. The ceiling is
// append-only, so every mask ever issued keeps decoding to the same set.
export function encodeScopeSet(scopes: readonly string[]): string {
  const wanted = new Set(scopes)
  let mask = 0n

  POSTHOG_SCOPE_CEILING.forEach((scope, index) => {
    if (wanted.has(scope)) mask |= 1n << BigInt(index)
  })

  return mask.toString(16)
}

/** The scope set a mask names, or null for a malformed or non-canonical mask. */
export function decodeScopeSet(mask: string): string[] | null {
  if (!/^[0-9a-f]{1,32}$/u.test(mask)) return null
  const bits = BigInt(`0x${mask}`)

  if (bits >> BigInt(POSTHOG_SCOPE_CEILING.length) !== 0n) return null
  const scopes = POSTHOG_SCOPE_CEILING.filter((_, index) => (bits >> BigInt(index)) & 1n)

  return encodeScopeSet(scopes) === mask ? scopes : null
}

/** Scopes for a matrix; write implies read, and unknown or unwritable entries are rejected. */
export function scopesForPermissions(permissions: PosthogPermissions): string[] {
  const scopes: string[] = [...POSTHOG_FIXED_SCOPES]

  for (const [id, level] of Object.entries(permissions)) {
    if (!RESOURCE_IDS.has(id)) throw new PosthogPermissionError(`Unknown PostHog resource: ${id}`)
    const resource = POSTHOG_RESOURCES.find((candidate) => candidate.id === id)!

    if (level === 'write' && !resource.writable) {
      throw new PosthogPermissionError(`${resource.label} cannot be granted write access`)
    }
    if (level === 'read' || level === 'write') scopes.push(`${id}:read`)
    if (level === 'write') scopes.push(`${id}:write`)
  }

  return [...new Set(scopes)]
}

export function permissionsForScopes(scopes: readonly string[]): PosthogPermissions {
  const granted = new Set(scopes)

  return Object.fromEntries(
    POSTHOG_RESOURCES.map((resource) => {
      if (granted.has(`${resource.id}:write`)) return [resource.id, 'write']
      if (granted.has(`${resource.id}:read`)) return [resource.id, 'read']

      return [resource.id, 'none']
    }),
  )
}

export function parseScope(scope: string): string[] {
  return scope.split(/\s+/u).filter(Boolean)
}

export function scopeDiff(
  requested: readonly string[],
  granted: readonly string[],
): { missingScopes: string[]; extraScopes: string[] } {
  const grantedSet = new Set(granted)
  const requestedSet = new Set(requested)

  return {
    missingScopes: requested.filter((scope) => !grantedSet.has(scope)),
    extraScopes: granted.filter((scope) => !requestedSet.has(scope)),
  }
}

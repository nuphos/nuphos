import type { GcpHandle } from '@/lib/byos/gcp'
import type { GcpProjectVariables } from '@/middleware/auth'
import type { Context } from 'hono'

/**
 * The identity every GCP call needs: which service account to impersonate, in
 * which project, on whose behalf. `teamId` lets the connector federate as this
 * team — see `impersonateSa`.
 */
export function handleFor(c: Context<{ Variables: GcpProjectVariables }>): GcpHandle {
  return {
    projectId: c.get('projectId'),
    serviceAccountEmail: c.get('serviceAccountEmail'),
    teamId: c.get('teamId'),
  }
}

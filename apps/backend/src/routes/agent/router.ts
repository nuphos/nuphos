import { Hono } from 'hono'

import { DEVICE_CREDENTIAL_PREFIX, hashDeviceSecret } from '@/lib/agent/devices/join-tokens'
import { findAgentDeviceByCredentialHash } from '@/lib/agent/devices/store'
import { AppError } from '@/lib/errors'
import { getNuphosUserForCredential } from '@/lib/identity'
import { requireAuth } from '@/middleware/auth'

import type { AgentDevice } from '@/lib/agent/devices/store'
import type { NuphosUser } from '@/lib/identity'
import type { AuthVariables } from '@/middleware/auth'
import type { MiddlewareHandler } from 'hono'

export type DeviceCredentialAuthDeps = {
  findDevice: (credentialHash: string) => Promise<AgentDevice | null>
  getUser: (userId: string, issuedAt: Date) => Promise<NuphosUser | null>
}

/**
 * A device credential from `nuphos agent --join` opens that device's own
 * runtime tunnel, and nothing else, until it is revoked. A person's computer
 * also stops when they sign out everywhere. A Box belongs to its team, so no
 * person's sessions take it offline. Every other credential goes through the
 * ordinary session check.
 */
export function requireAuthOrDeviceCredential(
  deps: DeviceCredentialAuthDeps = {
    findDevice: findAgentDeviceByCredentialHash,
    getUser: getNuphosUserForCredential,
  },
): MiddlewareHandler<{ Variables: AuthVariables }> {
  return async (c, next) => {
    const header = c.req.header('Authorization')

    if (!header?.startsWith(`Bearer ${DEVICE_CREDENTIAL_PREFIX}`)) return requireAuth(c, next)
    const device = await deps.findDevice(hashDeviceSecret(header.slice('Bearer '.length)))

    if (
      !device ||
      c.req.path !== `/agent/devices/${encodeURIComponent(device.deviceId)}/runtime-tunnel`
    )
      throw new AppError(401, 'unauthorized', 'Invalid device credential')
    // A Box's userId only keys its row; the tunnel names no person.
    if (device.box) {
      c.set('userId', device.userId)

      return next()
    }
    const user =
      device.credentialIssuedAt && (await deps.getUser(device.userId, device.credentialIssuedAt))

    if (!user) throw new AppError(401, 'unauthorized', 'Invalid device credential')
    c.set('userId', user.id)
    c.set('userEmail', user.email)
    c.set('userName', user.name)
    c.set('user', user)
    await next()
  }
}

export const agent = new Hono<{ Variables: AuthVariables }>()

agent.use('*', requireAuthOrDeviceCredential())

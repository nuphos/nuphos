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

const liveDeviceDeps: DeviceCredentialAuthDeps = {
  findDevice: findAgentDeviceByCredentialHash,
  getUser: getNuphosUserForCredential,
}

/**
 * The device a device credential from `nuphos agent --join` names, with its owner,
 * until it is revoked; null for any other credential. A person's computer also stops
 * when they sign out everywhere. A Box belongs to its team, so no person's sessions
 * take it offline, and it has no owner here.
 */
export async function liveDevice(
  header: string | undefined,
  deps = liveDeviceDeps,
): Promise<{ device: AgentDevice; user: NuphosUser | null } | null> {
  if (!header?.startsWith(`Bearer ${DEVICE_CREDENTIAL_PREFIX}`)) return null
  const device = await deps.findDevice(hashDeviceSecret(header.slice('Bearer '.length)))
  const user =
    device && !device.box && device.credentialIssuedAt
      ? await deps.getUser(device.userId, device.credentialIssuedAt)
      : null

  if (!device || (!device.box && !user))
    throw new AppError(401, 'unauthorized', 'Invalid device credential')

  return { device, user }
}

/**
 * A device credential opens that device's own runtime tunnel here; its only other
 * use is a vault read (`GET /vault/computer/items/:name`). Every other credential
 * goes through the ordinary session check.
 */
export function requireAuthOrDeviceCredential(
  deps = liveDeviceDeps,
): MiddlewareHandler<{ Variables: AuthVariables }> {
  return async (c, next) => {
    const live = await liveDevice(c.req.header('Authorization'), deps)

    if (!live) return requireAuth(c, next)
    const { device, user } = live

    if (c.req.path !== `/agent/devices/${encodeURIComponent(device.deviceId)}/runtime-tunnel`)
      throw new AppError(401, 'unauthorized', 'Invalid device credential')
    // A Box's userId only keys its row; the tunnel names no person.
    if (!user) {
      c.set('userId', device.userId)

      return next()
    }
    c.set('userId', user.id)
    c.set('userEmail', user.email)
    c.set('userName', user.name)
    c.set('user', user)
    await next()
  }
}

export const agent = new Hono<{ Variables: AuthVariables }>()

agent.use('*', requireAuthOrDeviceCredential())

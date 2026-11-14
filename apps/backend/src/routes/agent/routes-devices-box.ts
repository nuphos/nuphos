import { Hono } from 'hono'
import { z } from 'zod'

import {
  deviceAccess,
  deviceOwner,
  listAccessibleDevices,
  losingUse,
  memberAccess,
  requireDeviceAccess,
} from '@/lib/agent/devices/box-access'
import { boxUpdatingSince } from '@/lib/agent/devices/box-updating'
import { teamUse } from '@/lib/agent/devices/device-grants'
import { AppError } from '@/lib/errors'
import { zv } from '@/lib/validate'

import { readTeamIdCandidate } from './team-scope'

import type { AgentDeviceRouteDependencies } from './routes-devices'
import type { DeviceAccessLevel } from '@/lib/agent/devices/box-access'
import type { AgentDevice } from '@/lib/agent/devices/store'
import type { AuthVariables } from '@/middleware/auth'

// Boxes: cloud machines made for the caller, listed and driven as their devices.

const deviceParam = z.object({ deviceId: z.string().trim().min(1).max(128) })
const boxAccessSchema = z.object({
  everyone: z.boolean(),
  userIds: z.array(z.string().trim().min(1).max(64)).max(500),
})
const boxCreateSchema = z.object({
  label: z.string().trim().min(1).max(200).optional(),
  teamId: z.string().trim().min(1).max(64).optional(),
  /** One of the sizes the Boxes section lists; the smallest when left out. */
  vcpus: z.number().int().min(1).max(1024).optional(),
  /** Whom it is shared with besides its creator and the admins; no one when left out. */
  access: boxAccessSchema.optional(),
  instaboxAccountId: z.string().trim().min(1).max(64).optional(),
})

/** Unnamed Boxes count up: "Computer 1", "Computer 2", … after the highest the caller has. */
export function nextBoxLabel(labels: string[]): string {
  const taken = labels
    .map((label) => /^Computer (\d+)$/u.exec(label)?.[1])
    .filter((n): n is string => n !== undefined)
    .map(Number)

  return `Computer ${String(Math.max(0, ...taken) + 1)}`
}

/** A device as a client sees it, never its credential hash; null once its Box's machine is gone. */
async function deviceView(
  deps: AgentDeviceRouteDependencies,
  device: AgentDevice,
  /** What the viewer may do with it; a manager also sees who may use it. */
  level: DeviceAccessLevel,
  /** Right after a pause the frozen tunnel still looks alive; the caller knows better. */
  online?: boolean,
) {
  online ??= await deps.isOnline(device.userId, device.deviceId)
  const updating = boxUpdatingSince(device)
  const state = device.box && deps.box ? await deps.box.state(device, online) : undefined

  if (state === 'gone') {
    await deps.deleteDevice(device.userId, device.deviceId)

    return null
  }

  return {
    deviceId: device.deviceId,
    label: device.label,
    platform: device.platform,
    ...(device.model ? { model: device.model } : {}),
    allowLocalExec: device.allowLocalExec,
    online,
    access: level,
    ownerUserId: deviceOwner(device),
    createdAt: device.createdAt.toISOString(),
    // The IP is personal data: only for those who manage the machine.
    ...(level !== 'use' && device.lastSeenAt
      ? { lastSeenAt: device.lastSeenAt.toISOString(), lastSeen: device.lastSeen ?? null }
      : {}),
    ...(device.box && state
      ? {
          box: {
            provider: device.box.provider,
            ...(level !== 'use' ? { access: teamUse(device, device.box.teamId) } : {}),
            ...(device.box.sandboxId ? { sandboxId: device.box.sandboxId } : {}),
            ...(device.box.accountId ? { instaboxAccountId: device.box.accountId } : {}),
            ...(device.box.useTerminal ? { useTerminal: true } : {}),
            state,
            // Its host restarting for an update: offline on purpose, and back on its own.
            ...(updating ? { updateStartedAt: updating.toISOString() } : {}),
          },
        }
      : {}),
  }
}

export function createAgentDeviceBoxRoutes(deps: AgentDeviceRouteDependencies) {
  const routes = new Hono<{ Variables: AuthVariables }>()
  const viewOrGone = async (device: AgentDevice, online?: boolean) => {
    const view = await deviceView(deps, device, 'manage', online)

    if (!view) throw new AppError(404, 'not_found', 'This Box no longer exists')

    return view
  }
  const requireBoxes = () => {
    if (!deps.box)
      throw new AppError(503, 'box_unavailable', 'Boxes are not enabled on this deployment')

    return deps.box
  }

  // The caller's own devices, online or not; a Box carries its machine's state.
  routes.get('/devices', async (c) => {
    const userId = c.get('userId')
    const teamId = readTeamIdCandidate(c)
    // Only devices the viewer may use are listed, so only they get metrics read or demanded.
    const devices = await listAccessibleDevices(userId, teamId, deps.access)
    const role = teamId ? await deps.access.role(userId, teamId) : null
    const demand = c.req.query('metrics') === 'true'

    return c.json({
      boxAvailable: deps.box?.available() ?? false,
      canCreateBox: role === 'ADMINISTRATOR',
      devices: (
        await Promise.all(
          devices.map(async (device) => {
            const view = await deviceView(
              deps,
              device,
              deviceAccess(device, userId, teamId) ?? 'use',
            )

            return view
              ? {
                  ...view,
                  // The host reports under its transport owner, never the viewer.
                  ...(view.online
                    ? await deps.readMetrics(device.userId, device.deviceId, demand)
                    : { metrics: null, metricsStatus: 'offline', metricsReceivedAt: null }),
                  // A Box's displays besides its own :1, for the desktop's screen switcher.
                  ...(view.box && view.online
                    ? {
                        desktops: await deps.boxDesktops(
                          device.userId,
                          device.deviceId,
                          userId,
                          teamId,
                        ),
                      }
                    : {}),
                }
              : null
          }),
        )
      ).filter((view) => view !== null),
    })
  })

  // A Box: a cloud machine made for this user, joined with its own one-time token. With
  // `instaboxAccountId` it is on that team account, which instabox bills, not the deployment's.
  routes.post('/devices/boxes', zv('json', boxCreateSchema), async (c) => {
    const box = requireBoxes()
    const { label, teamId: requestedTeamId, vcpus, access: requested } = c.req.valid('json')
    const teamId = readTeamIdCandidate(c, requestedTeamId)

    if (!teamId) throw new AppError(400, 'team_required', 'A Box is made inside one of your teams')
    if ((await deps.access.role(c.get('userId'), teamId)) !== 'ADMINISTRATOR')
      throw new AppError(403, 'forbidden', 'Only an active team administrator can create a Box')
    // Stored with the Box itself, so a Box is never made without the access asked for.
    const shared = requested && memberAccess(await deps.teamMembers(teamId), requested)
    const device = await box.create(
      c.get('userId'),
      teamId,
      label ?? nextBoxLabel((await deps.listDevices(c.get('userId'))).map((d) => d.label)),
      { vcpus, shared, accountId: c.req.valid('json').instaboxAccountId },
    )

    return c.json(await viewOrGone(device), 201)
  })

  // The Box's desktop, to watch and take over what its agents do.
  routes.post('/devices/:deviceId/box/desktop', zv('param', deviceParam), async (c) => {
    const device = await requireDeviceAccess(
      c.get('userId'),
      readTeamIdCandidate(c),
      c.req.valid('param').deviceId,
      'manage',
      deps.access,
    )
    const url = await requireBoxes().desktop(device.userId, device.deviceId)

    return c.json({ url, label: device.label })
  })

  // Rename any of the caller's own devices, a Box or a computer.
  routes.patch(
    '/devices/:deviceId',
    zv('param', deviceParam),
    zv('json', z.object({ label: z.string().trim().min(1).max(200) })),
    async (c) => {
      const { deviceId } = c.req.valid('param')
      const { label } = c.req.valid('json')

      const device = await requireDeviceAccess(
        c.get('userId'),
        readTeamIdCandidate(c),
        deviceId,
        'manage',
        deps.access,
      )

      if (!(await deps.renameDevice(device.userId, deviceId, label)))
        throw new AppError(404, 'not_found', `No device ${deviceId}`)

      return c.json({ ok: true })
    },
  )

  routes.post('/devices/:deviceId/box/pause', zv('param', deviceParam), async (c) => {
    const target = await requireDeviceAccess(
      c.get('userId'),
      readTeamIdCandidate(c),
      c.req.valid('param').deviceId,
      'manage',
      deps.access,
    )
    const device = await requireBoxes().pause(target.userId, target.deviceId)

    return c.json(await viewOrGone(device, false))
  })

  routes.post('/devices/:deviceId/box/resume', zv('param', deviceParam), async (c) => {
    const target = await requireDeviceAccess(
      c.get('userId'),
      readTeamIdCandidate(c),
      c.req.valid('param').deviceId,
      'manage',
      deps.access,
    )
    const device = await requireBoxes().resume(target.userId, target.deviceId)

    return c.json(await viewOrGone(device))
  })

  // Who may use a Box: its owner and managers decide. Whoever loses access has their open
  // terminal, CUA and chat streams on it closed; a one-shot exec already sent finishes.
  routes.put(
    '/devices/:deviceId/box/access',
    zv('param', deviceParam),
    zv('json', boxAccessSchema),
    async (c) => {
      const teamId = readTeamIdCandidate(c)
      const device = await requireDeviceAccess(
        c.get('userId'),
        teamId,
        c.req.valid('param').deviceId,
        'manage',
        deps.access,
      )
      const boxTeam = device.box?.teamId ?? ''
      const members = await deps.teamMembers(boxTeam)
      const access = memberAccess(members, c.req.valid('json'))
      const by = { actorUserId: c.get('userId'), via: 'box_access' as const }

      if (!(await deps.setTeamUse(device.userId, device.deviceId, boxTeam, access, by)))
        throw new AppError(404, 'device_not_found', 'Device is not available')
      const memberIds = members.map((member) => member.id)

      await deps.revokeStreams([device], losingUse(memberIds, device, boxTeam, access))

      return c.json({ access })
    },
  )

  routes.delete('/devices/:deviceId/box', zv('param', deviceParam), async (c) => {
    const { deviceId } = c.req.valid('param')
    const { userId } = await requireDeviceAccess(
      c.get('userId'),
      readTeamIdCandidate(c),
      deviceId,
      'owner',
      deps.access,
    )

    // Close the Box's tunnel cleanly before its machine goes, not by a dropped socket.
    if (await deps.revokeCredential(userId, deviceId)) await deps.disconnect(userId, deviceId)
    await requireBoxes().destroy(userId, deviceId)
    await deps.deleteDevice(userId, deviceId)

    return c.json({ ok: true })
  })

  return routes
}

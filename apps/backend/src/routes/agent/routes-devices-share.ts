import { Hono } from 'hono'
import { z } from 'zod'

import {
  deviceAccessDeps,
  memberAccess,
  requireDeviceAccess,
  revokeBoxStreams,
} from '@/lib/agent/devices/box-access'
import { agentConversations } from '@/lib/agent/db/shared'
import { exceedsCeiling, teamShare } from '@/lib/agent/devices/local-share'
import { getTeamLocalAgentSharing } from '@/lib/agent/devices/local-share-ceiling'
import {
  decideShareApproval,
  dropShareApprovals,
  listPendingShareApprovals,
  setDeviceShare,
} from '@/lib/agent/devices/local-share-store'
import { LOCAL_SHARE_LEVELS } from '@/lib/agent/devices/local-share-types'
import { getAgentDevice, isActiveTeamMember } from '@/lib/agent/devices/store'
import { AppError } from '@/lib/errors'
import { getTeamMembers } from '@/lib/identity'
import { logError } from '@/lib/observability'
import { zv } from '@/lib/validate'

import { settleShareApprovalQueue } from './session-queue-share-approval'
import { readTeamIdCandidate } from './team-scope'

import type { DeviceAccessDeps } from '@/lib/agent/devices/box-access'
import type { ShareApproval } from '@/lib/agent/devices/local-share-store'
import type { LocalAgentShare, LocalShareLevel } from '@/lib/agent/devices/local-share-types'
import type { AgentDevice } from '@/lib/agent/devices/store'
import type { AuthVariables } from '@/middleware/auth'

// Sharing a person's own computer's Local Agent with teammates; see lib/agent/devices/local-share.

const deviceParam = z.object({ deviceId: z.string().trim().min(1).max(128) })
const approvalParam = z.object({ approvalId: z.string().trim().min(1).max(64) })
const shareSchema = z.object({
  level: z.enum(LOCAL_SHARE_LEVELS as [LocalShareLevel, ...LocalShareLevel[]]),
  everyone: z.boolean(),
  userIds: z.array(z.string().trim().min(1).max(64)).max(500),
})
const decisionSchema = z.object({ approve: z.boolean() })

export type DeviceShareRouteDependencies = {
  access: DeviceAccessDeps
  ceiling: (teamId: string) => Promise<LocalShareLevel>
  isMember: (userId: string, teamId: string) => Promise<boolean>
  teamMembers: (teamId: string) => Promise<{ id: string }[]>
  getDevice: (ownerId: string, deviceId: string) => Promise<AgentDevice | null>
  setShare: typeof setDeviceShare
  revokeStreams: (devices: AgentDevice[], actorIds: string[], teamId: string) => Promise<void>
  dropApprovals: typeof dropShareApprovals
  pendingApprovals: (ownerId: string, teamId: string) => Promise<ShareApproval[]>
  decide: typeof decideShareApproval
  settleQueue: (approval: ShareApproval) => Promise<void>
  conversationTitles: (sessionIds: string[]) => Promise<Map<string, string>>
}

/** The titles of the conversations waiting, so the owner sees what they approve. */
async function getConversationTitles(sessionIds: string[]): Promise<Map<string, string>> {
  if (!sessionIds.length) return new Map()
  const rows = await agentConversations()
    .find(
      { sessionId: { $in: [...new Set(sessionIds)] } },
      { projection: { sessionId: 1, title: 1 } },
    )
    .toArray()

  return new Map(rows.flatMap((row) => (row.title ? [[row.sessionId, row.title] as const] : [])))
}

const defaultDependencies: DeviceShareRouteDependencies = {
  access: deviceAccessDeps,
  ceiling: getTeamLocalAgentSharing,
  isMember: isActiveTeamMember,
  teamMembers: (teamId) => getTeamMembers(teamId),
  getDevice: getAgentDevice,
  setShare: setDeviceShare,
  revokeStreams: revokeBoxStreams,
  dropApprovals: dropShareApprovals,
  pendingApprovals: listPendingShareApprovals,
  decide: decideShareApproval,
  settleQueue: settleShareApprovalQueue,
  conversationTitles: getConversationTitles,
}

const OFF = { level: 'off' as const, everyone: false, userIds: [] as string[] }

export function createDeviceShareRoutes(deps: DeviceShareRouteDependencies = defaultDependencies) {
  const routes = new Hono<{ Variables: AuthVariables }>()

  /** The caller's own computer in a team they belong to; never a Box, which has its own access. */
  const ownComputer = async (userId: string, teamId: string | undefined, deviceId: string) => {
    if (!teamId) throw new AppError(400, 'team_required', 'Pass the teamId to share it with')
    const device = await requireDeviceAccess(userId, teamId, deviceId, 'manage', deps.access)

    if (device.box || device.userId !== userId || !(await deps.isMember(userId, teamId)))
      throw new AppError(404, 'device_not_found', 'Device is not available')

    return { device, teamId }
  }

  routes.get('/devices/:deviceId/share', zv('param', deviceParam), async (c) => {
    const { device, teamId } = await ownComputer(
      c.get('userId'),
      readTeamIdCandidate(c),
      c.req.valid('param').deviceId,
    )
    const share = teamShare(device, teamId)

    return c.json({
      share: share ? { level: share.level, everyone: share.everyone, userIds: share.userIds } : OFF,
      ceiling: await deps.ceiling(teamId),
    })
  })

  // Whoever loses access has their open chat streams on it closed and their answers forgotten.
  routes.put(
    '/devices/:deviceId/share',
    zv('param', deviceParam),
    zv('json', shareSchema),
    async (c) => {
      const userId = c.get('userId')
      const { device, teamId } = await ownComputer(
        userId,
        readTeamIdCandidate(c),
        c.req.valid('param').deviceId,
      )
      const input = c.req.valid('json')
      const ceiling = await deps.ceiling(teamId)

      if (exceedsCeiling(input.level, ceiling))
        throw new AppError(
          403,
          'local_share_above_ceiling',
          ceiling === 'off'
            ? 'Your team’s administrators have turned off sharing your own computer.'
            : 'Your team’s administrators allow sharing your own computer only with your approval of each agent.',
        )
      const members = (await deps.teamMembers(teamId)).filter((member) => member.id !== userId)
      const access = memberAccess(members, input)
      const share: LocalAgentShare | null =
        input.level === 'off' ? null : { teamId, level: input.level, ...access }

      if (!(await deps.setShare(userId, device.deviceId, teamId, share)))
        throw new AppError(404, 'device_not_found', 'Device is not available')
      const lost = members
        .map((member) => member.id)
        .filter((id) => !share || (!share.everyone && !share.userIds.includes(id)))

      if (lost.length) {
        await deps.revokeStreams([device], lost, teamId)
        await deps.dropApprovals(userId, device.deviceId, teamId, lost)
      }

      return c.json({ share: share ?? OFF, ceiling })
    },
  )

  // What waits for the caller's answer: teammates' conversations on their computers.
  routes.get('/devices/share-approvals', async (c) => {
    const userId = c.get('userId')
    const teamId = readTeamIdCandidate(c)

    if (!teamId || !(await deps.isMember(userId, teamId))) return c.json({ approvals: [] })
    const pending = await deps.pendingApprovals(userId, teamId)
    const labels = new Map<string, string>()

    for (const deviceId of new Set(pending.map((approval) => approval.deviceId)))
      labels.set(deviceId, (await deps.getDevice(userId, deviceId))?.label ?? deviceId)
    const titles = await deps.conversationTitles(pending.map((approval) => approval.sessionId))

    return c.json({
      approvals: pending.map((approval) => ({
        id: approval._id,
        deviceId: approval.deviceId,
        deviceLabel: labels.get(approval.deviceId) ?? approval.deviceId,
        sessionId: approval.sessionId,
        ...(titles.has(approval.sessionId) ? { title: titles.get(approval.sessionId) } : {}),
        actorId: approval.actorId,
        requestedAt: approval.requestedAt.toISOString(),
      })),
    })
  })

  routes.post(
    '/devices/share-approvals/:approvalId',
    zv('param', approvalParam),
    zv('json', decisionSchema),
    async (c) => {
      const decided = await deps.decide(
        c.get('userId'),
        c.req.valid('param').approvalId,
        c.req.valid('json').approve,
      )

      if (!decided)
        throw new AppError(404, 'approval_not_found', 'This request was already answered')
      // The answer stands even when the waiting sends cannot be settled now; the queue sweep retries.
      await deps
        .settleQueue(decided)
        .catch((error: unknown) =>
          logError('agent.share_approval.settle_failed', error, { approval_id: decided._id }),
        )

      return c.json({ id: decided._id, status: decided.status })
    },
  )

  return routes
}

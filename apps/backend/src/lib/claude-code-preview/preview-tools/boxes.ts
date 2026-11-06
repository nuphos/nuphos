// Boxes an agent manages on its own: machines on one of the team's instabox
// accounts (never the deployment's, never a person's computer). Creating one
// selects it for this conversation, so local_exec, local_cua and update_thread
// can use it at once. The tools run under the conversation's permission mode.
import { tool } from 'ai'
import { z } from 'zod'

import { agentConversations } from '@/lib/agent/db'
import { deviceAccessDeps, requireDeviceAccess } from '@/lib/agent/devices/box-access'
import {
  boxState,
  createBox,
  destroyBox,
  pauseBox,
  resumeBox,
} from '@/lib/agent/devices/box-instabox'
import { tunnelBus } from '@/lib/agent/devices/local-runtime/bus'
import { holderChannel } from '@/lib/agent/devices/local-runtime/protocol'
import { isDevicePresent, waitForPresence } from '@/lib/agent/devices/presence'
import {
  deleteAgentDevice,
  getAgentDevice,
  listTeamBoxes,
  revokeAgentDeviceCredential,
} from '@/lib/agent/devices/store'
import { parseObjectId } from '@/lib/objectid'
import { teamByosBindings } from '@/models'

import { toolModuleFromAiSdkTools } from './ai-sdk-adapter'

import type { PreviewToolContext, PreviewToolModule } from '../preview-tool-context'
import type { AgentDevice } from '@/lib/agent/devices/store'

/** A fresh machine joins in about 20 s; the tool waits a little longer than the backend does. */
const JOIN_WAIT_MS = 4 * 60_000

const label = z.string().min(1).describe('Short description of this step in the user’s language.')

async function teamAccounts(teamId: string) {
  const doc = await teamByosBindings().findOne(
    { _id: parseObjectId(teamId, 'teamId') },
    { projection: { instaboxAccounts: 1 } },
  )

  return (doc?.instaboxAccounts ?? []).map((a) => ({ id: a.id.toHexString(), label: a.label }))
}

async function view(device: AgentDevice) {
  const online = await isDevicePresent(device.userId, device.deviceId)

  return {
    deviceId: device.deviceId,
    label: device.label,
    instaboxAccountId: device.box?.accountId,
    state: await boxState(device, online),
    online,
  }
}

/** A Box on one of the team's instabox accounts that the caller may act on at `level`. */
async function requireAgentBox(
  ctx: PreviewToolContext,
  deviceId: string,
  level: 'manage' | 'owner',
) {
  const device = await requireDeviceAccess(ctx.userId, ctx.teamId, deviceId, level)

  if (!device.box?.accountId)
    throw new Error('Only Boxes on one of the team’s instabox accounts can be managed here.')

  return device
}

export function boxToolModule(
  ctx: PreviewToolContext,
  options: Parameters<typeof toolModuleFromAiSdkTools>[1] = {},
): PreviewToolModule {
  return toolModuleFromAiSdkTools(
    {
      list_boxes: tool({
        description:
          "List the team's instabox accounts and the Boxes (cloud computers) on them that you may use, " +
          'with each one’s state. Use an account id with create_box and a deviceId with update_box, ' +
          'local_exec, local_cua or update_thread.',
        inputSchema: z.object({ label }).strict(),
        execute: async () => {
          const accounts = await teamAccounts(ctx.teamId)
          const ids = new Set(accounts.map((a) => a.id))
          const boxes = (await listTeamBoxes(ctx.teamId)).filter(
            (d) => d.box?.accountId && ids.has(d.box.accountId),
          )
          const usable = await Promise.all(
            boxes.map((d) =>
              requireDeviceAccess(ctx.userId, ctx.teamId, d.deviceId, 'use').then(view, () => null),
            ),
          )

          return { accounts, boxes: usable.filter((b) => b !== null) }
        },
      }),
      create_box: tool({
        description:
          "Create a Box, a Linux cloud computer with a desktop, on one of the team's instabox accounts; " +
          'instabox bills that account. It joins the team as a Nuphos computer and is selected for ' +
          'this conversation: use it with local_exec and local_cua, or hand it to a sub-agent with ' +
          'update_thread (grant provider "device", or runtimeId of its agent from list_agent_runtimes). ' +
          'Waits until it has joined, usually under a minute. Needs a team administrator. ' +
          'Stop or delete it with update_box when the work is done.',
        inputSchema: z
          .object({
            label,
            accountId: z
              .string()
              .optional()
              .describe('From list_boxes; may be left out when the team has one account.'),
            name: z.string().trim().min(1).max(200).optional().describe('The Box’s name.'),
            vcpus: z.number().int().min(1).optional().describe('The smallest size when left out.'),
          })
          .strict(),
        execute: async ({ accountId, name, vcpus }) => {
          const accounts = await teamAccounts(ctx.teamId)
          const account = accountId ?? (accounts.length === 1 ? accounts[0]?.id : undefined)

          if (!account)
            throw new Error(
              accounts.length === 0
                ? 'The team has no instabox account. A team administrator binds one under Settings → Integrations.'
                : 'Pass accountId: the team has several instabox accounts (see list_boxes).',
            )
          if ((await deviceAccessDeps.role(ctx.userId, ctx.teamId)) !== 'ADMINISTRATOR')
            throw new Error('Only a team administrator can create a Box.')
          const device = await createBox(ctx.userId, ctx.teamId, name ?? 'Agent Box', {
            vcpus,
            accountId: account,
          })

          await agentConversations().updateOne(
            { sessionId: ctx.sessionId, teamId: ctx.teamId, credentialAccess: { $exists: true } },
            { $addToSet: { 'credentialAccess.deviceIds': device.deviceId } },
          )
          const joined = await waitForPresence(ctx.userId, device.deviceId, JOIN_WAIT_MS)

          return {
            // Re-read: the machine id is recorded once it was ordered.
            ...(await view((await getAgentDevice(device.userId, device.deviceId)) ?? device)),
            joined,
            ...(joined ? {} : { note: 'Not joined yet; check list_boxes again shortly.' }),
          }
        },
      }),
      update_box: tool({
        description:
          'Stop, start or delete a Box on one of the team’s instabox accounts. stop pauses the machine ' +
          '(its disk stays; a later local_exec or start wakes it); delete removes the machine, its ' +
          'disk and the computer from Nuphos, and cannot be undone. Delete needs the Box’s owner.',
        inputSchema: z
          .object({
            label,
            deviceId: z.string().min(1).describe('From list_boxes.'),
            action: z.enum(['stop', 'start', 'delete']),
          })
          .strict(),
        execute: async ({ deviceId, action }) => {
          const device = await requireAgentBox(
            ctx,
            deviceId,
            action === 'delete' ? 'owner' : 'manage',
          )
          const { userId } = device

          if (action === 'stop') await pauseBox(userId, deviceId)
          if (action === 'start') await resumeBox(userId, deviceId)
          if (action !== 'delete') return { deviceId, action, done: true }
          // As the Box delete route: close its tunnel cleanly before the machine goes.
          if (await revokeAgentDeviceCredential(userId, deviceId))
            await tunnelBus().publish(
              holderChannel(userId, deviceId),
              JSON.stringify({ t: 'revoke' }),
            )
          await destroyBox(userId, deviceId)
          await deleteAgentDevice(userId, deviceId)

          return { deviceId, action, done: true }
        },
      }),
    },
    options,
  )
}

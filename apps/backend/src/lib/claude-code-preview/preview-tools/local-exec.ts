// `local_exec` needs to know, per conversation, which devices are currently
// selected AND online AND opted in — that set changes turn to turn (a device
// can go offline mid-conversation), so it's resolved fresh on every MCP
// tools-list/call rather than baked into a static module like the other
// local tools. It is relayed to the owner's device, so unlike those tools it
// does not depend on the sending client's `localTools` capability.
import { wakeBox } from '@/lib/agent/devices/box-instabox'
import { requireShellAccess } from '@/lib/agent/devices/manage-access'
import { createLocalTerminalTool } from '@/lib/agent/tools-skilled/local-terminal'
import { createLocalExecTool } from '@/lib/agent/tools-skilled/local-tools'
import { createLocalUploadTool } from '@/lib/agent/tools-skilled/local-upload'
import { getAgentCredentialOptions } from '@/routes/agent/credential-options'
import { getAgentCredentialAccess } from '@/routes/agent-sessions/shared'

import { toolModuleFromAiSdkTools } from './ai-sdk-adapter'

import type { PreviewToolContext, PreviewToolModule } from '../preview-tool-context'
import type { ShellPurpose } from '@/lib/agent/devices/manage-access'
import type { LocalExecDevice } from '@/lib/agent/tools-skilled/local-tools'
import type { AgentRef } from '@/lib/agents/identity'

/** `box`: a Nuphos computer, whose screen nobody sits at. */
export type AvailableDevice = LocalExecDevice & { box?: boolean }

/** Only computers the conversation's owner may open this shell on are offered. */
export async function resolveAvailableLocalExecDevices(
  ctx: PreviewToolContext,
  purpose: ShellPurpose = 'exec',
): Promise<AvailableDevice[]> {
  const userId = ctx.conversationOwnerUserId ?? ctx.userId
  const agent: AgentRef = {
    userId,
    sessionId: ctx.sessionId,
    ...(ctx.conversationOwnerUserId
      ? { conversationOwnerUserId: ctx.conversationOwnerUserId }
      : {}),
  }
  const [access, options] = await Promise.all([
    getAgentCredentialAccess(agent, ctx.teamId),
    getAgentCredentialOptions(ctx.teamId, userId),
  ])
  const selected = new Set(access.deviceIds)

  // Sharing delegates this conversation's selected devices, not computer-wide access.
  const devices = await Promise.all(
    options.devices
      .filter((device) => selected.has(device.deviceId))
      .map(async (device): Promise<AvailableDevice | null> => {
        if (!device.available && !device.box?.ready) return null
        // A device removed or unshared since the list was read is just not offered.
        const target = await requireShellAccess(userId, ctx.teamId, device.deviceId, purpose).catch(
          () => null,
        )

        if (!target?.allowLocalExec) return null

        return {
          deviceId: device.deviceId,
          label: device.label,
          ownerUserId: target.userId,
          ...(device.box ? { box: true } : {}),
          ...(!device.available
            ? {
                wake: async () => {
                  const current = await requireShellAccess(
                    userId,
                    ctx.teamId,
                    device.deviceId,
                    purpose,
                  )

                  return current.allowLocalExec && wakeBox(current.userId, current.deviceId)
                },
              }
            : {}),
        }
      }),
  )

  return devices.filter((device): device is LocalExecDevice => device !== null)
}

export async function localExecToolModule(ctx: PreviewToolContext): Promise<PreviewToolModule> {
  // A terminal may open where commands may not: on a Box its owner lets users open one on.
  const [devices, terminals] = await Promise.all([
    resolveAvailableLocalExecDevices(ctx),
    resolveAvailableLocalExecDevices(ctx, 'terminal'),
  ])

  return toolModuleFromAiSdkTools({
    local_upload: createLocalUploadTool(devices, {
      userId: ctx.userId,
      conversationOwnerUserId: ctx.conversationOwnerUserId,
      teamId: ctx.teamId,
      sessionId: ctx.sessionId,
      origin: ctx.turnOrigin ?? 'user',
    }),
    local_terminal: createLocalTerminalTool(terminals, {
      userId: ctx.userId,
      conversationOwnerUserId: ctx.conversationOwnerUserId,
      teamId: ctx.teamId,
      sessionId: ctx.sessionId,
      origin: ctx.turnOrigin ?? 'user',
    }),
    local_exec: createLocalExecTool(devices, {
      userId: ctx.userId,
      ...(ctx.conversationOwnerUserId
        ? { conversationOwnerUserId: ctx.conversationOwnerUserId }
        : {}),
      teamId: ctx.teamId,
      sessionId: ctx.sessionId,
      origin: ctx.turnOrigin ?? 'user',
    }),
  })
}

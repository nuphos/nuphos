// `local_exec` needs to know, per conversation, which devices are currently
// selected AND online AND opted in — that set changes turn to turn (a device
// can go offline mid-conversation), so it's resolved fresh on every MCP
// tools-list/call rather than baked into a static module like the other
// local tools. It is relayed to the owner's device, so unlike those tools it
// does not depend on the sending client's `localTools` capability.
import { createLocalTerminalTool } from '@/lib/agent/tools-skilled/local-terminal'
import { createLocalExecTool } from '@/lib/agent/tools-skilled/local-tools'
import { getAgentCredentialOptions } from '@/routes/agent/credential-options'
import { getAgentCredentialAccess } from '@/routes/agent-sessions/shared'

import { toolModuleFromAiSdkTools } from './ai-sdk-adapter'

import type { PreviewToolContext, PreviewToolModule } from '../preview-tool-context'
import type { LocalExecDevice } from '@/lib/agent/tools-skilled/local-tools'
import type { AgentRef } from '@/lib/agents/identity'

export async function resolveAvailableLocalExecDevices(
  ctx: PreviewToolContext,
): Promise<LocalExecDevice[]> {
  const agent: AgentRef = {
    userId: ctx.userId,
    sessionId: ctx.sessionId,
    ...(ctx.conversationOwnerUserId
      ? { conversationOwnerUserId: ctx.conversationOwnerUserId }
      : {}),
  }
  const [access, options] = await Promise.all([
    getAgentCredentialAccess(agent, ctx.teamId),
    getAgentCredentialOptions(ctx.teamId, ctx.userId),
  ])
  const selected = new Set(access.deviceIds)

  return options.devices
    .filter((device) => selected.has(device.deviceId))
    .map((device) => ({ deviceId: device.deviceId, label: device.label }))
}

export async function localExecToolModule(ctx: PreviewToolContext): Promise<PreviewToolModule> {
  const devices = await resolveAvailableLocalExecDevices(ctx)

  return toolModuleFromAiSdkTools({
    local_terminal: createLocalTerminalTool(devices, {
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

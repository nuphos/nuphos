// `local_cua` drives Computer Use on the owner's Mac from any runtime. The
// Codex App's own `cua_repl` runs there; Desktop relays one call per device
// tunnel stream, the way `local_exec` relays a command. The App asks before it
// touches each app; those prompts become the conversation's ordinary approval
// card, so a cloud runtime gets the same consent as a local Codex turn.
import { randomUUID } from 'node:crypto'

import { recordDeviceExecAudit } from '@/lib/agent/devices/audit'
import { tunnelBus } from '@/lib/agent/devices/local-runtime/bus'
import { runtimePresenceStore } from '@/lib/agent/devices/local-runtime/presence'
import { DeviceRuntimeSocket } from '@/lib/agent/devices/local-runtime/socket'
import { isActiveTeamMember } from '@/lib/agent/devices/store'
import { describeDevices, pickDevice } from '@/lib/agent/tools-skilled/local-tools'
import { toolError } from '@/lib/mcp/protocol'

import { handleOpenAbPermissionRequest } from '../openab-permission-bridge'
import { publishPreviewFrame } from '../run-frame-bridge'

import { resolveAvailableLocalExecDevices } from './local-exec'

import type { PreviewToolContext, PreviewToolModule } from '../preview-tool-context'
import type { DeviceExecOutcome as DeviceOutcome } from '@/lib/agent/devices/audit'
import type { ToolResult } from '@/lib/mcp/protocol'

/** Covers a human approval (two minutes) plus the call itself. */
export const LOCAL_CUA_TIMEOUT_MS = 4 * 60_000

type Args = { code: string; title?: string; timeout_ms?: number; device?: string }

type DeviceMessage =
  | { t: 'elicit'; id: string; message: string; meta: Record<string, unknown> }
  | { t: 'result'; result: ToolResult }

export type LocalCuaDeps = {
  devices: (ctx: PreviewToolContext) => Promise<{ deviceId: string; label: string }[]>
  isMember: (userId: string, teamId: string) => Promise<boolean>
  connect: (
    ctx: PreviewToolContext,
    deviceId: string,
  ) => Pick<DeviceRuntimeSocket, 'addEventListener' | 'send' | 'close' | 'connect'>
  approve: (
    ctx: PreviewToolContext,
    toolCallId: string,
    request: { message: string; meta: Record<string, unknown> },
  ) => Promise<boolean>
  publish: typeof publishPreviewFrame
  audit: typeof recordDeviceExecAudit
  timeoutMs: number
}

const definition = {
  name: 'local_cua',
  description:
    "Control native apps and browsers on the user's Mac with Computer Use: read UI state, take screenshots, click, type. " +
    "It runs JavaScript in the Codex App's `cua_repl` on that device; bindings persist between calls in this conversation until about a minute of idleness. " +
    'Start with exactly one entry call, e.g. `await cua.getState()` or `let app = await cua.getApp("Finder")`; its result documents the full API. ' +
    'The user approves each app the first time; a denied approval returns an error. ' +
    'Prefer local_exec, a CLI, or an API when one can do the job, and your own native Computer Use tool when you have one; use this only for work that needs the GUI.',
  inputSchema: {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'JavaScript to run with the initialized `cua` API.' },
      title: {
        type: 'string',
        maxLength: 80,
        description: 'Short description of what the code does.',
      },
      timeout_ms: {
        type: 'integer',
        minimum: 1,
        description: 'Execution timeout; defaults to 30000.',
      },
      device: {
        type: 'string',
        description:
          'deviceId to run on. Omit it when only one device is available; otherwise the error lists the current device ids.',
      },
    },
    required: ['code'],
    additionalProperties: false,
  },
}

const defaultDeps: LocalCuaDeps = {
  devices: resolveAvailableLocalExecDevices,
  isMember: isActiveTeamMember,
  connect: (ctx, deviceId) =>
    new DeviceRuntimeSocket(
      { userId: ctx.userId, deviceId, teamId: ctx.teamId, purpose: 'cua' },
      { bus: tunnelBus(), presence: runtimePresenceStore() },
    ),
  approve: async (ctx, toolCallId, request) => {
    const outcome = await handleOpenAbPermissionRequest({
      userId: ctx.userId,
      ...(ctx.conversationOwnerUserId
        ? { conversationOwnerUserId: ctx.conversationOwnerUserId }
        : {}),
      conversationId: ctx.sessionId,
      request: {
        sessionId: ctx.sessionId,
        toolCall: { toolCallId, title: request.message, rawInput: request.meta.tool_params },
        options: [
          { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
          { optionId: 'deny', name: 'Deny', kind: 'reject_once' },
        ],
      },
      emit: (frame) => void publishPreviewFrame(ctx, frame).catch(() => {}),
      // The card is the local_cua tool card this call already published.
      handleTool: () => {},
    })

    return outcome.outcome.outcome === 'selected' && outcome.outcome.optionId === 'allow'
  },
  publish: publishPreviewFrame,
  audit: recordDeviceExecAudit,
  timeoutMs: LOCAL_CUA_TIMEOUT_MS,
}

/** Screenshots go to the model, not into the conversation's stored frames. */
function framesOutput(result: ToolResult): unknown {
  return result.content.map((part) =>
    part.type === 'image' ? { type: 'image', mimeType: part.mimeType } : part,
  )
}

function dispatch(
  ctx: PreviewToolContext,
  deviceId: string,
  toolCallId: string,
  args: Args,
  deps: LocalCuaDeps,
): Promise<{ status: DeviceOutcome; result?: ToolResult }> {
  const socket = deps.connect(ctx, deviceId)

  return new Promise((resolve) => {
    let settled = false
    const finish = (status: DeviceOutcome, result?: ToolResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.close()
      resolve({ status, ...(result ? { result } : {}) })
    }
    const timer = setTimeout(() => {
      finish('timeout')
    }, deps.timeoutMs)

    socket.addEventListener('open', () => {
      socket.send(
        JSON.stringify({
          t: 'call',
          session: ctx.sessionId,
          // Background turns have no key; the App only needs it stable within one.
          turn: ctx.turnKey ?? ctx.sessionId,
          code: args.code,
          ...(args.title ? { title: args.title } : {}),
          ...(args.timeout_ms ? { timeoutMs: args.timeout_ms } : {}),
        }),
      )
    })
    socket.addEventListener('close', () => {
      finish('device_offline')
    })
    socket.addEventListener('message', (event) => {
      let message: DeviceMessage

      try {
        message = JSON.parse(String(event.data)) as DeviceMessage
      } catch {
        finish('error')

        return
      }
      if (message.t === 'result') {
        finish('ok', message.result)

        return
      }
      void deps
        .publish(ctx, {
          type: 'tool-input-available',
          toolCallId,
          toolName: 'local_cua',
          input: { ...args, approval: message.message },
        })
        .catch(() => {})
        .then(() => deps.approve(ctx, toolCallId, message))
        .catch(() => false)
        .then((accept) => {
          if (!settled) socket.send(JSON.stringify({ t: 'elicit-reply', id: message.id, accept }))
        })
    })
    void socket.connect()
  })
}

/** The device this call may drive, or the error that explains why none. */
async function resolveDevice(
  ctx: PreviewToolContext,
  args: Args,
  deps: LocalCuaDeps,
): Promise<string | ToolResult> {
  if (typeof args.code !== 'string' || !args.code.trim()) return toolError('code is required.')
  if (ctx.conversationOwnerUserId && ctx.conversationOwnerUserId !== ctx.userId)
    return toolError('Computer Use only runs in your own conversations.')
  const devices = await deps.devices(ctx)

  if (devices.length === 0)
    return toolError(
      "No local devices are available for this conversation. Ask the user to select their Mac in this conversation's credential selector; Nuphos Desktop must be open and signed in on it.",
    )
  const deviceId = pickDevice(devices, args.device)

  if (!deviceId) {
    const problem = args.device
      ? `Device ${args.device} is not available`
      : 'Multiple devices are available'

    return toolError(`${problem}; pass device=<deviceId>, one of: ${describeDevices(devices)}.`)
  }
  if (!(await deps.isMember(ctx.userId, ctx.teamId)))
    return toolError('You are no longer a member of this team.')

  return deviceId
}

export function createLocalCuaHandler(ctx: PreviewToolContext, deps: LocalCuaDeps = defaultDeps) {
  return async (raw: Record<string, unknown>): Promise<ToolResult> => {
    const args = raw as Args

    const target = await resolveDevice(ctx, args, deps)

    if (typeof target !== 'string') return target
    const deviceId = target

    const toolCallId = `nuphos-${randomUUID()}`
    const requestedAt = new Date()

    await deps
      .publish(ctx, {
        type: 'tool-input-available',
        toolCallId,
        toolName: 'local_cua',
        input: args,
      })
      .catch(() => {})
    const { status, result } = await dispatch(ctx, deviceId, toolCallId, args, deps)

    await deps.audit({
      ownerUserId: ctx.userId,
      deviceId,
      actorUserId: ctx.userId,
      conversationOwnerUserId: ctx.conversationOwnerUserId ?? ctx.userId,
      origin: ctx.turnOrigin ?? 'user',
      teamId: ctx.teamId,
      sessionId: ctx.sessionId,
      command: `[computer-use] ${args.code}`,
      requestedAt,
      dispatchedAt: requestedAt,
      finishedAt: new Date(),
      outcome: status,
      ...(result?.isError ? { reason: 'computer_use_error' } : {}),
    })
    const final =
      result ??
      toolError(
        status === 'timeout'
          ? 'Timed out waiting for Computer Use on the device.'
          : 'The device disconnected or does not support Computer Use (it needs Nuphos Desktop on macOS).',
      )

    await deps
      .publish(
        ctx,
        final.isError
          ? {
              type: 'tool-output-error',
              toolCallId,
              errorText: final.content
                .map((part) => (part.type === 'text' ? part.text : ''))
                .join('\n'),
            }
          : { type: 'tool-output-available', toolCallId, output: framesOutput(final) },
      )
      .catch(() => {})

    return final
  }
}

export const localCuaToolModule: PreviewToolModule = {
  definitions: [definition],
  handlers: (ctx) => ({ local_cua: createLocalCuaHandler(ctx) }),
}

// A device tool sends one call frame down the owner's device tunnel and waits
// for its result frame, answering any approval prompt the device raises on the
// way. `local_cua` and `local_browser` are the two; each only names its stream
// and frame.
import { randomUUID } from 'node:crypto'

import { recordDeviceExecAudit } from '@/lib/agent/devices/audit'
import { requireDeviceAccess } from '@/lib/agent/devices/box-access'
import { tunnelBus } from '@/lib/agent/devices/local-runtime/bus'
import { runtimePresenceStore } from '@/lib/agent/devices/local-runtime/presence'
import { DeviceRuntimeSocket } from '@/lib/agent/devices/local-runtime/socket'
import { isActiveTeamMember } from '@/lib/agent/devices/store'
import { describeDevices, pickDevice } from '@/lib/agent/tools-skilled/local-tools'
import { toolError } from '@/lib/mcp/protocol'
import { logError } from '@/lib/observability'

import { publishPreviewFrame } from '../run-frame-bridge'

import { approveAppForComputerUse } from './local-cua-approval'
import { resolveAvailableLocalExecDevices } from './local-exec'

import type { PreviewToolContext } from '../preview-tool-context'
import type { DeviceExecOutcome as DeviceOutcome } from '@/lib/agent/devices/audit'
import type { ToolResult } from '@/lib/mcp/protocol'

/** Covers a human approval (two minutes) plus the call itself. */
export const DEVICE_TOOL_TIMEOUT_MS = 4 * 60_000

type DeviceMessage =
  | { t: 'elicit'; id: string; message: string; meta: Record<string, unknown> }
  | { t: 'result'; result: ToolResult }

export type DeviceToolDeps = {
  devices: (ctx: PreviewToolContext) => Promise<{ deviceId: string; label: string }[]>
  isMember: (userId: string, teamId: string) => Promise<boolean>
  /** The device's transport owner when the actor may use it now, else null. */
  owner: (ctx: PreviewToolContext, deviceId: string) => Promise<string | null>
  connect: (
    ctx: PreviewToolContext,
    deviceId: string,
    ownerUserId: string,
    purpose: DeviceTool['purpose'],
  ) => Pick<DeviceRuntimeSocket, 'addEventListener' | 'send' | 'close' | 'connect'>
  approve: (
    ctx: PreviewToolContext,
    request: { message: string; meta: Record<string, unknown> },
  ) => Promise<boolean>
  publish: typeof publishPreviewFrame
  audit: typeof recordDeviceExecAudit
  timeoutMs: number
}

/** A tool that sends one call frame to a device and waits for its result frame. */
export type DeviceTool = {
  name: string
  /** How errors name the tool to the model. */
  label: string
  purpose: 'cua' | 'browser'
  /** Why the arguments cannot make a call, if they cannot. */
  invalid: (args: Record<string, unknown>) => string | undefined
  /** The call frame's fields beyond session and turn. */
  frame: (args: Record<string, unknown>, ctx: PreviewToolContext) => Record<string, unknown>
  /** What the device audit log records as the command. */
  audit: (args: Record<string, unknown>) => string
  errorReason: string
  noDevice: string
  unsupported: string
}

const defaultDeps: DeviceToolDeps = {
  devices: resolveAvailableLocalExecDevices,
  isMember: isActiveTeamMember,
  owner: (ctx, deviceId) =>
    requireDeviceAccess(ctx.userId, ctx.teamId, deviceId, 'use').then(
      (device) => device.userId,
      () => null,
    ),
  connect: (ctx, deviceId, ownerUserId, purpose) =>
    new DeviceRuntimeSocket(
      { userId: ownerUserId, actorId: ctx.userId, deviceId, teamId: ctx.teamId, purpose },
      { bus: tunnelBus(), presence: runtimePresenceStore() },
    ),
  approve: approveAppForComputerUse,
  publish: publishPreviewFrame,
  audit: recordDeviceExecAudit,
  timeoutMs: DEVICE_TOOL_TIMEOUT_MS,
}

/** Screenshots go to the model, not into the conversation's stored frames. */
function framesOutput(result: ToolResult): unknown {
  return result.content.map((part) =>
    part.type === 'image' ? { type: 'image', mimeType: part.mimeType } : part,
  )
}

function dispatch(
  ctx: PreviewToolContext,
  socket: ReturnType<DeviceToolDeps['connect']>,
  call: Record<string, unknown>,
  deps: DeviceToolDeps,
): Promise<{ status: DeviceOutcome; result?: ToolResult }> {
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
          ...call,
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
        .approve(ctx, message)
        .catch((error: unknown) => {
          logError('agent.local_cua.approval_failed', error, { session_id: ctx.sessionId })

          return false
        })
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
  tool: DeviceTool,
  requested: string | undefined,
  deps: DeviceToolDeps,
): Promise<string | ToolResult> {
  if (ctx.conversationOwnerUserId && ctx.conversationOwnerUserId !== ctx.userId)
    return toolError(`${tool.label} only runs in your own conversations.`)
  const devices = await deps.devices(ctx)

  if (devices.length === 0) return toolError(tool.noDevice)
  const deviceId = pickDevice(devices, requested)

  if (!deviceId) {
    const problem = requested
      ? `Device ${requested} is not available`
      : 'Multiple devices are available'

    return toolError(`${problem}; pass device=<deviceId>, one of: ${describeDevices(devices)}.`)
  }
  if (!(await deps.isMember(ctx.userId, ctx.teamId)))
    return toolError('You are no longer a member of this team.')

  return deviceId
}

export function createDeviceToolHandler(
  ctx: PreviewToolContext,
  tool: DeviceTool,
  deps: DeviceToolDeps = defaultDeps,
) {
  return async (args: Record<string, unknown>): Promise<ToolResult> => {
    const invalid = tool.invalid(args)

    if (invalid) return toolError(invalid)
    const target = await resolveDevice(
      ctx,
      tool,
      typeof args.device === 'string' ? args.device : undefined,
      deps,
    )

    if (typeof target !== 'string') return target
    const deviceId = target
    // Rechecked on every call: a revoked person loses the next action.
    const ownerUserId = await deps.owner(ctx, deviceId)

    if (!ownerUserId) return toolError('This device is not available to you.')

    const toolCallId = `nuphos-${randomUUID()}`
    const requestedAt = new Date()

    await deps
      .publish(ctx, {
        type: 'tool-input-available',
        toolCallId,
        toolName: tool.name,
        input: args,
      })
      .catch(() => {})
    const socket = deps.connect(ctx, deviceId, ownerUserId, tool.purpose)
    const { status, result } = await dispatch(ctx, socket, tool.frame(args, ctx), deps)

    await deps.audit({
      ownerUserId,
      deviceId,
      actorUserId: ctx.userId,
      conversationOwnerUserId: ctx.conversationOwnerUserId ?? ctx.userId,
      origin: ctx.turnOrigin ?? 'user',
      teamId: ctx.teamId,
      sessionId: ctx.sessionId,
      command: tool.audit(args),
      requestedAt,
      dispatchedAt: requestedAt,
      finishedAt: new Date(),
      outcome: status,
      ...(result?.isError ? { reason: tool.errorReason } : {}),
    })
    const final =
      result ??
      toolError(
        status === 'timeout'
          ? `Timed out waiting for ${tool.label} on the device.`
          : tool.unsupported,
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

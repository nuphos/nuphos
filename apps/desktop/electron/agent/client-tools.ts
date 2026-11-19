import * as k8s from '../k8s'

import { logLocalTool, normalizeToolError } from './local-exec'

import type { BrowserWindow } from 'electron'

type ClientToolInput = Record<string, unknown>

export type ClientToolExecutionResult =
  | { stdout: string; stderr: string; exitCode: number }
  | {
      ok: boolean
      info?: unknown
      forwards?: unknown[]
      error?: string
    }

function asInput(value: unknown): ClientToolInput {
  return value && typeof value === 'object' ? (value as ClientToolInput) : {}
}

export async function executeClientTool(args: {
  sessionId: string
  toolCallId: string
  toolName: string
  input: unknown
  parentWindow?: BrowserWindow | null
}): Promise<ClientToolExecutionResult> {
  const { sessionId, toolName } = args
  const input = asInput(args.input)

  logLocalTool('executing client tool', { sessionId, toolName })

  // local_exec no longer runs through this channel: the backend dispatches it
  // directly to a registered device over the presence stream (see
  // main/local-runtime/tunnel-client.ts), not as an AI SDK client tool.

  if (toolName === 'port_forward_start') {
    const target = asInput(input.target)
    const context = typeof input.context === 'string' ? input.context : null
    const namespace = typeof input.namespace === 'string' ? input.namespace : null
    const targetKind = target.kind === 'service' || target.kind === 'pod' ? target.kind : null
    const targetName = typeof target.name === 'string' ? target.name : null
    const targetPort =
      typeof target.port === 'number' && Number.isInteger(target.port) ? target.port : null
    const localPort =
      typeof input.localPort === 'number' && Number.isInteger(input.localPort) ? input.localPort : 0

    if (!context || !namespace || !targetKind || !targetName || !targetPort) {
      return { ok: false, error: 'port_forward_start: missing or invalid context/namespace/target' }
    }
    try {
      const info =
        targetKind === 'service'
          ? await k8s.startServicePortForward(context, namespace, targetName, targetPort, localPort)
          : await k8s.startPortForward(context, namespace, targetName, targetPort, localPort)

      return { ok: true, info }
    } catch (err) {
      return { ok: false, error: normalizeToolError(err) }
    }
  }

  if (toolName === 'port_forward_stop') {
    const id = typeof input.id === 'string' ? input.id : null

    if (!id) return { ok: false, error: 'port_forward_stop: missing id' }
    try {
      const exists = k8s.listPortForwards().some((f) => f.id === id)

      if (!exists) return { ok: false, error: `No active port-forward with id "${id}"` }
      k8s.stopPortForward(id)

      return { ok: true }
    } catch (err) {
      return { ok: false, error: normalizeToolError(err) }
    }
  }

  if (toolName === 'port_forward_list') {
    try {
      return { ok: true, forwards: k8s.listPortForwards() }
    } catch (err) {
      return { ok: false, error: normalizeToolError(err) }
    }
  }

  return { ok: false, error: `Unsupported client-side tool: ${toolName}` }
}

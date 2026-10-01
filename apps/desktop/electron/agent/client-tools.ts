import { uploadFiles } from '../fileTransfer'
import { resolveAttachment } from '../imageAttachment'
import * as k8s from '../k8s'

import { logLocalTool, normalizeToolError } from './local-exec'

import type { BrowserWindow } from 'electron'

// Team for each agent session (set when its stream starts) so the
// upload_attachment client tool can team-scope its transfer.
const sessionTeamId = new Map<string, string>()

export function setSessionTeam(sessionId: string, teamId: string): void {
  sessionTeamId.set(sessionId, teamId)
}

type ClientToolInput = Record<string, unknown>

export type ClientToolExecutionResult =
  | { stdout: string; stderr: string; exitCode: number }
  | {
      ok: boolean
      info?: unknown
      forwards?: unknown[]
      error?: string
      groupId?: string
      fileName?: string
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

  // Transfer an already-attached file. Auto-approved: the user
  // attached it, so transferring it on request is implied consent. The agent
  // only knows the opaque attachmentId; the local path stays in the main process.
  if (toolName === 'upload_attachment') {
    const attachmentId = typeof input.attachmentId === 'string' ? input.attachmentId : ''

    if (!attachmentId) return { ok: false, error: 'upload_attachment: missing attachmentId' }
    const filePath = await resolveAttachment(attachmentId)

    if (!filePath) {
      return {
        ok: false,
        error:
          'Attachment not available (it may be from an earlier session, or the file changed). Ask the user to re-attach the file.',
      }
    }
    const teamId = sessionTeamId.get(sessionId)

    if (!teamId) return { ok: false, error: 'upload_attachment: no team for this session' }
    try {
      const group = await uploadFiles({ teamId, sessionId, filePaths: [filePath] })
      const fileName = group.files[0]?.fileName ?? ''

      return { ok: true, groupId: group.groupId, fileName }
    } catch (err) {
      return { ok: false, error: normalizeToolError(err) }
    }
  }

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

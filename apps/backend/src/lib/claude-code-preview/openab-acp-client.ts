import { connectOpenAbAcpSocket } from './openab-acp-connect.ts'
import { OpenAbConnectionLostError, cancelSession, settlePendingCall } from './openab-acp-errors.ts'
import { OpenAbAcpLifecycle, attachmentPrompt } from './openab-acp-lifecycle.ts'
import { answerPermissionRequest } from './openab-acp-permission.ts'
import {
  ACP_INITIALIZE_PARAMS,
  acceptRuntimePrompt,
  promptMeta,
  resumeSessionAlive,
  sessionMeta,
} from './openab-acp-session.ts'
import { createCallTimer, refreshSessionTimers } from './openab-acp-timers.ts'
import { observeOpenAbSessionUpdates, routeOpenAbSessionUpdate } from './openab-acp-updates.ts'

import type { OpenAbAcpConnection } from './openab-acp-connect.ts'
import type {
  AcpHttpMcpServer,
  AcpSocket,
  OpenAbAcpClientOptions,
  OpenAbPermissionHandler,
  OpenAbSessionRuntime,
  PendingCall,
  PendingCallContext,
  PromptSessionContext,
} from './openab-acp-session.ts'
import type { OpenAbSessionUpdate } from './openab-acp-updates.ts'
import type { PreviewAgentUpdate } from './preview-agent-update.ts'
import type { PromptAttachment } from './runtime-attachments'

export type { AcpHttpMcpServer, OpenAbAcpClientOptions } from './openab-acp-session.ts'
export type { OpenAbSessionUpdate } from './openab-acp-updates.ts'
export type { PreviewAgentUpdate } from './preview-agent-update.ts'

type SocketEvent = { code?: number; data?: unknown; message?: string; reason?: string }
type JsonRpcResult = Record<string, unknown>
export class OpenAbAcpClient extends OpenAbAcpLifecycle {
  private nextId = 1
  private readonly pending = new Map<number, PendingCall>()
  private readonly sessionUpdateHandlers = new Map<
    string,
    Set<(update: OpenAbSessionUpdate) => void>
  >()
  private readonly cancelledSessions = new Set<string>()
  private disconnected = false
  private socketCloseRequested = false
  private retireTimer: ReturnType<typeof setTimeout> | undefined
  private readonly socket: AcpSocket
  private readonly callTimeoutMs: number
  private readonly promptTimeoutMs: number
  private readonly promptProgressTimeoutMs: number
  private readonly retireGraceMs: number
  private constructor(connection: OpenAbAcpConnection) {
    super()
    this.socket = connection.socket
    this.callTimeoutMs = connection.callTimeoutMs
    this.promptTimeoutMs = connection.promptTimeoutMs
    this.promptProgressTimeoutMs = connection.promptProgressTimeoutMs
    this.retireGraceMs = connection.retireGraceMs
    connection.socket.addEventListener('message', this.onMessage)
    connection.socket.addEventListener('close', this.onDisconnect)
    connection.socket.addEventListener('error', this.onDisconnect)
  }

  static async connect(options: OpenAbAcpClientOptions): Promise<OpenAbAcpClient> {
    return new OpenAbAcpClient(await connectOpenAbAcpSocket(options))
  }
  initialize(): Promise<JsonRpcResult> {
    return this.call('initialize', ACP_INITIALIZE_PARAMS, {}, this.callTimeoutMs, true)
  }
  async createSession(
    cwd: string,
    mcpServers: AcpHttpMcpServer[] = [],
    systemPrompt?: string,
    runtime?: OpenAbSessionRuntime,
  ): Promise<string> {
    const result = await this.call(
      'session/new',
      {
        cwd,
        mcpServers,
        ...sessionMeta(systemPrompt, runtime),
      },
      {},
      this.callTimeoutMs,
      true,
    )
    const sessionId = result.sessionId

    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      throw new Error('OpenAB returned an invalid ACP session id')
    }

    return sessionId
  }
  async loadSession(
    sessionId: string,
    cwd: string,
    mcpServers: AcpHttpMcpServer[] = [],
    systemPrompt?: string,
    runtime?: OpenAbSessionRuntime,
  ): Promise<{ alive: boolean }> {
    return {
      alive: resumeSessionAlive(
        await this.call(
          'session/resume',
          { sessionId, cwd, mcpServers, ...sessionMeta(systemPrompt, runtime) },
          { sessionId },
        ),
      ),
    }
  }
  onSessionUpdate(sessionId: string, handler: (update: OpenAbSessionUpdate) => void): () => void {
    return observeOpenAbSessionUpdates(
      this.sessionUpdateHandlers,
      this.cancelledSessions,
      sessionId,
      handler,
    )
  }

  prompt(
    sessionId: string,
    text: string,
    onTextDelta: (text: string) => void,
    onAgentUpdate?: (update: PreviewAgentUpdate) => void,
    onPermissionRequest?: OpenAbPermissionHandler,
    onAccepted?: () => void,
    context?: PromptSessionContext,
    attachments: PromptAttachment[] = [],
  ): Promise<JsonRpcResult> {
    this.cancelledSessions.delete(sessionId)

    return this.call(
      'session/prompt',
      attachmentPrompt(sessionId, text, attachments, promptMeta(Boolean(onAccepted), context)),
      {
        sessionId,
        onTextDelta,
        onAgentUpdate,
        onPermissionRequest,
        onAccepted,
        ...(onAccepted ? { accepted: false } : {}),
      },
      this.promptTimeoutMs,
      false,
      this.promptProgressTimeoutMs,
    )
  }
  cancel(sessionId: string, requireDelivery = false): void {
    if (this.sessionUpdateHandlers.has(sessionId)) this.cancelledSessions.add(sessionId)
    const delivered = cancelSession(this.socket, sessionId)

    this.closeRetiredTransportIfDrained()
    if (requireDelivery && !delivered) throw new Error('Failed to send runtime cancellation')
  }

  close(): void {
    this.closeSocket()
  }

  protected call(
    method: string,
    params: Record<string, unknown>,
    context: PendingCallContext = {},
    timeoutMs = this.callTimeoutMs,
    closeOnTimeout = false,
    progressWindowMs = 0,
  ): Promise<JsonRpcResult> {
    const id = this.nextId++

    return new Promise<JsonRpcResult>((resolve, reject) => {
      const onTimeout = () => {
        const owned = this.pending.get(id)?.accepted !== false

        this.pending.delete(id)
        reject(timer.timeoutError(method, Boolean(context.sessionId)))
        if (context.sessionId && owned) {
          this.cancel(context.sessionId)
          // A stall still had live frames; only silence implicates the shared socket.
          if (!timer.stalled()) this.retireTransport()
        } else if (closeOnTimeout) this.closeSocket()
      }
      const timer = createCallTimer(onTimeout, timeoutMs, progressWindowMs)

      this.pending.set(id, { resolve, reject, timer: timer.arm(), arm: timer.arm, ...context })
      this.socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
    })
  }

  private readonly onMessage = (event: SocketEvent) => {
    if (typeof event.data !== 'string') return

    let frame: unknown

    try {
      frame = JSON.parse(event.data)
    } catch {
      return
    }
    if (!frame || typeof frame !== 'object') return

    const message = frame as Record<string, unknown>

    if (this.routeRuntimeFrame(message.method, message.params)) return
    if (message.method === '_openab/session/prompt_accepted') {
      acceptRuntimePrompt(this.pending, message.params)

      return
    }
    if (message.method === 'session/update') {
      refreshSessionTimers(this.pending.values(), message.params)
      routeOpenAbSessionUpdate({
        params: message.params,
        pending: [...this.pending.values()],
        handlers: this.sessionUpdateHandlers,
        cancelledSessions: this.cancelledSessions,
      })

      return
    }

    if (message.method === 'session/request_permission' && typeof message.id === 'number') {
      void answerPermissionRequest({
        params: message.params,
        targets: [...this.pending.values()].filter((call) => call.accepted !== false),
        sessionFallback: (sessionId) => this.sessionPermissionHandler(sessionId),
        send: (result) => {
          this.socket.send(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }))
        },
      })

      return
    }

    if (typeof message.id !== 'number') return
    const pending = this.pending.get(message.id)

    if (!pending) return
    this.pending.delete(message.id)
    const observed = pending.sessionId && this.sessionUpdateHandlers.has(pending.sessionId)

    settlePendingCall(pending, message, observed ? this.cancelledSessions : undefined)
    this.closeRetiredTransportIfDrained()
  }

  private retireTransport(): void {
    if (!this.hasRetired()) {
      this.retire()
      this.retireTimer = setTimeout(() => {
        this.closeSocket()
      }, this.retireGraceMs)
    }
    this.closeRetiredTransportIfDrained()
  }

  private closeRetiredTransportIfDrained(): void {
    if (
      !this.hasRetired() ||
      this.pending.size > 0 ||
      this.disconnected ||
      this.socketCloseRequested
    )
      return
    this.closeSocket()
  }

  private closeSocket(): void {
    if (this.disconnected || this.socketCloseRequested) return
    this.socketCloseRequested = true
    if (this.retireTimer) clearTimeout(this.retireTimer)
    this.retireTimer = undefined
    this.socket.close()
  }

  private readonly onDisconnect = (event?: { reason?: string }) => {
    if (this.disconnected) return
    this.disconnected = true
    if (this.retireTimer) clearTimeout(this.retireTimer)
    this.retireTimer = undefined
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new OpenAbConnectionLostError(event?.reason, pending.accepted === true))
    }
    this.pending.clear()
    for (const handlers of this.sessionUpdateHandlers.values()) {
      for (const handler of handlers) {
        handler({ kind: 'interrupted', reason: 'runtime_connection_lost' })
      }
    }
    this.sessionUpdateHandlers.clear()
    this.cancelledSessions.clear()
    this.disconnect()
  }
}

import type { OpenAbPermissionHandler, PendingCallContext } from './openab-acp-session'
import type { PromptAttachment } from './runtime-attachments'

export type RuntimeJobRequest = {
  jobId: string
  job: string
  stdin: string
  env: Record<string, string>
  timeoutMs: number
  maxStdoutBytes: number
}

export abstract class OpenAbAcpLifecycle {
  protected abstract call(
    method: string,
    params: Record<string, unknown>,
    context?: PendingCallContext,
    timeoutMs?: number,
  ): Promise<Record<string, unknown>>

  runJob(request: RuntimeJobRequest, callTimeoutMs: number): Promise<Record<string, unknown>> {
    return this.call('_openab/runtime/job', request, {}, callTimeoutMs)
  }

  steerSession(
    sessionId: string,
    text: string,
    messageId: string,
  ): Promise<Record<string, unknown>> {
    return this.call('_openab/session/steer', {
      sessionId,
      prompt: [{ type: 'text', text }],
      messageId,
    })
  }

  getRuntimeExecutionState(): Promise<Record<string, unknown>> {
    return this.call('_openab/runtime/state', {})
  }

  /**
   * Starts the runtime's own device sign-in. The device code, then an `exited` frame
   * with the command's exit code, arrive on `onRuntimeLoginFrame`.
   */
  runtimeLogin(attemptId: string): Promise<Record<string, unknown>> {
    return this.call('_openab/runtime/login', { attemptId })
  }
  cancelRuntimeLogin(attemptId: string): Promise<Record<string, unknown>> {
    return this.call('_openab/runtime/login/cancel', { attemptId })
  }
  /** One line for the running sign-in's stdin, such as a pasted authorization code. */
  runtimeLoginInput(attemptId: string, text: string): Promise<Record<string, unknown>> {
    return this.call('_openab/runtime/login/input', { attemptId, text })
  }

  private readonly runtimeLoginHandlers = new Map<string, (frame: unknown) => void>()

  onRuntimeLoginFrame(attemptId: string, handler: (frame: unknown) => void): () => void {
    this.runtimeLoginHandlers.set(attemptId, handler)

    return () => {
      if (this.runtimeLoginHandlers.get(attemptId) === handler)
        this.runtimeLoginHandlers.delete(attemptId)
    }
  }

  protected routeRuntimeLoginFrame(params: unknown): void {
    if (!params || typeof params !== 'object') return
    const { attemptId, frame } = params as { attemptId?: unknown; frame?: unknown }

    if (typeof attemptId !== 'string') return
    this.runtimeLoginHandlers.get(attemptId)?.(frame)
  }

  sessionRequests(
    sessionId: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.call('_openab/session/requests', { ...params, sessionId })
  }
  getSessionExecutionState(sessionId: string): Promise<Record<string, unknown>> {
    return this.call('_openab/session/state', { sessionId })
  }

  getSessionConfigOptions(
    sessionId: string,
    restore?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.call('_openab/session/config_options', {
      sessionId,
      ...(restore ? { restore } : {}),
    })
  }
  setSessionConfigOption(
    sessionId: string,
    configId: string,
    value: string,
  ): Promise<Record<string, unknown>> {
    return this.call('session/set_config_option', { sessionId, configId, value })
  }

  private readonly closedHandlers = new Set<() => void>()
  private readonly retiredHandlers = new Set<() => void>()
  private readonly sessionPermissionHandlers = new Map<string, OpenAbPermissionHandler>()
  private retired = false

  onClosed(handler: () => void): () => void {
    this.closedHandlers.add(handler)

    return () => this.closedHandlers.delete(handler)
  }

  /**
   * A half-open transport can keep its socket open while dropping every ACP
   * frame. Retiring removes it from new-turn selection without closing the
   * team-shared connection out from under unrelated in-flight sessions.
   */
  onRetired(handler: () => void): () => void {
    this.retiredHandlers.add(handler)

    return () => this.retiredHandlers.delete(handler)
  }

  /**
   * Answers permission requests for one session while no prompt is pending.
   * The runtime starts turns on its own — a ScheduleWakeup firing, a
   * background task reporting back — and a governed tool call in such a turn
   * has no `session/prompt` to attach its approval to; without a handler here
   * it fails closed and the agent sees the tool aborted.
   */
  onSessionPermission(sessionId: string, handler: OpenAbPermissionHandler): () => void {
    this.sessionPermissionHandlers.set(sessionId, handler)

    return () => {
      if (this.sessionPermissionHandlers.get(sessionId) === handler) {
        this.sessionPermissionHandlers.delete(sessionId)
      }
    }
  }

  protected sessionPermissionHandler(sessionId: string): OpenAbPermissionHandler | undefined {
    return this.sessionPermissionHandlers.get(sessionId)
  }

  protected retire(): void {
    if (this.retired) return
    this.retired = true
    for (const handler of this.retiredHandlers) handler()
    this.retiredHandlers.clear()
  }

  protected hasRetired(): boolean {
    return this.retired
  }

  protected disconnect(): void {
    this.retiredHandlers.clear()
    this.sessionPermissionHandlers.clear()
    // The runtime ends a sign-in whose connection closed, so its frames stop here too.
    for (const handler of this.runtimeLoginHandlers.values())
      handler({ type: 'exited', exitCode: -1 })
    this.runtimeLoginHandlers.clear()
    for (const handler of this.closedHandlers) handler()
    this.closedHandlers.clear()
  }
}

export function attachmentPrompt(
  sessionId: string,
  text: string,
  attachments: PromptAttachment[],
  meta: Record<string, unknown>,
) {
  return { sessionId, prompt: [{ type: 'text', text }, ...attachments], ...meta }
}

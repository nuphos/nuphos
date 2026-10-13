import { AppError } from '@/lib/errors'

import { controlRegistry } from './agent-chat-registry'
import { OpenAbRpcError } from './openab-acp-errors'
import { requireRuntimeInstance } from './runtime-catalog'
import { loginFrameReader } from './runtime-login-exec'
import { runtimeProvider } from './runtime-provider'
import { resolveTeamRuntimeEndpoints } from './runtime-registry'

import type { RuntimeLoginFrame } from './runtime-login-step'
import type { RuntimeLoginDoc } from './runtime-login-store'
import type { OpenAbProvider } from './runtime-provider'
import type { TeamPreviewClient } from './team-openab-runtime'

const CODEX_LOGIN_FAILED =
  'Sign-in did not complete. Retry and check device-code login in ChatGPT security settings.'
const CLAUDE_LOGIN_FAILED =
  'Sign-in did not complete. Start again and paste the whole code Claude shows you.'
const LOGIN_FAILED: Record<OpenAbProvider, string> = {
  'claude-code': CLAUDE_LOGIN_FAILED,
  codex: CODEX_LOGIN_FAILED,
  grok: 'Sign-in did not complete. Start again and confirm the code on the xAI page.',
  antigravity:
    'Sign-in did not complete. Start again and paste the whole address your browser ended on after Google sign-in.',
  opencode: 'Sign-in did not complete. Start again and check the details you entered.',
}

async function controlEndpoint(teamId: string, runtimeId: string) {
  const { provider } = await requireRuntimeInstance(teamId, runtimeId)
  const endpoints = await resolveTeamRuntimeEndpoints(teamId, undefined, provider, 'control')
  const endpoint = endpoints.find((candidate) => candidate.runtimeId === runtimeId)

  if (!endpoint)
    throw new AppError(
      503,
      'runtime_login_unavailable',
      'This agent has no operator credential. Add one in its settings, then sign in.',
    )

  return endpoint
}

/**
 * The runtime's own refusals say what an administrator has to change; anything else is
 * the transport, and its words are not ours to repeat.
 */
function runtimeLoginError(error: unknown): AppError {
  const code = error instanceof OpenAbRpcError ? error.code : undefined

  if (code === -32601)
    return new AppError(
      503,
      'runtime_login_unavailable',
      'This agent does not offer sign-in. Update it to an agent image that supports it, or sign in inside the container.',
    )
  if (code === -32003)
    return new AppError(
      503,
      'runtime_login_unavailable',
      'This agent rejected the operator credential. Rotate it in the agent settings.',
    )

  return new AppError(
    503,
    'runtime_login_interrupted',
    'The connection to your agent was interrupted before sign-in finished. Please try again.',
  )
}

/**
 * Drive the runtime's own device sign-in over the operator channel.
 *
 * The runtime installs the credential itself and reports only that it did, so the
 * frames carry a device code and nothing else. `loginFrameReader` is fed the same
 * NDJSON it parses on the exec path, so the framing, the size cap and the fixed error
 * string are the ones already proven there. The sign-in ends with the runtime's
 * `exited` frame, or when `signal` aborts it.
 */
export async function driveControlRuntimeLogin(
  client: Pick<TeamPreviewClient, 'runtimeLogin' | 'cancelRuntimeLogin' | 'onRuntimeLoginFrame'>,
  onFrame: (frame: RuntimeLoginFrame) => void,
  signal: AbortSignal,
  doc: RuntimeLoginDoc,
  failure = CODEX_LOGIN_FAILED,
  steps = false,
): Promise<void> {
  const read = loginFrameReader(onFrame, failure, steps)
  const exited = Promise.withResolvers<number>()

  exited.promise.catch(() => {})

  const stopReading = client.onRuntimeLoginFrame(doc.attemptId, (frame) => {
    // This channel is shared, so a frame from an abandoned attempt has to be dropped
    // rather than disconnect anyone.
    if (signal.aborted) return
    const { type, exitCode } = frame as { type?: unknown; exitCode?: unknown }

    if (type === 'exited') exited.resolve(typeof exitCode === 'number' ? exitCode : -1)
    else
      try {
        read(`${JSON.stringify(frame)}\n`)
      } catch (error) {
        exited.reject(error)
      }
  })
  const cancel = () => {
    exited.reject(new Error('Runtime login cancelled'))
    void client.cancelRuntimeLogin(doc.attemptId).catch(() => {
      /* The runtime ends the sign-in when this connection drops in any case. */
    })
  }

  signal.addEventListener('abort', cancel, { once: true })
  try {
    if (signal.aborted) throw new Error('Runtime login cancelled')
    const started = await client.runtimeLogin(doc.attemptId)

    // A runtime older than 0.1.2 answers only when the command exits.
    if (typeof started.exitCode === 'number') exited.resolve(started.exitCode)
    const exitCode = await exited.promise

    // -1 is the runtime (or this channel closing) stopping the command, not its verdict.
    if (exitCode < 0) throw new Error('Runtime login stopped')
    if (exitCode !== 0) throw new AppError(422, 'runtime_login_failed', failure)
  } catch (error) {
    if (error instanceof AppError) throw error
    throw runtimeLoginError(error)
  } finally {
    signal.removeEventListener('abort', cancel)
    stopReading()
  }
}

export type ControlLoginTarget = Awaited<ReturnType<typeof controlEndpoint>>

async function execControlRuntimeLogin(
  endpoint: ControlLoginTarget,
  onFrame: (frame: RuntimeLoginFrame) => void,
  signal: AbortSignal,
  doc: RuntimeLoginDoc,
): Promise<void> {
  const client = await controlRegistry.acquire(doc.teamId, endpoint)
  const provider = runtimeProvider(endpoint.provider)

  await driveControlRuntimeLogin(
    client,
    onFrame,
    signal,
    doc,
    LOGIN_FAILED[provider],
    provider === 'opencode',
  )
}

async function sendControlRuntimeLoginInput(
  endpoint: ControlLoginTarget,
  doc: RuntimeLoginDoc,
  text: string,
): Promise<void> {
  const client = await controlRegistry.acquire(doc.teamId, endpoint)

  await client.runtimeLoginInput(doc.attemptId, text)
}

/**
 * The transport half of an external runtime's sign-in. `prepare` only locates the
 * operator channel — nobody provisioned this runtime, so there is nothing to create and
 * nothing to restart afterwards.
 */
export const controlLoginTransport = {
  prepare: (teamId: string, runtimeId: string): Promise<ControlLoginTarget> =>
    controlEndpoint(teamId, runtimeId),
  exec: execControlRuntimeLogin,
  input: sendControlRuntimeLoginInput,
}

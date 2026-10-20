import { requireDeviceAccess } from '@/lib/agent/devices/box-access'
import { parseLocalRuntimeId } from '@/lib/agent/devices/local-runtime/address'
import { commitLocalAgentInstance } from '@/lib/agent/devices/local-runtime/instances'
import { AppError } from '@/lib/errors'

import { resolveLocalRuntimeEndpoint } from './local-runtime-catalog'
import { requireRuntimeInstance } from './runtime-catalog'
import { controlLoginTransport } from './runtime-login-control'
import {
  AUTHORIZATION_FIELDS,
  claimRuntimeLogin,
  openAnswer,
  publicLogin,
  readRuntimeLogin,
  runtimeLogins,
  submitLoginCode,
} from './runtime-login-store'

import type { ControlLoginTarget } from './runtime-login-control'
import type { RuntimeLoginFrame } from './runtime-login-step'
import type { RuntimeLoginDoc, RuntimeLoginStatus } from './runtime-login-store'

const running = new Map<string, AbortController>()

export type RuntimeLoginDeps<Target> = {
  prepare: (teamId: string, runtimeId: string, userId?: string) => Promise<Target>
  exec: (
    target: Target,
    onFrame: (frame: RuntimeLoginFrame) => void,
    signal: AbortSignal,
    doc: RuntimeLoginDoc,
  ) => Promise<void>
  /** Hands the running sign-in a line the user pasted, for a flow that needs one. */
  input?: (target: Target, doc: RuntimeLoginDoc, text: string) => Promise<void>
  /** Keeps an added agent once it is signed in; defaults to its computer's host. */
  commit?: (doc: RuntimeLoginDoc) => Promise<void>
}

/** Managed, self-hosted and local runtimes own their sign-in (a local one over its
 *  computer's tunnel, into the runtime's own config dir); a development runtime is
 *  signed in where it runs. */
async function requireLocalLoginAccess(teamId: string, runtimeId: string, userId?: string) {
  const ref = parseLocalRuntimeId(runtimeId)

  if (ref) {
    if (!userId) throw new AppError(404, 'runtime_not_found', 'Agent is not available')
    const device = await requireDeviceAccess(userId, teamId, ref.deviceId, 'use')

    if (device.userId !== ref.userId)
      throw new AppError(404, 'runtime_not_found', 'Agent is not available')
  }
}

export async function requireLoginInstance(
  teamId: string,
  runtimeId: string,
  userId?: string,
): Promise<void> {
  // A computer's agent is reached through its tunnel, so one added a moment ago and
  // still signing in for the first time is found too, though nothing lists it yet.
  if (parseLocalRuntimeId(runtimeId)) {
    if (!userId) throw new AppError(404, 'runtime_not_found', 'Agent is not available')
    await resolveLocalRuntimeEndpoint(teamId, runtimeId, userId, 'login')

    return
  }
  const instance = await requireRuntimeInstance(teamId, runtimeId, userId)

  if (instance.kind !== 'external' && instance.kind !== 'managed' && instance.kind !== 'local')
    throw new AppError(
      400,
      'runtime_login_unavailable',
      'Sign in on the host that manages this agent',
    )
  if (instance.status !== 'active')
    throw new AppError(409, 'runtime_disabled', 'Enable this agent before signing in')
}

/** An added agent exists once signed in: its host keeps it from here on. */
async function commitAddedAgent(doc: RuntimeLoginDoc): Promise<void> {
  const ref = parseLocalRuntimeId(doc.runtimeId)

  if (!ref?.instanceId || !doc.userId) return
  await commitLocalAgentInstance(
    { userId: ref.userId, actorId: doc.userId, deviceId: ref.deviceId, teamId: doc.teamId },
    ref.instanceId,
  )
}

const loginDeps: RuntimeLoginDeps<ControlLoginTarget> = controlLoginTransport

/** All callbacks are fenced by the attempt ID, including cross-replica cancellation. */
export async function performRuntimeLogin<Target>(
  doc: RuntimeLoginDoc,
  deps: RuntimeLoginDeps<Target>,
): Promise<void> {
  const controller = new AbortController()

  running.set(doc.attemptId, controller)
  const filter = { _id: doc._id, attemptId: doc.attemptId }
  const timeout = setTimeout(
    () => {
      controller.abort()
    },
    Math.max(0, doc.expiresAt.getTime() - Date.now()),
  )
  let target: Target | undefined
  // A code may be submitted to any replica; the one driving the sign-in collects it.
  const deliverCode = async (sealed: string) => {
    if (target === undefined || !deps.input) return
    const taken = await runtimeLogins().updateOne(
      { ...filter, pendingCode: sealed },
      { $unset: { pendingCode: '' } },
    )

    if (taken.matchedCount) await deps.input(target, doc, openAnswer(doc.attemptId, sealed))
  }
  const cancelled = setInterval(() => {
    void runtimeLogins()
      .findOne(filter)
      .then(async (current) => {
        if (!current || current.state === 'cancelled') controller.abort()
        else if (current.pendingCode) await deliverCode(current.pendingCode)
      })
      .catch(() => {
        controller.abort()
      })
  }, 2_000)

  try {
    target = await deps.prepare(doc.teamId, doc.runtimeId, doc.userId)

    if (controller.signal.aborted) throw new Error('Sign-in cancelled')
    let authenticated = false
    let updates = Promise.resolve()
    let updateFailed = false

    await deps.exec(
      target,
      (frame) => {
        if (frame.type === 'authenticated') authenticated = true
        else if (frame.type === 'error')
          throw new AppError(422, 'runtime_login_failed', frame.message)
        else {
          // Each step replaces the one before it and takes a fresh answer.
          const update =
            frame.type === 'step'
              ? {
                  $set: { state: 'awaiting_authorization' as const, step: frame.step },
                  $unset: { codeSubmitted: '' as const },
                }
              : {
                  $set: {
                    state: 'awaiting_authorization' as const,
                    ...(frame.type === 'authorize'
                      ? { authorizationUrl: frame.url }
                      : { verificationUri: frame.verificationUri, userCode: frame.userCode }),
                  },
                }

          updates = updates
            .then(async () => {
              await runtimeLogins().updateOne(
                { ...filter, state: { $in: ['starting', 'awaiting_authorization'] } },
                update,
              )
            })
            .catch(() => {
              updateFailed = true
              controller.abort()
            })
        }
      },
      controller.signal,
      doc,
    )
    await updates
    if (!authenticated || updateFailed || controller.signal.aborted)
      throw new Error('Sign-in did not complete')
    // Connected means the agent is kept: clients list it as soon as they see this.
    await (deps.commit ?? commitAddedAgent)(doc)
    // The runtime installed the credential itself, so it is already in use.
    await runtimeLogins().updateOne(
      {
        ...filter,
        state: { $in: ['starting', 'awaiting_authorization'] },
        expiresAt: { $gt: new Date() },
      },
      { $set: { state: 'connected' }, $unset: AUTHORIZATION_FIELDS },
    )
  } catch (error) {
    await runtimeLogins().updateOne(
      { ...filter, state: { $in: ['starting', 'awaiting_authorization'] } },
      {
        $set: {
          state: 'failed',
          error:
            error instanceof AppError
              ? error.message
              : 'Sign-in could not complete. Retry, and check that the agent is running.',
        },
        $unset: AUTHORIZATION_FIELDS,
      },
    )
  } finally {
    clearTimeout(timeout)
    clearInterval(cancelled)
    controller.abort()
    running.delete(doc.attemptId)
  }
}

export async function startRuntimeLogin(
  teamId: string,
  runtimeId: string,
  userId: string,
): Promise<RuntimeLoginStatus> {
  await requireLoginInstance(teamId, runtimeId, userId)
  const doc = await claimRuntimeLogin(teamId, runtimeId, userId)

  void performRuntimeLogin(doc, loginDeps).catch(() => {
    /* Expiry bounds recovery after a database outage. */
  })

  return publicLogin(doc)
}

export async function cancelRuntimeLogin(
  teamId: string,
  runtimeId: string,
  userId: string,
  attemptId: string,
): Promise<void> {
  await requireLocalLoginAccess(teamId, runtimeId, userId)
  const doc = await readRuntimeLogin(teamId, runtimeId, userId)

  if (doc.attemptId !== attemptId)
    throw new AppError(404, 'runtime_login_not_found', 'This sign-in attempt has ended')
  const result = await runtimeLogins().updateOne(
    { _id: doc._id, attemptId, state: { $in: ['starting', 'awaiting_authorization'] } },
    {
      $set: { state: 'cancelled' },
      $unset: AUTHORIZATION_FIELDS,
    },
  )

  if (result.matchedCount) running.get(attemptId)?.abort()
}

/**
 * The `code#state` Claude's callback page shows, or the loopback address Google's
 * sign-in leaves the browser on for Antigravity. The runtime checks the port itself.
 */
export const AUTHORIZATION_CODE =
  /^(?:[\w.~-]{1,2048}#[\w.~-]{1,512}|http:\/\/(?:127\.0\.0\.1|localhost):\d{1,5}\/\?[\w.~%&=/+:-]{1,4096})$/u
const LOOPBACK_ADDRESS = /^http:\/\/(?:127\.0\.0\.1|localhost):\d{1,5}\/\S*$/u

/** Whether `answer` is what the sign-in is waiting for; the runtime checks it again. */
export function acceptsAnswer(doc: RuntimeLoginDoc, answer: string): boolean {
  const { step } = doc

  if (!step) return AUTHORIZATION_CODE.test(answer)
  if (step.kind === 'choose') return step.options.some((option) => option.value === answer)
  if (step.kind === 'browser' && step.paste === 'address') return LOOPBACK_ADDRESS.test(answer)

  return answer.length > 0
}

export async function submitRuntimeLoginCode(
  teamId: string,
  runtimeId: string,
  userId: string,
  attemptId: string,
  code: string,
): Promise<RuntimeLoginStatus> {
  await requireLoginInstance(teamId, runtimeId, userId)
  const doc = await readRuntimeLogin(teamId, runtimeId, userId)

  if (doc.attemptId !== attemptId)
    throw new AppError(404, 'runtime_login_not_found', 'This sign-in attempt has ended')
  if (!acceptsAnswer(doc, code))
    throw new AppError(
      400,
      'runtime_login_invalid_code',
      doc.step?.kind === 'choose'
        ? 'Pick one of the options shown'
        : 'Paste the whole code or address the sign-in page shows',
    )

  return submitLoginCode(doc, code)
}

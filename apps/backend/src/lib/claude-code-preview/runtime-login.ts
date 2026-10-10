import { AppError } from '@/lib/errors'

import { requireRuntimeInstance } from './runtime-catalog'
import { controlLoginTransport } from './runtime-login-control'
import {
  AUTHORIZATION_FIELDS,
  claimRuntimeLogin,
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
  prepare: (teamId: string, runtimeId: string) => Promise<Target>
  exec: (
    target: Target,
    onFrame: (frame: RuntimeLoginFrame) => void,
    signal: AbortSignal,
    doc: RuntimeLoginDoc,
  ) => Promise<void>
  /** Hands the running sign-in a line the user pasted, for a flow that needs one. */
  input?: (target: Target, doc: RuntimeLoginDoc, text: string) => Promise<void>
}

/** Managed and self-hosted runtimes both own their sign-in; a member's computer and a
 *  development runtime are signed in where they run. */
export async function requireLoginInstance(teamId: string, runtimeId: string) {
  const instance = await requireRuntimeInstance(teamId, runtimeId)

  if (instance.kind !== 'external' && instance.kind !== 'managed')
    throw new AppError(
      400,
      'runtime_login_unavailable',
      'Sign in on the host that manages this agent',
    )
  if (instance.status !== 'active')
    throw new AppError(409, 'runtime_disabled', 'Enable this agent before signing in')

  return instance
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
  const deliverCode = async (code: string) => {
    if (target === undefined || !deps.input) return
    const taken = await runtimeLogins().updateOne(
      { ...filter, pendingCode: code },
      { $unset: { pendingCode: '' } },
    )

    if (taken.matchedCount) await deps.input(target, doc, code)
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
    target = await deps.prepare(doc.teamId, doc.runtimeId)

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
  await requireLoginInstance(teamId, runtimeId)
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
  await requireLoginInstance(teamId, runtimeId)
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

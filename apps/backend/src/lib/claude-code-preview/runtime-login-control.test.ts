import { expect, test } from 'bun:test'

import { AppError } from '@/lib/errors'

import { OpenAbRpcError } from './openab-acp-errors'
import { OpenAbAcpLifecycle } from './openab-acp-lifecycle'
import { driveControlRuntimeLogin } from './runtime-login-control'

import type { RuntimeLoginFrame } from './runtime-login-step'
import type { RuntimeLoginDoc } from './runtime-login-store'

const doc = { attemptId: 'attempt-1', teamId: 'team', runtimeId: 'runtime' } as RuntimeLoginDoc
const device = {
  type: 'device' as const,
  verificationUri: 'https://auth.openai.com/codex/device',
  userCode: 'ABCD-EFGH',
}

/** A runtime that answers the call at once and reports the command's end as a frame. */
function runtime(script: {
  frames?: unknown[]
  exitCode?: number
  hold?: PromiseWithResolvers<void>
}) {
  const cancelled: string[] = []
  let deliver: ((frame: unknown) => void) | undefined

  return {
    cancelled,
    client: {
      onRuntimeLoginFrame: (attemptId: string, handler: (frame: unknown) => void) => {
        expect(attemptId).toBe(doc.attemptId)
        deliver = handler

        return () => {
          deliver = undefined
        }
      },
      cancelRuntimeLogin: (attemptId: string) => {
        cancelled.push(attemptId)
        script.hold?.resolve()

        return Promise.resolve({ cancelled: true })
      },
      runtimeLogin: (): Promise<Record<string, unknown>> => {
        void (async () => {
          await Promise.resolve()
          for (const frame of script.frames ?? []) deliver?.(frame)
          if (script.hold) {
            await script.hold.promise
            // A runtime whose sign-in was abandoned can still print its last frame.
            deliver?.({ type: 'authenticated' })
          }
          deliver?.({ type: 'exited', exitCode: script.exitCode ?? 0 })
        })()

        return Promise.resolve({ started: true })
      },
    },
  }
}

test('the device code crosses the wire and the credential does not', async () => {
  const frames: RuntimeLoginFrame[] = []
  const { client } = runtime({ frames: [device, { type: 'authenticated' }] })

  await driveControlRuntimeLogin(
    client,
    (frame) => frames.push(frame),
    new AbortController().signal,
    doc,
  )
  expect(frames).toEqual([device, { type: 'authenticated' }])
})

test('a runtime that hands back a credential fails the sign-in', async () => {
  const frames: RuntimeLoginFrame[] = []
  const { client } = runtime({ frames: [{ type: 'authenticated', authJson: 'leaked' }] })

  await expect(
    driveControlRuntimeLogin(
      client,
      (frame) => frames.push(frame),
      new AbortController().signal,
      doc,
    ),
  ).rejects.toMatchObject({ status: 503 })
  expect(frames).toEqual([])
})

test('a non-zero exit is the fixed provider-agnostic failure, not the runtime words', async () => {
  const { client } = runtime({ exitCode: 3 })

  await expect(
    driveControlRuntimeLogin(client, () => {}, new AbortController().signal, doc),
  ).rejects.toMatchObject({
    status: 422,
    code: 'runtime_login_failed',
    message:
      'Sign-in did not complete. Retry and check device-code login in ChatGPT security settings.',
  })
})

test("a runtime's explained failure wins over its exit code", async () => {
  const { client } = runtime({
    frames: [{ type: 'error', reason: 'input_unavailable' }],
    exitCode: 1,
  })

  await expect(
    driveControlRuntimeLogin(
      client,
      (frame) => {
        if (frame.type === 'error') throw new AppError(422, 'runtime_login_failed', frame.message)
      },
      new AbortController().signal,
      doc,
      'Claude failure',
    ),
  ).rejects.toMatchObject({ status: 422, message: expect.stringContaining('claude auth login') })
  const { client: silent } = runtime({ exitCode: 1 })

  await expect(
    driveControlRuntimeLogin(silent, () => {}, new AbortController().signal, doc, 'Claude failure'),
  ).rejects.toMatchObject({ status: 422, message: 'Claude failure' })
})

test('a refusal the operator can act on says so; anything else does not', async () => {
  const refusals = [
    [-32601, 503, 'runtime_login_unavailable'],
    [-32003, 503, 'runtime_login_unavailable'],
    // A code with no advice of its own, and a transport failure, both land on the
    // generic message — the runtime's own words are not ours to repeat.
    [-32000, 503, 'runtime_login_interrupted'],
  ] as const

  for (const [code, status, error] of refusals) {
    const { client } = runtime({})

    client.runtimeLogin = () => Promise.reject(new OpenAbRpcError('runtime words', code))
    await expect(
      driveControlRuntimeLogin(client, () => {}, new AbortController().signal, doc),
    ).rejects.toMatchObject({ status, code: error })
  }
  const { client } = runtime({})

  client.runtimeLogin = () => Promise.reject(new Error('socket closed'))
  await expect(
    driveControlRuntimeLogin(client, () => {}, new AbortController().signal, doc),
  ).rejects.toMatchObject({ status: 503, code: 'runtime_login_interrupted' })
})

test('cancelling tells the runtime to stop and detaches the reader', async () => {
  const hold = Promise.withResolvers<void>()
  const controller = new AbortController()
  const frames: RuntimeLoginFrame[] = []
  const { client, cancelled } = runtime({ frames: [device], hold })
  const login = driveControlRuntimeLogin(
    client,
    (frame) => {
      frames.push(frame)
      controller.abort()
    },
    controller.signal,
    doc,
  )

  await expect(login).rejects.toMatchObject({ code: 'runtime_login_interrupted' })
  expect(cancelled).toEqual([doc.attemptId])
  // Only the device frame: the `authenticated` frame the runtime emits after the cancel
  // arrives once the handler is gone, so it can never revive an abandoned attempt.
  expect(frames).toEqual([device])
})

test('a runtime older than 0.1.2 that answers only on exit still completes', async () => {
  const frames: RuntimeLoginFrame[] = []
  const { client } = runtime({})

  client.runtimeLogin = () => Promise.resolve({ exitCode: 0 })
  await driveControlRuntimeLogin(
    client,
    (frame) => frames.push(frame),
    new AbortController().signal,
    doc,
  )
  expect(frames).toEqual([])
})

test('a sign-in waits for the runtime to report its end, however long that takes', async () => {
  let deliver: ((frame: unknown) => void) | undefined
  let settled = false
  const login = driveControlRuntimeLogin(
    {
      onRuntimeLoginFrame: (_attemptId, handler) => {
        deliver = handler

        return () => undefined
      },
      cancelRuntimeLogin: () => Promise.resolve({}),
      runtimeLogin: () => Promise.resolve({ started: true }),
    },
    () => {},
    new AbortController().signal,
    doc,
  ).finally(() => {
    settled = true
  })

  await Bun.sleep(10)
  expect(settled).toBe(false)
  deliver?.({ type: 'exited', exitCode: 0 })
  await login
})

test('a closed control connection ends the sign-in it was carrying', async () => {
  class Channel extends OpenAbAcpLifecycle {
    protected call(): Promise<Record<string, unknown>> {
      return Promise.resolve({ started: true })
    }
    close() {
      this.disconnect()
    }
  }
  const channel = new Channel()
  const login = driveControlRuntimeLogin(channel, () => {}, new AbortController().signal, doc)

  await Promise.resolve()
  channel.close()
  await expect(login).rejects.toMatchObject({ status: 503, code: 'runtime_login_interrupted' })
})

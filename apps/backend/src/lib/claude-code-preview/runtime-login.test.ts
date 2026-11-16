import { beforeEach, expect, setSystemTime, test } from 'bun:test'

import { AppError } from '@/lib/errors'
import { useDb } from '@/lib/test/doubles/db'

import { cancelRuntimeLogin, performRuntimeLogin } from './runtime-login'

import type { RuntimeLoginDeps } from './runtime-login'
import { loginFrameReader } from './runtime-login-exec'
import { resetBeforeSignIn } from './runtime-login-signer'
import {
  claimRuntimeLogin,
  publicLogin,
  readRuntimeLogin,
  runtimeLoginKey,
  submitLoginCode,
} from './runtime-login-store'

import type { RuntimeLoginDoc } from './runtime-login-store'
import type { RemovableAgent } from '@/lib/agent/devices/local-runtime/protocol'
import type { AgentResetResult } from '@/lib/agent/devices/pending-resets'

type Query = Record<string, unknown>
let docs: RuntimeLoginDoc[] = []
// Pipeline updates go to a computer's record: who signed its agent in; array-filtered ones end it.
const computers: { query: Query; update: unknown }[] = []
const ended: unknown[] = []
// A newer sign-in is on record, so the fenced write of an older one matches nothing.
let newer = false

function matches(doc: RuntimeLoginDoc, query: Query): boolean {
  return Object.entries(query).every(([field, value]) => {
    if (field === '$or') return (value as Query[]).some((branch) => matches(doc, branch))
    const actual = field
      .split('.')
      .reduce<unknown>((object, key) => (object as Query | undefined)?.[key], doc)

    if (value && typeof value === 'object' && !(value instanceof Date)) {
      const op = value as {
        $in?: unknown[]
        $gt?: Date
        $lt?: Date
        $exists?: boolean
        $ne?: unknown
      }

      if (op.$exists !== undefined) return (actual !== undefined) === op.$exists
      if ('$ne' in op) return actual !== op.$ne
      if (op.$in) return op.$in.includes(actual)
      if (op.$gt) return (actual as Date) > op.$gt
      if (op.$lt) return (actual as Date) < op.$lt
    }

    return actual === value
  })
}
useDb({
  db: () => ({
    collection: () => ({
      findOne: (query: Query) =>
        Promise.resolve(structuredClone(docs.find((doc) => matches(doc, query)) ?? null)),
      replaceOne: (query: Query, replacement: RuntimeLoginDoc) => {
        docs = docs.filter((doc) => !matches(doc, query))
        docs.push(structuredClone(replacement))

        return Promise.resolve({ matchedCount: 1 })
      },
      updateOne: (
        query: Query,
        update: { $set?: Partial<RuntimeLoginDoc>; $unset?: Query },
        options?: { arrayFilters?: unknown[] },
      ) => {
        // Ending one sign-in on a computer: matched on that record while it is current.
        const signIn = (query.signIns as { $elemMatch?: unknown } | undefined)?.$elemMatch

        if (options?.arrayFilters || signIn) {
          ended.push(signIn ?? options?.arrayFilters?.[0])

          return Promise.resolve({ matchedCount: 1 })
        }
        if (Array.isArray(update)) {
          computers.push({ query, update })

          return Promise.resolve({ matchedCount: newer ? 0 : 1 })
        }
        const doc = docs.find((entry) => matches(entry, query))

        if (doc) {
          Object.assign(doc, update.$set)
          for (const field of Object.keys(update.$unset ?? {}))
            delete doc[field as keyof RuntimeLoginDoc]
        }

        return Promise.resolve({ matchedCount: doc ? 1 : 0 })
      },
    }),
  }),
})
beforeEach(() => {
  docs = []
  computers.length = 0
  ended.length = 0
  newer = false
})

const device = {
  type: 'device' as const,
  verificationUri: 'https://auth.openai.com/codex/device',
  userCode: 'ABCD-EFGH',
}

function dependencies() {
  const prepared: string[] = []
  const deps: RuntimeLoginDeps<{ runtimeId: string }> = {
    prepare: (_teamId, runtimeId) => {
      prepared.push(runtimeId)

      return Promise.resolve({ runtimeId })
    },
    exec: (_target, emit) => {
      emit(device)
      emit({ type: 'authenticated' })

      return Promise.resolve()
    },
  }

  return { deps, prepared }
}

test('the newest sign-in replaces the one before it, whoever started it', async () => {
  const first = await claimRuntimeLogin('team-a', 'runtime-a', 'admin')
  const second = await claimRuntimeLogin('team-a', 'runtime-a', 'other')

  expect(second.attemptId).not.toBe(first.attemptId)
  expect(docs).toHaveLength(1)
  expect((await readRuntimeLogin('team-a', 'runtime-a', 'other')).attemptId).toBe(second.attemptId)
  await expect(readRuntimeLogin('team-a', 'runtime-a', 'admin')).rejects.toMatchObject({
    status: 404,
  })
  await expect(readRuntimeLogin('team-b', 'runtime-a', 'other')).rejects.toMatchObject({
    status: 404,
  })
  expect(runtimeLoginKey('team-a', 'runtime-a')).not.toBe(runtimeLoginKey('team-b', 'runtime-a'))
})

test('parallel logins each connect only their selected instance', async () => {
  const a = await claimRuntimeLogin('team-a', 'codex-work', 'admin')
  const b = await claimRuntimeLogin('team-a', 'codex-personal', 'admin')
  const { deps, prepared } = dependencies()

  await Promise.all([performRuntimeLogin(a, deps), performRuntimeLogin(b, deps)])
  expect(prepared.toSorted((a, b) => a.localeCompare(b))).toEqual(['codex-personal', 'codex-work'])
  for (const doc of docs) {
    expect(publicLogin(doc).state).toBe('connected')
    expect(publicLogin(doc).userCode).toBeUndefined()
  }
})

test('a pasted Claude code reaches the runtime once, and no copy of it outlives the sign-in', async () => {
  const doc = await claimRuntimeLogin('team', 'runtime', 'admin')
  const { deps } = dependencies()
  const delivered: string[] = []
  const received = Promise.withResolvers<void>()
  const url = 'https://claude.com/cai/oauth/authorize?code=true&state=s'

  deps.exec = async (_target, emit) => {
    emit({ type: 'authorize', url })
    await received.promise
    emit({ type: 'authenticated' })
  }
  deps.input = (_target, attempt, text) => {
    expect(attempt.attemptId).toBe(doc.attemptId)
    delivered.push(text)
    received.resolve()

    return Promise.resolve()
  }
  const login = performRuntimeLogin(doc, deps)

  while (!docs[0]?.authorizationUrl) await Bun.sleep(5)
  const shown = publicLogin(docs[0])

  expect(shown).toMatchObject({ state: 'awaiting_authorization', authorizationUrl: url })
  expect(shown.userCode).toBeUndefined()
  expect(await submitLoginCode(docs[0], 'the-code#the-state')).toMatchObject({
    codeSubmitted: true,
  })
  expect(JSON.stringify(docs[0])).not.toContain('the-code')
  expect(JSON.stringify(publicLogin(docs[0]))).not.toContain('the-code')
  // One code per attempt: the CLI exits on a rejected one, so a retry is a new sign-in.
  await expect(submitLoginCode(docs[0], 'another#code')).rejects.toMatchObject({ status: 409 })
  await login

  expect(delivered).toEqual(['the-code#the-state'])
  expect(docs[0]?.state).toBe('connected')
  expect(JSON.stringify(docs[0])).not.toContain('the-code')
  expect(docs[0]?.authorizationUrl).toBeUndefined()
})

test('a code is refused once the sign-in stops waiting for one', async () => {
  const doc = await claimRuntimeLogin('team', 'runtime', 'admin')

  await expect(submitLoginCode(doc, 'code#state')).rejects.toMatchObject({
    status: 409,
    code: 'runtime_login_not_waiting',
  })
  docs[0]!.state = 'awaiting_authorization'
  docs[0]!.userCode = 'ABCD-EFGH'
  // A device flow has nothing to paste.
  await expect(submitLoginCode(docs[0]!, 'code#state')).rejects.toMatchObject({ status: 409 })
})

test('cancel keeps a sign-in that finishes afterwards from reporting success', async () => {
  const doc = await claimRuntimeLogin('team', 'runtime', 'admin')
  const { deps } = dependencies()

  deps.exec = async (_target, emit) => {
    emit(device)
    await cancelRuntimeLogin('team', 'runtime', 'admin', doc.attemptId)
    emit({ type: 'authenticated' })
  }
  await performRuntimeLogin(doc, deps)
  expect(docs[0]?.state).toBe('cancelled')
})

test('replacement and expired attempts cannot overwrite the new attempt status', async () => {
  const doc = await claimRuntimeLogin('team', 'runtime', 'admin')
  const { deps } = dependencies()

  deps.exec = async (_target, emit) => {
    docs[0]!.expiresAt = new Date(0)
    await claimRuntimeLogin('team', 'runtime', 'admin')
    emit({ type: 'authenticated' })
  }
  await performRuntimeLogin(doc, deps)
  expect(docs[0]?.attemptId).not.toBe(doc.attemptId)
  expect(docs[0]?.state).toBe('starting')
})

test('a runtime that cannot be prepared fails without exposing why', async () => {
  const doc = await claimRuntimeLogin('team', 'runtime', 'admin')
  const { deps } = dependencies()

  deps.prepare = () => Promise.reject(new Error('private-provider-secret'))
  await performRuntimeLogin(doc, deps)
  expect(docs[0]?.state).toBe('failed')
  expect(JSON.stringify(publicLogin(docs[0]!))).not.toContain('private-provider-secret')
})

test('private protocol handles chunk boundaries and only allows the official device URL', () => {
  const frames: unknown[] = []
  const consume = loginFrameReader((frame) => frames.push(frame))
  const line = JSON.stringify(device)

  consume(line.slice(0, 12))
  consume(`${line.slice(12)}\n`)
  expect(frames).toEqual([device])
  expect(() =>
    consume(`${JSON.stringify({ ...device, verificationUri: 'https://evil.example' })}\n`),
  ).toThrow('Invalid login response')
  expect(() => loginFrameReader(() => {})('x'.repeat(128 * 1024 + 1))).toThrow(
    'Invalid login response',
  )
})

test('a runtime reports its sign-in without carrying the credential', () => {
  const frames: unknown[] = []
  const read = loginFrameReader((frame) => frames.push(frame))

  read(`${JSON.stringify({ type: 'authenticated' })}\n`)
  expect(frames).toEqual([{ type: 'authenticated' }])
  // Accepting a credential here would let the runtime decide that Nuphos stores a copy.
  expect(() => read(`${JSON.stringify({ type: 'authenticated', authJson: 'leaked' })}\n`)).toThrow(
    'Invalid login response',
  )
  expect(frames).toHaveLength(1)
})

test('a pasted sign-in result is a Claude code or a loopback callback, nothing else', async () => {
  const { AUTHORIZATION_CODE } = await import('./runtime-login-step')

  for (const ok of [
    'the-code#the-state',
    'http://127.0.0.1:51881/?state=s&code=4/0Ab-c_d&scope=https://www.googleapis.com/auth/cloud-platform',
    'http://localhost:51881/?state=s&code=4%2F0Ab',
  ])
    expect(AUTHORIZATION_CODE.test(ok)).toBe(true)
  for (const bad of [
    'https://127.0.0.1:51881/?code=x',
    'http://evil.example:51881/?code=x',
    'http://127.0.0.1:51881/?code=x y',
    'the code',
  ])
    expect(AUTHORIZATION_CODE.test(bad)).toBe(false)
})

test('a stepped sign-in takes one answer per step, each checked against that step', async () => {
  const { acceptsAnswer } = await import('./runtime-login-step')
  const doc = await claimRuntimeLogin('team', 'runtime', 'admin')
  const { deps } = dependencies()
  const delivered: string[] = []
  const answered = [Promise.withResolvers<void>(), Promise.withResolvers<void>()]

  deps.exec = async (_target, emit) => {
    emit({
      type: 'step',
      step: {
        kind: 'choose',
        message: 'Choose a model provider',
        options: [
          { value: 'openai', label: 'OpenAI' },
          { value: 'groq', label: 'Groq' },
        ],
      },
    })
    await answered[0]!.promise
    emit({ type: 'step', step: { kind: 'input', message: 'Groq API key', secret: true } })
    await answered[1]!.promise
    emit({ type: 'authenticated' })
  }
  deps.input = (_target, _attempt, text) => {
    answered[delivered.push(text) - 1]!.resolve()

    return Promise.resolve()
  }
  const login = performRuntimeLogin(doc, deps)

  const kind = () => docs[0]?.step?.kind

  while (kind() !== 'choose') await Bun.sleep(5)
  expect(publicLogin(docs[0]!).step).toMatchObject({ kind: 'choose' })
  expect(acceptsAnswer(docs[0]!, 'anthropic')).toBe(false)
  await submitLoginCode(docs[0]!, 'groq')
  while (kind() !== 'input') await Bun.sleep(5)
  // A new step waits for its own answer.
  expect(publicLogin(docs[0]!).codeSubmitted).toBeUndefined()
  await submitLoginCode(docs[0]!, 'gsk-secret')
  // Stored sealed while the attempt runs, not only gone once it ends.
  expect(docs[0]!.pendingCode).toBeString()
  expect(JSON.stringify(docs[0])).not.toContain('gsk-secret')
  expect(JSON.stringify(publicLogin(docs[0]!))).not.toContain('gsk-secret')
  await login

  expect(delivered).toEqual(['groq', 'gsk-secret'])
  expect(docs[0]?.state).toBe('connected')
  expect(JSON.stringify(docs[0])).not.toContain('gsk-secret')
  expect(docs[0]?.step).toBeUndefined()
})

test('a page OpenCode watches itself takes no answer; one that ends on loopback takes its address', async () => {
  const { acceptsAnswer } = await import('./runtime-login-step')
  const doc = await claimRuntimeLogin('team', 'runtime', 'admin')
  const browser = { kind: 'browser' as const, url: 'https://github.com/login/device' }

  docs[0]!.state = 'awaiting_authorization'
  docs[0]!.step = browser
  await expect(submitLoginCode(docs[0]!, 'anything')).rejects.toMatchObject({ status: 409 })
  docs[0]!.step = { ...browser, paste: 'address' }
  expect(acceptsAnswer(docs[0]!, 'http://localhost:1455/auth/callback?code=c')).toBe(true)
  expect(acceptsAnswer(docs[0]!, 'https://evil.example/?code=c')).toBe(false)
  expect(
    await submitLoginCode(docs[0]!, 'http://localhost:1455/auth/callback?code=c'),
  ).toMatchObject({ codeSubmitted: true })
  expect(doc.attemptId).toBe(docs[0]!.attemptId)
})

test('a sealed answer opens only for the attempt it was sealed for', async () => {
  const { openAnswer, sealAnswer } = await import('./runtime-login-store')
  const sealed = sealAnswer('attempt-1', 'AKIA-secret')

  expect(sealed).not.toContain('AKIA')
  expect(openAnswer('attempt-1', sealed)).toBe('AKIA-secret')
  expect(() => openAnswer('attempt-2', sealed)).toThrow()
  expect(sealAnswer('attempt-1', 'AKIA-secret')).not.toBe(sealed)
})

test('an added agent is kept before its sign-in reads connected, and a failed keep fails it', async () => {
  const doc = await claimRuntimeLogin('team', 'runtime', 'admin')
  const { deps } = dependencies()
  const seen: (string | undefined)[] = []

  deps.commit = async () => {
    seen.push(docs[0]?.state)
  }
  await performRuntimeLogin(doc, deps)
  expect(seen).toEqual(['awaiting_authorization'])
  expect(docs[0]?.state).toBe('connected')

  const retry = await claimRuntimeLogin('team', 'runtime', 'admin')

  deps.commit = () => Promise.reject(new Error('The agent is not signed in yet'))
  await performRuntimeLogin(retry, deps)
  expect(docs[0]?.state).toBe('failed')
})

test('a computer keeps who signed its agent in; a sign-out leaves that record', async () => {
  const runtimeId = 'local_host_box_codex'
  const { deps } = dependencies()

  deps.commit = () => Promise.resolve()
  deps.manages = () => Promise.resolve(true)
  await performRuntimeLogin(await claimRuntimeLogin('team', runtimeId, 'lead'), deps)
  expect(ended).toEqual([])
  deps.exec = (_target, emit) => {
    emit({ type: 'signedOut' })

    return Promise.resolve()
  }
  await performRuntimeLogin(await claimRuntimeLogin('team', runtimeId, 'lead'), deps)

  // Removing an API key can leave the account it signed in, so the sign-out records nothing.
  expect(computers.map(({ query }) => query)).toMatchObject([{ userId: 'host', deviceId: 'box' }])
  expect(JSON.stringify(computers[0]?.update)).toContain(
    '"agent":"codex","userId":"lead","teamId":"team"',
  )
  // A team's own agent has no computer to note it on.
  computers.length = 0
  await performRuntimeLogin(
    await claimRuntimeLogin('team', 'runtime', 'admin'),
    dependencies().deps,
  )
  expect(computers).toEqual([])
})

test('an account installed before a failed keep is still recorded, so it can be ended', async () => {
  const { deps } = dependencies()

  deps.manages = () => Promise.resolve(true)
  deps.commit = () => Promise.reject(new Error('The host did not answer'))
  await performRuntimeLogin(await claimRuntimeLogin('team', 'local_host_box_codex', 'lead'), deps)

  expect(docs[0]?.state).toBe('failed')
  expect(JSON.stringify(computers[0]?.update)).toContain('"userId":"lead"')
})

/** A host that answers each reset with `result`, or refuses it. */
function resetter(result: AgentResetResult | Error = { state: 'done' }) {
  const asked: { device: unknown; agent: RemovableAgent; by: unknown }[] = []
  const reset = async (
    { userId, deviceId }: { userId: string; deviceId: string },
    agent: RemovableAgent,
    by: { actorId: string; teamId: string },
  ) => {
    asked.push({ device: { userId, deviceId }, agent, by })
    if (result instanceof Error) throw result

    return result
  }

  return { asked, reset }
}

test('a sign-in completed by someone who stopped managing the computer meanwhile ends at once', async () => {
  const { deps } = dependencies()
  const { asked, reset } = resetter()
  const at = new Date('2026-11-13T00:00:00Z')

  deps.commit = () => Promise.resolve()
  deps.manages = () => Promise.resolve(false)
  deps.reset = reset
  const doc = await claimRuntimeLogin('team', 'local_host_box_codex', 'lead')

  // The computer's record, as the sign-in left it.
  docs.push({
    userId: 'host',
    deviceId: 'box',
    signIns: [{ agent: 'codex', userId: 'lead', teamId: 'team', at }],
  } as unknown as RuntimeLoginDoc)
  await performRuntimeLogin(doc, deps)

  expect(computers).toHaveLength(1)
  expect(ended).toEqual([{ agent: 'codex', at, endedAt: { $exists: false } }])
  // Its agent is reset too, as the computer's owner.
  expect(asked).toEqual([
    {
      device: { userId: 'host', deviceId: 'box' },
      agent: { provider: 'codex' },
      by: { actorId: 'host', teamId: 'team' },
    },
  ])
})

test('a sign-in is kept as of when the runtime reported it, and a newer one is not overwritten', async () => {
  const { deps } = dependencies()
  const { asked, reset } = resetter()
  const reported = new Date('2026-11-13T00:00:00Z')

  deps.commit = () => Promise.resolve()
  deps.manages = () => Promise.resolve(false)
  deps.reset = reset
  deps.exec = async (_target, emit) => {
    setSystemTime(reported)
    emit({ type: 'authenticated' })
    setSystemTime()
  }
  newer = true
  await performRuntimeLogin(await claimRuntimeLogin('team', 'local_host_box_codex', 'lead'), deps)

  expect(computers[0]?.query).toEqual({
    userId: 'host',
    deviceId: 'box',
    signIns: { $not: { $elemMatch: { agent: 'codex', at: { $gt: reported } } } },
  })
  // The newer sign-in has its own signer checked, so this one ends nothing of it.
  expect(ended).toEqual([])
  expect(asked).toEqual([])
  expect(docs[0]?.state).toBe('connected')
})

test("a computer's agent is reset before it signs in; an older host signs in as before", async () => {
  const start = (reset: ReturnType<typeof resetter>['reset'], runtimeId = 'local_host_box_codex') =>
    resetBeforeSignIn('team', runtimeId, 'lead', reset, async () => true)
  const done = resetter()
  const id = '3f8b2a8e-6a55-4b8e-9f0e-0c6f3a1d2b4c'

  await start(done.reset)
  await start(done.reset, `local_host_box_opencode_${id}`)
  expect(done.asked).toEqual([
    {
      device: { userId: 'host', deviceId: 'box' },
      agent: { provider: 'codex' },
      by: { actorId: 'lead', teamId: 'team' },
    },
    {
      device: { userId: 'host', deviceId: 'box' },
      agent: { instanceId: id },
      by: { actorId: 'lead', teamId: 'team' },
    },
  ])
  // Queued for a host too old to reset now: it signs in over what it holds.
  await start(resetter({ state: 'queued', why: 'unsupported' }).reset)
  // A team's own agent has no computer to reset.
  await start(done.reset, 'runtime')
  expect(done.asked).toHaveLength(2)
})

test("a person's own computer's default agent signs in without a reset; its added agents reset", async () => {
  const done = resetter()
  const id = '3f8b2a8e-6a55-4b8e-9f0e-0c6f3a1d2b4c'
  const notABox = async () => false

  // Its host never resets the person's own CLI login, and would refuse, failing the sign-in.
  await resetBeforeSignIn('team', 'local_host_mac_opencode', 'lead', done.reset, notABox)
  await resetBeforeSignIn('team', 'local_host_mac_grok', 'lead', done.reset, notABox)
  // Nor a Box's Antigravity, whose sign-in is the OS keyring.
  await resetBeforeSignIn(
    'team',
    'local_host_box_antigravity',
    'lead',
    done.reset,
    async () => true,
  )
  expect(done.asked).toEqual([])
  await resetBeforeSignIn('team', `local_host_mac_opencode_${id}`, 'lead', done.reset, notABox)
  expect(done.asked).toEqual([
    {
      device: { userId: 'host', deviceId: 'mac' },
      agent: { instanceId: id },
      by: { actorId: 'lead', teamId: 'team' },
    },
  ])
})

test('a sign-in does not start while its computer cannot reset the agent', async () => {
  await expect(
    resetBeforeSignIn(
      'team',
      'local_host_box_codex',
      'lead',
      resetter({ state: 'queued', why: 'offline' }).reset,
      async () => true,
    ),
  ).rejects.toMatchObject({ status: 409, code: 'runtime_offline' })
  const refusal = new AppError(409, 'agent_instance_failed', 'The agent could not be stopped')

  await expect(
    resetBeforeSignIn(
      'team',
      'local_host_box_codex',
      'lead',
      resetter(refusal).reset,
      async () => true,
    ),
  ).rejects.toBe(refusal)
})

test('an API key replaces the device sign-in, sealed until the runtime takes it', async () => {
  const { acceptsAnswer } = await import('./runtime-login-step')
  const doc = await claimRuntimeLogin('team', 'runtime', 'admin')
  const { deps } = dependencies()
  const key = 'sk-proj-not-a-real-key-0123456789'
  const delivered: string[] = []
  const answered = Promise.withResolvers<void>()

  deps.exec = async (_target, emit) => {
    emit(device)
    await answered.promise
    emit({ type: 'authenticated' })
  }
  deps.input = (_target, _attempt, text) => {
    delivered.push(text)
    answered.resolve()

    return Promise.resolve()
  }
  const login = performRuntimeLogin(doc, deps)

  while (docs[0]?.state !== 'awaiting_authorization') await Bun.sleep(5)
  expect(acceptsAnswer(docs[0]!, 'sk-short')).toBe(false)
  expect(acceptsAnswer(docs[0]!, `${key} extra`)).toBe(false)
  await submitLoginCode(docs[0]!, key)
  expect(JSON.stringify(docs[0])).not.toContain(key)
  await login

  expect(delivered).toEqual([key])
  expect(docs[0]?.state as string).toBe('connected')
  expect(JSON.stringify(docs[0])).not.toContain(key)
})

test('removing an API key ends as signed out, not connected', async () => {
  const { acceptsAnswer } = await import('./runtime-login-step')
  const doc = await claimRuntimeLogin('team', 'runtime', 'admin')
  const { deps } = dependencies()
  let committed = false
  const answered = Promise.withResolvers<void>()

  deps.commit = () => {
    committed = true

    return Promise.resolve()
  }
  deps.exec = async (_target, emit) => {
    emit(device)
    await answered.promise
    emit({ type: 'signedOut' })
  }
  deps.input = () => {
    answered.resolve()

    return Promise.resolve()
  }
  const login = performRuntimeLogin(doc, deps)

  while (docs[0]?.state !== 'awaiting_authorization') await Bun.sleep(5)
  expect(acceptsAnswer(docs[0]!, 'sign-out')).toBe(true)
  await submitLoginCode(docs[0]!, 'sign-out')
  await login

  expect(docs[0]?.state as string).toBe('signed_out')
  expect(publicLogin(docs[0]!).userCode).toBeUndefined()
  expect(committed).toBe(false)
})

import { beforeEach, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

import { cancelRuntimeLogin, performRuntimeLogin } from './runtime-login'

import type { RuntimeLoginDeps } from './runtime-login'
import { loginFrameReader } from './runtime-login-exec'
import {
  claimRuntimeLogin,
  publicLogin,
  readRuntimeLogin,
  runtimeLoginKey,
  submitLoginCode,
} from './runtime-login-store'

import type { RuntimeLoginDoc } from './runtime-login-store'

type Query = Record<string, unknown>
let docs: RuntimeLoginDoc[] = []

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
      updateOne: (query: Query, update: { $set?: Partial<RuntimeLoginDoc>; $unset?: Query }) => {
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
  const { AUTHORIZATION_CODE } = await import('./runtime-login')

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
  const { acceptsAnswer } = await import('./runtime-login')
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
  const { acceptsAnswer } = await import('./runtime-login')
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

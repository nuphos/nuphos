import { beforeEach, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'

import { OpenAbConnectionLostError, OpenAbRpcError } from './openab-acp-errors'
import { authRefusedRuntimes, forgetAuthRefusal, noteTurnSignIn } from './runtime-auth-refusal'

import { nudgeDeps } from '@/lib/agent/sign-in-request'
import { unavailableReason } from '@/lib/agent/thread-runtime'

type Row = { teamId: string; runtimeId: string }
const rows: Row[] = []
const key = (row: Row) => `${row.teamId}/${row.runtimeId}`
const collection = {
  updateOne: (filter: Row) => {
    if (!rows.some((row) => key(row) === key(filter))) rows.push({ ...filter })

    return Promise.resolve()
  },
  deleteOne: (filter: Row) => {
    const at = rows.findIndex((row) => key(row) === key(filter))

    if (at >= 0) rows.splice(at, 1)

    return Promise.resolve()
  },
  find: (filter: { teamId: string }) => ({
    toArray: () => Promise.resolve(rows.filter((row) => row.teamId === filter.teamId)),
  }),
}

useDb({ db: () => ({ collection: () => collection }) })

// One made-up computer with two agents on it, both reporting a signed-in CLI.
const TEAM = 'team-test'
const CODEX = 'local:user-test:device-test:codex'
const CLAUDE = 'local:user-test:device-test:claude-code'
const computer = (provider: 'codex' | 'claude-code') => ({
  provider,
  local: {
    ownerUserId: 'user-test',
    deviceId: 'device-test',
    deviceLabel: 'Test computer',
    online: true,
    signedIn: true,
  },
})
const ready = async (runtimeId: string, provider: 'codex' | 'claude-code') =>
  !unavailableReason(computer(provider), (await authRefusedRuntimes(TEAM)).has(runtimeId))

const ran = Promise.resolve({ stopReason: 'end_turn' })
const failed = (error: Error) => noteTurnSignIn(TEAM, CODEX, Promise.reject(error)).catch(() => {})
const codexNotice = (notice: string) =>
  new OpenAbRpcError(`**Internal Error** (code: -32603)\nInternal error\n> ${notice}`, -32603)

beforeEach(() => {
  rows.length = 0
})

test('ready, refused sign-in, then ready again once a turn runs; the other agent stays ready', async () => {
  expect(await ready(CODEX, 'codex')).toBe(true)

  await failed(new OpenAbRpcError('Authentication required', -32000))
  expect(await ready(CODEX, 'codex')).toBe(false)
  expect(unavailableReason(computer('codex'), true)).toStartWith('Sign-in refused: Codex')
  expect(await ready(CLAUDE, 'claude-code')).toBe(true)

  await noteTurnSignIn(TEAM, CODEX, ran)
  expect(await ready(CODEX, 'codex')).toBe(true)
})

test('a completed sign-in clears the refusal', async () => {
  await failed(
    codexNotice(
      'Your access token could not be refreshed because your refresh token has expired. Please log out and sign in again.',
    ),
  )
  expect(await ready(CODEX, 'codex')).toBe(false)

  await forgetAuthRefusal(TEAM, CODEX)
  expect(await ready(CODEX, 'codex')).toBe(true)
})

test('failures that do not prove a refused sign-in leave the agent ready', async () => {
  await failed(new OpenAbRpcError('Internal server error', -32000))
  await failed(codexNotice('You’ve hit your usage limit.'))
  await failed(new OpenAbConnectionLostError('socket closed'))
  await failed(new Error('Lost the connection to the agent runtime.'))

  expect(rows).toEqual([])
})

test('a turn stopped before it ran does not clear a refusal', async () => {
  await failed(new OpenAbRpcError('Authentication required', -32000))
  await noteTurnSignIn(
    TEAM,
    CODEX,
    Promise.resolve({ stopReason: 'cancelled', unsent: true as const }),
  )
  await noteTurnSignIn(TEAM, CODEX, Promise.resolve({ stopReason: 'cancelled' }))

  expect(await ready(CODEX, 'codex')).toBe(false)
})

test('the turn passes through unchanged, its error included', async () => {
  const refusal = new OpenAbRpcError('Authentication required', -32000)

  expect(await noteTurnSignIn(TEAM, CODEX, ran)).toEqual({ stopReason: 'end_turn' })
  await expect(noteTurnSignIn(TEAM, CODEX, Promise.reject(refusal))).rejects.toBe(refusal)
})

test('a refusal is per team: another team listing the same agent is not told', async () => {
  await failed(new OpenAbRpcError('Authentication required', -32000))

  expect(await authRefusedRuntimes('other-team')).toEqual(new Set())
})

test('asking someone to sign a refused agent in is not turned away as already signed in', async () => {
  await failed(new OpenAbRpcError('Authentication required', -32000))

  expect(await nudgeDeps.signedIn(TEAM, CODEX, 'user-test')).toBe(false)
})

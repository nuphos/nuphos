import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, expect, test } from 'bun:test'

import { parseQuotaReading, RUNTIME_QUOTA_PROBE } from './runtime-quota-probe'

const homes: string[] = []

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

/** Runs the probe the way the runtime does, with the provider's answer faked. */
function probe(files: Record<string, unknown>, status: number) {
  const home = mkdtempSync(join(tmpdir(), 'quota-probe-'))

  homes.push(home)
  for (const [name, value] of Object.entries(files)) {
    mkdirSync(join(home, '.claude'), { recursive: true })
    writeFileSync(join(home, '.claude', name), JSON.stringify(value))
  }
  writeFileSync(join(home, 'params.json'), JSON.stringify({ provider: 'claude-code' }))
  writeFileSync(join(home, 'probe.mjs'), RUNTIME_QUOTA_PROBE)
  writeFileSync(
    join(home, 'fake-fetch.mjs'),
    `globalThis.fetch = async (url, init) => { globalThis.__seen = init.headers.authorization; return new Response('{}', { status: ${status} }) }`,
  )
  // The test runner's own binary: Bun preloads the fake before the probe runs.
  const run = spawnSync(
    process.execPath,
    ['--preload', join(home, 'fake-fetch.mjs'), join(home, 'probe.mjs'), home],
    { env: { HOME: home, PATH: process.env.PATH }, encoding: 'utf8' },
  )

  return parseQuotaReading(run.stdout)
}

test('a one-year token the usage API refuses says why instead of an HTTP code', () => {
  expect(
    probe(
      {
        '.nuphos-oauth-token.json': {
          token: 'sk-ant-oat01-fixture',
          expiresAt: '2999-01-01T00:00:00Z',
        },
      },
      403,
    ),
  ).toEqual({
    error: 'Usage is unavailable with this sign-in type (a one-year token)',
    asked: true,
  })
})

test('an ordinary login keeps its plain HTTP reason', () => {
  expect(
    probe({ '.credentials.json': { claudeAiOauth: { accessToken: 'fixture-access' } } }, 403),
  ).toEqual({ error: 'HTTP 403', asked: true })
})

test('a lapsed one-year token is not used: the ordinary login beside it is', () => {
  expect(
    probe(
      {
        '.nuphos-oauth-token.json': {
          token: 'sk-ant-oat01-fixture',
          expiresAt: '2020-01-01T00:00:00Z',
        },
        '.credentials.json': { claudeAiOauth: { accessToken: 'fixture-access' } },
      },
      403,
    ),
  ).toEqual({ error: 'HTTP 403', asked: true })
})

test('a runtime with no sign-in at all reports Sign in required', () => {
  expect(probe({}, 200)).toEqual({ error: 'Sign in required' })
})

test('a lapsed one-year token with no login beside it reports Sign in required', () => {
  expect(
    probe(
      {
        '.nuphos-oauth-token.json': {
          token: 'sk-ant-oat01-fixture',
          expiresAt: '2020-01-01T00:00:00Z',
        },
      },
      200,
    ),
  ).toEqual({ error: 'Sign in required' })
})

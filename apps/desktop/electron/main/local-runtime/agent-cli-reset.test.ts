import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, test } from 'node:test'

import { spendClaudeReset } from './agent-cli-reset.ts'

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

const grant = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  resets_left: 1,
  ends_at: '2026-12-10T22:00:00+00:00',
  usable_now: true,
  paused: false,
  ...extra,
})

/** A home signed in to Claude Code, as `claude` itself leaves it. */
function signedIn(): string {
  const home = mkdtempSync(path.join(os.tmpdir(), 'reset-'))

  mkdirSync(path.join(home, '.claude'))
  writeFileSync(
    path.join(home, '.claude', '.credentials.json'),
    JSON.stringify({ claudeAiOauth: { accessToken: 'sk-ant-oat-local' } }),
  )
  writeFileSync(
    path.join(home, '.claude.json'),
    JSON.stringify({ oauthAccount: { organizationUuid: 'org-1' } }),
  )

  return home
}

type Call = { url: string; method: string; body?: unknown; headers: Record<string, string> }

function stubFetch(grants: unknown[], claim: unknown = { result: 'reset', resets_left: 0 }) {
  const calls: Call[] = []

  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      ...(init?.body ? { body: JSON.parse(String(init.body)) as unknown } : {}),
    }

    calls.push(call)

    return Promise.resolve(
      Response.json(call.method === 'GET' ? { cedar_ember: { eligible: true, grants } } : claim),
    )
  }) as typeof fetch

  return calls
}

test('spends the usable grant that expires first, as Claude Code does', async () => {
  const home = signedIn()
  const calls = stubFetch([
    grant('later', { ends_at: '2026-12-20T00:00:00Z' }),
    grant('paused', { ends_at: '2026-11-18T00:00:00Z', paused: true }),
    grant('spent', { ends_at: '2026-11-18T00:00:00Z', resets_left: 0 }),
    grant('first', { ends_at: '2026-12-01T00:00:00Z' }),
  ])

  try {
    assert.deepEqual(await spendClaudeReset({ HOME: home }, '2.1.322'), {
      result: 'reset',
      resetsLeft: 0,
    })
    assert.equal(calls.length, 2)
    const [read, claim] = calls

    assert.equal(read?.url, 'https://api.anthropic.com/api/oauth/usage?cedar_ember=1')
    assert.equal(claim?.method, 'POST')
    assert.equal(claim?.url, 'https://api.anthropic.com/api/organizations/org-1/reset_rate_limits')
    assert.equal(claim?.headers.authorization, 'Bearer sk-ant-oat-local')
    assert.equal(claim?.headers['user-agent'], 'claude-cli/2.1.322 (external, cli)')
    const body = claim?.body as { program: string; grant_id: string; request_id: string }

    assert.equal(body.program, 'cedar_ember')
    assert.equal(body.grant_id, 'first')
    assert.match(body.request_id, /^[0-9a-f-]{36}$/u)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('nothing is spent when no grant can be used now', async () => {
  const home = signedIn()
  const calls = stubFetch([grant('wall-only', { usable_now: false })])

  try {
    assert.deepEqual(await spendClaudeReset({ HOME: home }, '2.1.322'), {
      result: 'unavailable',
    })
    assert.equal(calls.length, 1)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('an answer that does not fit, a refusal or no sign-in never throws', async () => {
  const home = signedIn()

  try {
    stubFetch([grant('g')], { result: 'something new' })
    assert.deepEqual(await spendClaudeReset({ HOME: home }, '2.1.322'), { result: 'unavailable' })
    globalThis.fetch = (() =>
      Promise.resolve(new Response('no', { status: 403 }))) as unknown as typeof fetch
    assert.deepEqual(await spendClaudeReset({ HOME: home }, '2.1.322'), { result: 'unavailable' })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
  const empty = mkdtempSync(path.join(os.tmpdir(), 'reset-'))

  globalThis.fetch = (() => {
    throw new Error('the provider must not be asked without a credential')
  }) as typeof fetch
  try {
    assert.deepEqual(await spendClaudeReset({ HOME: empty }, '2.1.322'), { result: 'unavailable' })
  } finally {
    rmSync(empty, { recursive: true, force: true })
  }
})

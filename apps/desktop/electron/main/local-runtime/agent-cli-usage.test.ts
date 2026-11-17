import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, test } from 'node:test'

import { readAgentUsage } from './agent-cli-usage.ts'

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

function homeWith(file: string, contents: unknown): string {
  const home = mkdtempSync(path.join(os.tmpdir(), 'usage-'))

  mkdirSync(path.join(home, path.dirname(file)), { recursive: true })
  writeFileSync(path.join(home, file), JSON.stringify(contents))

  return home
}

function stubFetch(handler: (url: string, headers: Record<string, string>) => Response) {
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) =>
    Promise.resolve(
      handler(String(input), (init?.headers ?? {}) as Record<string, string>),
    )) as typeof fetch
}

test('asks Anthropic with the credential this computer holds', async () => {
  const home = homeWith('.claude/.credentials.json', {
    claudeAiOauth: { accessToken: 'sk-ant-oat-local' },
  })

  writeFileSync(path.join(home, '.claude', '.nuphos-limit-resets'), '')
  const seen: { url?: string; auth?: string; beta?: string; agent?: string; app?: string } = {}

  stubFetch((url, headers) => {
    seen.url = url
    seen.auth = headers.authorization
    seen.beta = headers['anthropic-beta']
    seen.agent = headers['user-agent']
    seen.app = headers['x-app']

    return Response.json({ seven_day: { utilization: 12, resets_at: null } })
  })
  try {
    assert.deepEqual(await readAgentUsage('claude-code', { HOME: home }, '2.1.322'), {
      seven_day: { utilization: 12, resets_at: null },
    })
    // Opted in: Anthropic lists limit resets only to Claude Code, so the read says it is one.
    assert.equal(seen.url, 'https://api.anthropic.com/api/oauth/usage?cedar_ember=1')
    assert.equal(seen.auth, 'Bearer sk-ant-oat-local')
    assert.equal(seen.beta, 'oauth-2025-04-20')
    assert.equal(seen.agent, 'claude-cli/2.1.322 (external, cli)')
    assert.equal(seen.app, 'cli')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('sends the ChatGPT account id when Codex recorded one', async () => {
  const home = homeWith('.codex/auth.json', {
    tokens: { access_token: 'chatgpt-local', account_id: 'acct_1' },
  })
  let account: string | undefined

  stubFetch((url, headers) => {
    account = headers['chatgpt-account-id']
    assert.equal(url, 'https://chatgpt.com/backend-api/wham/usage')

    return Response.json({ plan_type: 'plus' })
  })
  try {
    assert.deepEqual(await readAgentUsage('codex', { HOME: home }), { plan_type: 'plus' })
    assert.equal(account, 'acct_1')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('no credential, a refusal, or an unreachable provider all report nothing', async () => {
  const empty = mkdtempSync(path.join(os.tmpdir(), 'usage-'))

  stubFetch(() => {
    throw new Error('the provider must not be asked without a credential')
  })
  try {
    assert.equal(await readAgentUsage('claude-code', { HOME: empty }), undefined)
    assert.equal(await readAgentUsage('codex', { HOME: empty }), undefined)
  } finally {
    rmSync(empty, { recursive: true, force: true })
  }

  const home = homeWith('.claude/.credentials.json', { claudeAiOauth: { accessToken: 'x' } })

  try {
    stubFetch(() => new Response('rate limited', { status: 429 }))
    assert.equal(await readAgentUsage('claude-code', { HOME: home }), undefined)
    globalThis.fetch = (() => Promise.reject(new Error('offline'))) as typeof fetch
    assert.equal(await readAgentUsage('claude-code', { HOME: home }), undefined)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('an explicit config directory wins over the home default', async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'usage-'))
  const elsewhere = homeWith('cfg/.credentials.json', { claudeAiOauth: { accessToken: 'moved' } })
  let auth: string | undefined

  stubFetch((_url, headers) => {
    auth = headers.authorization

    return Response.json({})
  })
  try {
    await readAgentUsage('claude-code', {
      HOME: home,
      CLAUDE_CONFIG_DIR: path.join(elsewhere, 'cfg'),
    })
    assert.equal(auth, 'Bearer moved')
  } finally {
    rmSync(home, { recursive: true, force: true })
    rmSync(elsewhere, { recursive: true, force: true })
  }
})

test('without the opt-in, the read neither asks for resets nor says it is Claude Code', async () => {
  const home = homeWith('.claude/.credentials.json', { claudeAiOauth: { accessToken: 'x' } })
  const seen: { url?: string; headers?: Record<string, string> } = {}

  stubFetch((url, headers) => {
    seen.url = url
    seen.headers = headers

    return Response.json({})
  })
  try {
    await readAgentUsage('claude-code', { HOME: home }, '2.1.322')
    assert.equal(seen.url, 'https://api.anthropic.com/api/oauth/usage')
    assert.equal(seen.headers?.['user-agent'], undefined)
    assert.equal(seen.headers?.['x-app'], undefined)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('an opted-in read Anthropic refuses falls back to the plain one', async () => {
  const home = homeWith('.claude/.credentials.json', { claudeAiOauth: { accessToken: 'x' } })
  const seen: { url: string; agent?: string }[] = []

  writeFileSync(path.join(home, '.claude', '.nuphos-limit-resets'), '')
  stubFetch((url, headers) => {
    seen.push({ url, agent: headers['user-agent'] })

    return url.includes('cedar_ember')
      ? new Response('forbidden', { status: 403 })
      : Response.json({ seven_day: { utilization: 3, resets_at: null } })
  })
  try {
    assert.deepEqual(await readAgentUsage('claude-code', { HOME: home }, '2.1.322'), {
      seven_day: { utilization: 3, resets_at: null },
    })
    assert.deepEqual(seen, [
      {
        url: 'https://api.anthropic.com/api/oauth/usage?cedar_ember=1',
        agent: 'claude-cli/2.1.322 (external, cli)',
      },
      { url: 'https://api.anthropic.com/api/oauth/usage', agent: undefined },
    ])
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

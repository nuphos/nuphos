import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { deleteAgentCredentials, deleteDefaultCredentials } from './agent-credentials.ts'

function home(t: { after: (fn: () => void) => void }, files: Record<string, string>) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nuphos-agent-credentials-'))

  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const [file, contents] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    writeFileSync(path.join(root, file), contents)
  }
  const left = () => Object.keys(files).filter((file) => existsSync(path.join(root, file)))
  const json = (file: string) => JSON.parse(readFileSync(path.join(root, file), 'utf8')) as unknown

  return { root, left, json }
}

test('Claude Code loses its logins and API key, and keeps its settings and sessions', (t) => {
  const { root, left, json } = home(t, {
    '.credentials.json': '{"claudeAiOauth":{}}',
    '.nuphos-oauth-token.json': '{"token":"x"}',
    '.claude.json': '{"projects":{}}',
    'projects/work/session.jsonl': '{}\n',
    'settings.json': JSON.stringify({
      syncClaudeAiSkills: false,
      env: { ANTHROPIC_API_KEY: 'sk-ant', OTHER: '1' },
    }),
  })

  deleteAgentCredentials('claude-code', root)
  assert.deepEqual(left(), ['.claude.json', 'projects/work/session.jsonl', 'settings.json'])
  assert.deepEqual(json('settings.json'), { syncClaudeAiSkills: false, env: { OTHER: '1' } })
})

test('Codex loses its login and revision, and keeps its config and sessions', (t) => {
  const { root, left } = home(t, {
    'auth.json': '{}',
    '.nuphos-auth-revision': 'r1',
    'config.toml': 'cli_auth_credentials_store = "file"\n',
    'sessions/2026/rollout.jsonl': '{}\n',
  })

  deleteAgentCredentials('codex', root)
  assert.deepEqual(left(), ['config.toml', 'sessions/2026/rollout.jsonl'])
})

test('Grok Build loses its login file only', (t) => {
  const { root, left } = home(t, { '.grok/auth.json': '{}', '.grok/settings.json': '{}' })

  deleteAgentCredentials('grok', root)
  assert.deepEqual(left(), ['.grok/settings.json'])
})

test('OpenCode loses every provider login and its Bedrock keys, and keeps the rest', (t) => {
  const config = '.config/opencode/opencode.json'
  const { root, left, json } = home(t, {
    '.local/share/opencode/auth.json': '{"openai":{}}',
    '.local/share/opencode/storage/session.json': '{}',
    [config]: JSON.stringify({
      model: 'amazon-bedrock/claude',
      provider: {
        'amazon-bedrock': {
          options: { region: 'us-east-1', accessKeyId: 'AKIA', secretAccessKey: 's' },
        },
      },
    }),
  })

  deleteAgentCredentials('opencode', root)
  assert.deepEqual(left(), ['.local/share/opencode/storage/session.json', config])
  assert.deepEqual(json(config), {
    model: 'amazon-bedrock/claude',
    provider: { 'amazon-bedrock': { options: { region: 'us-east-1' } } },
  })
})

test('a config that is not plain JSON, or holds no credential, is left as it is', (t) => {
  const commented = '{\n  // mine\n  "provider": {}\n}\n'
  const plain = '{"theme":"dark"}'
  const { root, left } = home(t, {
    '.config/opencode/opencode.json': commented,
    'settings.json': plain,
  })

  deleteAgentCredentials('opencode', root)
  deleteAgentCredentials('claude-code', root)
  assert.equal(left().length, 2)
  assert.equal(readFileSync(path.join(root, '.config/opencode/opencode.json'), 'utf8'), commented)
  assert.equal(readFileSync(path.join(root, 'settings.json'), 'utf8'), plain)
})

test('deleting from an empty or missing home succeeds, and so does doing it again', (t) => {
  const { root } = home(t, {})

  for (const provider of ['claude-code', 'codex', 'grok', 'opencode'] as const) {
    deleteAgentCredentials(provider, root)
    deleteAgentCredentials(provider, path.join(root, 'missing'))
  }
  assert.equal(existsSync(path.join(root, 'missing')), false)
})

test('Antigravity is refused: its sign-in is the shared OS keyring', (t) => {
  const { root } = home(t, {})

  assert.throws(() => deleteAgentCredentials('antigravity', root), /Antigravity CLI/u)
})

test('a default Codex also loses the owner login its home links to', (t) => {
  const { root, left } = home(t, {
    'codex-home/auth.json': '{}',
    'owner/.codex/auth.json': '{}',
    'owner/.codex/config.toml': '',
  })
  const env = { HOME: path.join(root, 'owner') }

  deleteDefaultCredentials('codex', path.join(root, 'codex-home'), env)
  assert.deepEqual(left(), ['owner/.codex/config.toml'])
  // Only Codex links to the owner's home.
  writeFileSync(path.join(root, 'owner/.codex/auth.json'), '{}')
  deleteDefaultCredentials('claude-code', path.join(root, 'claude-home'), env)
  assert.equal(existsSync(path.join(root, 'owner/.codex/auth.json')), true)
})

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { readAccountKey } from './agent-account.ts'

function homeWith(file: string, contents: unknown): string {
  const home = mkdtempSync(path.join(os.tmpdir(), 'account-'))

  mkdirSync(path.join(home, path.dirname(file)), { recursive: true })
  writeFileSync(path.join(home, file), JSON.stringify(contents))

  return home
}

const keyOf = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16)
const jwt = (claims: unknown) =>
  `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`

test('names a Claude account by its account UUID, hashed', async () => {
  const dir = homeWith('.claude.json', {
    oauthAccount: { accountUuid: 'acc-1', organizationUuid: 'org-1', emailAddress: 'a@b.c' },
  })

  const key = await readAccountKey('claude-code', { HOME: '/nowhere', CLAUDE_CONFIG_DIR: dir })

  assert.equal(key, keyOf('claude-code:acc-1'))
})

test('reads ~/.claude.json when Claude has no config dir of its own', async () => {
  const home = homeWith('.claude.json', { oauthAccount: { accountUuid: 'acc-2' } })

  assert.equal(await readAccountKey('claude-code', { HOME: home }), keyOf('claude-code:acc-2'))
})

test('names a Codex account by its workspace and user, never the workspace alone', async () => {
  const auth = {
    tokens: {
      account_id: 'ws-1',
      id_token: jwt({
        'https://api.openai.com/auth': { chatgpt_account_id: 'ws-1', chatgpt_user_id: 'user-1' },
      }),
    },
  }
  const home = homeWith('.codex/auth.json', auth)

  assert.equal(await readAccountKey('codex', { HOME: home }), keyOf('codex:ws-1:user-1'))
})

test('reports nothing without a readable account id', async () => {
  const home = homeWith('.codex/auth.json', { tokens: { id_token: 'not-a-jwt' } })

  assert.equal(await readAccountKey('codex', { HOME: home }), undefined)
  assert.equal(await readAccountKey('claude-code', { HOME: home }), undefined)
  assert.equal(await readAccountKey('grok', { HOME: home }), undefined)
})

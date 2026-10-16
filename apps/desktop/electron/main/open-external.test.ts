import assert from 'node:assert/strict'
import { before, mock, test } from 'node:test'

const opened: string[] = []
let openExternal: (url: string) => Promise<void>

before(async () => {
  mock.module('electron', {
    namedExports: {
      shell: {
        openExternal: async (url: string) => {
          opened.push(url)
        },
      },
    },
  })
  ;({ openExternal } = await import('./open-external.ts'))
})

test('opens web, mail and Slack links', async () => {
  await openExternal('https://nuphos.ai/teams')
  await openExternal(' HTTP://Example.com')
  await openExternal('mailto:dev@example.com')
  await openExternal('slack://user?team=T1&id=U1')
  assert.deepEqual(opened, [
    'https://nuphos.ai/teams',
    'http://example.com/',
    'mailto:dev@example.com',
    'slack://user?team=T1&id=U1',
  ])
})

test('refuses other schemes and malformed URLs', async () => {
  opened.length = 0
  for (const url of [
    'file:///etc/passwd',
    'smb://attacker.example/share',
    // eslint-disable-next-line no-script-url -- the refusal is under test
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vscode://file/tmp/x',
    'ms-msdt:/id PCWDiagnostic',
    'nuphos://open?url=https://nuphos.ai',
    ' file:///etc/passwd',
    '//example.com',
    'not a url',
    '',
  ]) {
    await assert.rejects(openExternal(url), url)
  }
  assert.deepEqual(opened, [])
})

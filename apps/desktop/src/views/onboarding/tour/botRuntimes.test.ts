import assert from 'node:assert/strict'
import { test } from 'node:test'

import { botRuntimes } from './botRuntimes.ts'

test('Frida works with Claude Code here when it is installed, whatever else is', () => {
  assert.equal(botRuntimes(['codex', 'grok', 'claude-code']).here, 'claude-code')
})

test('Codex comes next, then Grok Build, then the first other runtime installed', () => {
  assert.equal(botRuntimes(['grok', 'codex']).here, 'codex')
  assert.equal(botRuntimes(['hermes', 'grok']).here, 'grok')
  assert.equal(botRuntimes(['hermes', 'pi']).here, 'hermes')
})

test('with nothing installed, Claude Code stands in as the example', () => {
  assert.deepEqual(botRuntimes([]), { here: 'claude-code', box: 'opencode' })
})

test('on the Box she always works with OpenCode', () => {
  assert.equal(botRuntimes(['codex']).box, 'opencode')
})

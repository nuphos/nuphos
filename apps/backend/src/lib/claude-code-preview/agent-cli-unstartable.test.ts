import { expect, test } from 'bun:test'

import { OpenAbRpcError } from './openab-acp-errors'
import { AGENT_CLI_UNSTARTABLE_MESSAGE } from './plain-failure'
import { classifyPreviewInterruption } from './preview-transcript'

import { formatAgentStreamError } from '@/routes/agent/errors'

// claude-agent-acp on Windows, spawning npm's claude.cmd without a shell, as logged on 2026-11-17.
const einval = new OpenAbRpcError(
  '**Internal Error** (code: -32603)\nInternal error\n> spawn EINVAL',
  -32603,
  { code: -32603, message: 'Internal error' },
)

test('an agent CLI that cannot start is one plain sentence, live and stored alike', () => {
  expect(formatAgentStreamError(einval)).toBe(AGENT_CLI_UNSTARTABLE_MESSAGE)
  expect(classifyPreviewInterruption(einval, false).message).toBe(AGENT_CLI_UNSTARTABLE_MESSAGE)
})

test('Node’s spawn error code never reaches the user', () => {
  expect(formatAgentStreamError(einval)).not.toContain('EINVAL')
})

test("npm's placeholder claude.exe, before its postinstall ran, gets the same sentence", () => {
  const placeholder = new OpenAbRpcError(
    '**Internal Error** (code: -32603)\nInternal error\n> spawn UNKNOWN',
    -32603,
    { code: -32603, message: 'Internal error' },
  )

  expect(formatAgentStreamError(placeholder)).toBe(AGENT_CLI_UNSTARTABLE_MESSAGE)
})

// codex-acp's startup error when the computer's own `codex` is a broken npm install: an old
// wrapper whose platform package is gone, as SRE logged on 2026-11-18 (path shortened).
const codexDied = (stderr: string) =>
  new OpenAbRpcError(`Codex process has exited with code 1:\n${stderr}`, 1001, {
    code: 1001,
    message: `Codex process has exited with code 1:\n${stderr}`,
  })
const missingBinary = codexDied(
  'Error: spawn /Users/me/.npm-global/lib/node_modules/@openai/codex/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/codex/codex ENOENT',
)
const missingPackage = codexDied(
  'Error: Missing optional dependency @openai/codex-darwin-arm64. Reinstall Codex: npm install -g @openai/codex@latest',
)

test('a Codex install missing its binary or platform package gets the reinstall sentence', () => {
  for (const error of [missingBinary, missingPackage]) {
    expect(formatAgentStreamError(error)).toBe(AGENT_CLI_UNSTARTABLE_MESSAGE)
    expect(classifyPreviewInterruption(error, false).message).toBe(AGENT_CLI_UNSTARTABLE_MESSAGE)
  }
})

test('a broken agent CLI is the agent’s own cause, so the line can offer its installer', () => {
  expect(classifyPreviewInterruption(missingBinary, false).cause).toBe('cli')
  expect(classifyPreviewInterruption(einval, false).cause).toBe('cli')
})

test('another program the agent spawns is not its CLI', () => {
  const tool = codexDied('Error: spawn /usr/local/bin/rg ENOENT')

  expect(classifyPreviewInterruption(tool, false).cause).toBeUndefined()
  expect(formatAgentStreamError(tool)).not.toBe(AGENT_CLI_UNSTARTABLE_MESSAGE)
})

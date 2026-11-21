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

// The ACP shim on Windows, spawning npm's opencode.cmd without a shell, as logged on 2026-11-21:
// the shim dies, and openab passes on the start of its stderr (path shortened).
const shimEinval = new OpenAbRpcError(
  "**Agent Output**\nnode:internal/child_process:421\n    throw new ErrnoException(err, 'spawn');\n    ^\n\nError: spawn EINVAL\n    at ChildProcess.spawn (node:internal/child_process:421:11)\n    at spawn (node:child_process:7…",
)

test('a shim-run CLI that cannot start gets the same sentence, not its stack', () => {
  expect(formatAgentStreamError(shimEinval)).toBe(AGENT_CLI_UNSTARTABLE_MESSAGE)
  expect(classifyPreviewInterruption(shimEinval, false)).toMatchObject({
    message: AGENT_CLI_UNSTARTABLE_MESSAGE,
    cause: 'cli',
  })
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

// The Agent SDK's check before it spawns Claude Code, when the copy the Claude desktop app kept
// was deleted by its update, as logged on 2026-11-19 (path shortened).
const claudeGone = new OpenAbRpcError(
  '**Internal Error** (code: -32603)\nInternal error\n> Claude Code native binary not found at /Users/me/Library/Application Support/Claude/claude-code/2.1.325/485fdac4332e/claude.app/Contents/MacOS/claude. Please ensure Claude Code is installed via native installer or specify a valid path with options.pathToClaudeCodeExecutable.',
  -32603,
  { code: -32603, message: 'Internal error' },
)

test('a Claude Code binary the Agent SDK cannot find gets the reinstall sentence and installer', () => {
  expect(formatAgentStreamError(claudeGone)).toBe(AGENT_CLI_UNSTARTABLE_MESSAGE)
  expect(classifyPreviewInterruption(claudeGone, false)).toMatchObject({
    message: AGENT_CLI_UNSTARTABLE_MESSAGE,
    cause: 'cli',
  })
})

// The same check when the file is there but will not start (a broken install), as e2e logged.
const claudeUnlaunchable = new OpenAbRpcError(
  "**Internal Error** (code: -32603)\nInternal error\n> Claude Code native binary at /home/me/.local/bin/claude exists but failed to launch. This usually means the binary does not match this system's libc — e.g. spawning a musl-linked binary on a glibc Linux host fails because the musl dynamic loader (/lib/ld-musl-*) is missing. Specify a matching binary with options.pathToClaudeCodeExecutable.",
  -32603,
  { code: -32603, message: 'Internal error' },
)

test('a Claude Code binary that is there but will not launch gets the same sentence and installer', () => {
  expect(formatAgentStreamError(claudeUnlaunchable)).toBe(AGENT_CLI_UNSTARTABLE_MESSAGE)
  expect(classifyPreviewInterruption(claudeUnlaunchable, false)).toMatchObject({
    message: AGENT_CLI_UNSTARTABLE_MESSAGE,
    cause: 'cli',
  })
})

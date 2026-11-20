import { expect, test } from 'bun:test'

import { OpenAbRpcError } from './openab-acp-errors'
import { classifyPreviewInterruption } from './preview-transcript'

import { formatAgentStreamError } from '@/routes/agent/errors'

/** openab when the agent's CLI exits during the handshake, as logged on 2026-11-20. */
const exited = (stderr?: string) =>
  new OpenAbRpcError(
    [
      '**Agent Stopped**',
      'The agent stopped while starting (exit code 3). Update Node.js on the computer that runs this agent to the version it asks for, then try again.',
      ...(stderr ? ['```', stderr, '```'] : []),
    ].join('\n'),
  )

test('an agent that died while starting keeps the runtime’s reason, live and stored alike', () => {
  const error = exited('Error: the agent requires Node.js 24.9 or newer (found v20.19.0)')

  for (const shown of [
    formatAgentStreamError(error),
    classifyPreviewInterruption(error, false).message,
  ]) {
    expect(shown).toContain('stopped while starting (exit code 3)')
    expect(shown).toContain('Update Node.js')
    expect(shown).toContain('Its last output: Error: the agent requires Node.js 24.9 or newer')
    expect(shown).not.toContain('The agent failed before it could answer.')
    expect(shown).not.toContain('**')
  }
})

test('an agent that died silently still says how it ended', () => {
  expect(formatAgentStreamError(exited())).toBe(
    'The agent stopped while starting (exit code 3). Update Node.js on the computer that runs this agent to the version it asks for, then try again.',
  )
})

test('only the last stderr line travels with the sentence', () => {
  const shown = formatAgentStreamError(exited('first line\nError: the last line'))

  expect(shown).toContain('Its last output: Error: the last line')
  expect(shown).not.toContain('first line')
})

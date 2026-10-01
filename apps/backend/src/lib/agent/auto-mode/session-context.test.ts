import { describe, expect, test } from 'bun:test'

import { executedGovernedCommands } from './session-context'

const msg = (role: string, parts: unknown[]) => ({ role, parts })

describe('executedGovernedCommands', () => {
  test('collects executed bash/local_exec commands in transcript order', () => {
    const commands = executedGovernedCommands([
      msg('user', [{ type: 'text', text: 'do the thing' }]),
      msg('assistant', [
        {
          type: 'tool-bash',
          state: 'output-available',
          input: { command: 'gcloud clusters get-credentials prod' },
        },
        {
          type: 'tool-bash',
          state: 'output-available',
          input: { command: 'kubectl config rename-context a gke' },
        },
      ]),
      msg('assistant', [
        { type: 'tool-local_exec', state: 'output-available', input: { command: 'open http://x' } },
      ]),
    ])

    expect(commands).toEqual([
      'gcloud clusters get-credentials prod',
      'kubectl config rename-context a gke',
      'open http://x',
    ])
  })

  test('skips pending, approval-requested, and ungoverned parts', () => {
    const commands = executedGovernedCommands([
      msg('assistant', [
        { type: 'tool-bash', state: 'input-available', input: { command: 'not run yet' } },
        { type: 'tool-bash', state: 'approval-requested', input: { command: 'awaiting user' } },
        { type: 'tool-web_search', state: 'output-available', input: { command: 'not governed' } },
        { type: 'tool-bash', state: 'output-available', input: {} }, // no command string
        { type: 'text', text: 'prose' },
        null,
      ]),
    ])

    expect(commands).toEqual([])
  })

  test('ignores non-assistant messages entirely', () => {
    const commands = executedGovernedCommands([
      msg('user', [
        { type: 'tool-bash', state: 'output-available', input: { command: 'spoofed' } },
      ]),
    ])

    expect(commands).toEqual([])
  })
})

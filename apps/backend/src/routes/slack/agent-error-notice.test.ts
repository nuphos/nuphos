import { describe, expect, test } from 'bun:test'

import { AppError } from '@/lib/errors'

import { slackAgentErrorNotice } from './agent-error-notice'

describe('slackAgentErrorNotice', () => {
  test('without a runtime, names signing in to one or picking one, not a setup token', () => {
    const notice = slackAgentErrorNotice(
      new AppError(409, 'claude_code_setup_required', 'internal setup message'),
    )

    expect(notice).toContain('was not run')
    expect(notice).toContain('Sign in to a runtime on a computer')
    expect(notice).toContain('pick one in Settings → Computers')
    expect(notice).not.toContain('setup-token')
  })

  test('guides a workspace whose runtime is still starting', () => {
    const notice = slackAgentErrorNotice(
      new AppError(503, 'claude_code_runtime_starting', 'internal runtime message'),
    )

    expect(notice).toContain('not online yet')
    expect(notice).toContain('this message was not run')
    expect(notice).toContain('Settings → Computers')
  })

  test('explains that an attached runtime must be restored', () => {
    const notice = slackAgentErrorNotice(
      new AppError(503, 'claude_code_runtime_unavailable', 'internal runtime message'),
    )

    expect(notice).toContain('attached to this conversation')
    expect(notice).toContain('restore it')
    expect(notice).toContain('this message was not run')
  })

  test('does not expose unexpected errors', () => {
    expect(slackAgentErrorNotice(new Error('database password leaked'))).not.toContain(
      'database password leaked',
    )
  })
})

import { expect, test } from 'bun:test'

import { OpenAbRpcError } from './openab-acp-errors'
import { classifyPreviewInterruption } from './preview-transcript'

import { formatAgentStreamError } from '@/routes/agent/errors'

test('an agent startup error keeps its stderr in live and stored output', () => {
  const error = new OpenAbRpcError(
    '**Agent Output**\ndsh: fatal uncaught exception: YAMLException: invalid config',
  )
  const expected = 'dsh: fatal uncaught exception: YAMLException: invalid config'

  expect(formatAgentStreamError(error)).toBe(expected)
  expect(classifyPreviewInterruption(error, false).message).toBe(expected)
})

test('stderr is not replaced by a guessed cause', () => {
  const error = new OpenAbRpcError('**Agent Output**\nError: ENOSPC in config')

  expect(formatAgentStreamError(error)).toBe('Error: ENOSPC in config')
})

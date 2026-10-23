import { expect, test } from 'bun:test'
import { preserveRuntimeToolResults, runtimeToolResults } from './transcript-runtime-tool-results'

test('stale UI persistence cannot resurrect a background tool after runtime completion', () => {
  const pending = {
    type: 'tool-exec',
    toolCallId: 'watch',
    state: 'input-available',
    input: { command: 'gh pr checks --watch' },
  }
  const result = {
    ...pending,
    state: 'output-error',
    errorText: 'exit 1',
    completedAt: 218000,
    runtimeResult: true,
  }
  const results = runtimeToolResults([result])

  expect(preserveRuntimeToolResults([pending], results)).toEqual([result])
  expect(
    preserveRuntimeToolResults([{ ...pending, toolCallId: 'different-turn' }], results),
  ).toEqual([{ ...pending, toolCallId: 'different-turn' }])
})

import { expect, test } from 'bun:test'
import { preserveRuntimeToolResults } from './transcript-runtime-tool-results'

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

  expect(preserveRuntimeToolResults([pending], [result])).toEqual([
    { ...result, output: undefined },
  ])
  expect(
    preserveRuntimeToolResults([{ ...pending, toolCallId: 'different-turn' }], [result]),
  ).toEqual([{ ...pending, toolCallId: 'different-turn' }])
})

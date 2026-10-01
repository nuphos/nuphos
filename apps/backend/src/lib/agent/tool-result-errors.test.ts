import { describe, expect, test } from 'bun:test'

import {
  reportableToolResultErrors,
  toolResultErrorFingerprint,
  toolResultErrorsForTelemetry,
} from './tool-result-errors'

const errors = [
  {
    toolName: 'save_memory',
    message: 'Invalid input containing customer infrastructure details',
    kind: 'tool_input_json_parse',
    source: 'step' as const,
  },
  {
    toolName: 'slack_react',
    message: "Model tried to call unavailable tool 'slack_react'",
    source: 'response' as const,
  },
]

describe('tool result error telemetry', () => {
  test('keeps classifications without copying raw tool inputs', () => {
    expect(toolResultErrorsForTelemetry(errors)).toEqual([
      { toolName: 'save_memory', kind: 'tool_input_json_parse', source: 'step' },
      { toolName: 'slack_react', kind: 'tool_result_error', source: 'response' },
    ])
    expect(JSON.stringify(toolResultErrorsForTelemetry(errors))).not.toContain(
      'customer infrastructure',
    )
  })

  test('schema rejections stay quality signals while unknown failures remain reportable', () => {
    expect(reportableToolResultErrors(errors)).toEqual([errors[1]!])
  })

  test('fingerprints by tool and error class instead of callback stack or message', () => {
    expect(toolResultErrorFingerprint(errors)).toBe(
      'agent_tool_result:save_memory:tool_input_json_parse|slack_react:tool_result_error',
    )
  })
})

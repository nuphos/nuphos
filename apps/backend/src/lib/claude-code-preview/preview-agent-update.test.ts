import { describe, expect, test } from 'bun:test'

import { isToolSearchTitle, parseToolUpdate, prettifyToolTitle } from './preview-agent-update'

describe('prettifyToolTitle', () => {
  test('renders MCP tool ids as "server: tool"', () => {
    expect(prettifyToolTitle('mcp__nuphos-credentials__list_credentials')).toBe(
      'nuphos-credentials: list_credentials',
    )
    expect(prettifyToolTitle('select:mcp__nuphos-credentials__get_credential')).toBe(
      'nuphos-credentials: get_credential',
    )
  })

  test('leaves ordinary titles alone', () => {
    expect(prettifyToolTitle('Check if Linode CLI is installed')).toBe(
      'Check if Linode CLI is installed',
    )
    expect(prettifyToolTitle('Terminal')).toBe('Terminal')
    expect(prettifyToolTitle('mcp__broken')).toBe('mcp__broken')
  })

  test('prefers the MCP input description over the tool name', () => {
    const update = parseToolUpdate('tc-2', {
      title: 'mcp__nuphos-credentials__get_credential',
      status: 'pending',
      rawInput: { provider: 'aws', id: 'role-1', description: '取得 AWS 帳單查詢用的憑證' },
    })

    expect(update).toMatchObject({ title: '取得 AWS 帳單查詢用的憑證' })
  })

  test('never lifts a description from non-MCP tools', () => {
    const update = parseToolUpdate('tc-3', {
      title: 'which aws',
      status: 'pending',
      rawInput: { command: 'which aws', description: 'Check if AWS CLI is installed' },
    })

    expect(update).toMatchObject({ title: 'which aws' })
  })

  test('flags deferred-tool lookups as plumbing', () => {
    expect(isToolSearchTitle('select:mcp__nuphos-credentials__get_credential')).toBe(true)
    expect(isToolSearchTitle('nuphos-credentials: get_credential')).toBe(false)
  })

  test('parseToolUpdate applies the prettified title', () => {
    const update = parseToolUpdate('tc-1', {
      title: 'mcp__nuphos-credentials__get_credential',
      status: 'completed',
    })

    expect(update).toMatchObject({ title: 'nuphos-credentials: get_credential' })
  })

  test("parseToolUpdate surfaces a terminal embed's terminalId", () => {
    const update = parseToolUpdate('tc-4', {
      title: 'ls -la',
      status: 'in_progress',
      content: [{ type: 'terminal', terminalId: 'term-1' }],
    })

    expect(update).toMatchObject({ terminalId: 'term-1' })
  })

  test('parseToolUpdate omits terminalId when there is no terminal embed', () => {
    const update = parseToolUpdate('tc-5', {
      title: 'ls -la',
      status: 'in_progress',
      content: [{ type: 'content', content: { type: 'text', text: 'done' } }],
    })

    expect(update).not.toHaveProperty('terminalId')
  })

  test('parseToolUpdate attributes a sub-agent step to its spawning call', () => {
    const update = parseToolUpdate('child-1', {
      title: 'Read',
      status: 'in_progress',
      rawInput: { path: 'flag.ts' },
      _meta: { claudeCode: { toolName: 'Read', parentToolUseId: 'task-1' } },
    })

    expect(update).toMatchObject({ parentToolUseId: 'task-1' })
    expect(update).not.toHaveProperty('subagent')
  })

  test('parseToolUpdate marks the call that spawned a sub-agent', () => {
    const update = parseToolUpdate('task-1', {
      title: 'find the flag',
      status: 'pending',
      _meta: { claudeCode: { toolName: 'Task', subagent: true } },
    })

    expect(update).toMatchObject({ subagent: true })
    expect(update).not.toHaveProperty('parentToolUseId')
  })

  test('parseToolUpdate ignores malformed or foreign sub-agent metadata', () => {
    const malformed = parseToolUpdate('tc-6', {
      title: 'Read',
      status: 'in_progress',
      _meta: { claudeCode: { parentToolUseId: 42, subagent: 'yes' } },
    })
    const foreign = parseToolUpdate('tc-7', {
      title: 'Read',
      status: 'in_progress',
      _meta: { codex: { parentToolUseId: 'task-1' } },
    })

    expect(malformed).not.toHaveProperty('parentToolUseId')
    expect(malformed).not.toHaveProperty('subagent')
    expect(foreign).not.toHaveProperty('parentToolUseId')
  })

  test('a normal tool update parses exactly as before', () => {
    const update = parseToolUpdate('tc-8', {
      title: 'Read',
      status: 'completed',
      rawInput: { path: 'x' },
      rawOutput: 'ok',
    })

    expect(update).toEqual({
      kind: 'tool',
      toolCallId: 'tc-8',
      title: 'Read',
      status: 'completed',
      rawInput: { path: 'x' },
      rawOutput: 'ok',
    })
  })
})

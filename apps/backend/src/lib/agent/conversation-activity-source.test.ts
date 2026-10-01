import { describe, expect, test } from 'bun:test'

import { normalizeConversationActivitySource } from './conversation-activity-source'

describe('normalizeConversationActivitySource', () => {
  test('identifies Nuphos app conversations without a Slack link', () => {
    expect(normalizeConversationActivitySource('app')).toEqual({
      origin: 'nuphos',
      linkedSlackThread: false,
    })
  })

  test('identifies Slack-originated conversations from metadata', () => {
    expect(normalizeConversationActivitySource('slack.agent')).toEqual({
      origin: 'slack',
      linkedSlackThread: false,
    })
  })

  test('treats legacy Slack bindings without origin as Slack-originated', () => {
    expect(normalizeConversationActivitySource(undefined, {})).toEqual({
      origin: 'slack',
      linkedSlackThread: true,
    })
  })

  test('preserves trigger origin when its notification is linked to Slack', () => {
    expect(
      normalizeConversationActivitySource('agent.trigger', { origin: 'agent_notification' }),
    ).toEqual({
      origin: 'trigger',
      linkedSlackThread: true,
    })
  })

  test('does not infer trigger origin for an unknown agent notification', () => {
    expect(
      normalizeConversationActivitySource(undefined, { origin: 'agent_notification' }),
    ).toEqual({
      origin: 'unknown',
      linkedSlackThread: true,
    })
  })

  test('preserves the desktop origin when the user picked the session up in Slack', () => {
    expect(normalizeConversationActivitySource('app', { origin: 'user_pickup' })).toEqual({
      origin: 'nuphos',
      linkedSlackThread: true,
    })
  })

  test('normalizes other interactive sources without adding badges', () => {
    expect(normalizeConversationActivitySource('mcp.codex').origin).toBe('mcp')
  })
})

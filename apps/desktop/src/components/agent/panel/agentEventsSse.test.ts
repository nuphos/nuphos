import assert from 'node:assert/strict'
import test from 'node:test'

import { startAutonomousTurn } from './autonomousTurn.ts'
import { appendTurnInterruptedPart } from './turnInterrupted.ts'

import type { Tab } from './model.ts'

test('autonomous start opens a distinct assistant turn and replay is idempotent', () => {
  const tab: Tab = {
    id: 'tab-1',
    sessionId: 'session-1',
    title: 'Timer',
    messages: [
      { id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'Set a timer' }] },
      { id: 'assistant-1', role: 'assistant', parts: [{ type: 'text', text: 'Scheduled' }] },
    ],
    streaming: true,
    connected: false,
    streamId: 'stream-1',
    streamStartedAt: null,
    error: null,
    autoResumeAttempts: 0,
    historyBaseIndex: 0,
    credentialAccess: {
      awsRoleIds: [],
      gcpServiceAccountIds: [],
      linodeAccountIds: [],
      hetznerAccountIds: [],
      betterStackIntegrationIds: [],
      uptimeKumaInstanceIds: [],
      onpremClusterIds: [],
      linearWorkspaceIds: [],
      jiraSiteIds: [],
      asanaAccountIds: [],
      sentryAccountIds: [],
      tailscaleClientIds: [],
      zeaburIds: [],
      vantaIntegrationIds: [],
      secureframeIntegrationIds: [],
      resendIntegrationIds: [],
    },
    readOnly: false,
  }
  const tabAfterStart = startAutonomousTurn(tab, 'stream-1', 'autonomous-1')

  assert.equal(tabAfterStart.messages.length, 3)
  assert.equal(tabAfterStart.messages.at(-1)?.turnOrigin, 'autonomous')

  const tabAfterReplay = startAutonomousTurn(tabAfterStart, 'stream-1', 'autonomous-1')

  assert.equal(tabAfterReplay.messages.length, 3)

  const streaming = {
    ...tabAfterStart,
    messages: tabAfterStart.messages.map((message) =>
      message.id === 'autonomous-1'
        ? { ...message, parts: [{ type: 'text' as const, text: 'Still streaming' }] }
        : message,
    ),
  }

  assert.equal(startAutonomousTurn(streaming, 'stream-1', 'autonomous-1'), streaming)
  const next = startAutonomousTurn(streaming, 'stream-1', 'autonomous-2')

  assert.equal(next.messages.length, 4)
  assert.equal(startAutonomousTurn(next, 'stream-1', 'autonomous-1'), next)
})

test('turn-interrupted attaches to the current answer and replaces the same id', () => {
  const tab: Tab = {
    id: 'tab-2',
    sessionId: 'session-2',
    title: 'Audit',
    messages: [{ id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'Audit' }] }],
    streaming: true,
    connected: false,
    streamId: 'stream-2',
    streamStartedAt: null,
    error: null,
    autoResumeAttempts: 0,
    historyBaseIndex: 0,
    credentialAccess: {
      awsRoleIds: [],
      gcpServiceAccountIds: [],
      linodeAccountIds: [],
      hetznerAccountIds: [],
      betterStackIntegrationIds: [],
      uptimeKumaInstanceIds: [],
      onpremClusterIds: [],
      linearWorkspaceIds: [],
      jiraSiteIds: [],
      asanaAccountIds: [],
      sentryAccountIds: [],
      tailscaleClientIds: [],
      zeaburIds: [],
      vantaIntegrationIds: [],
      secureframeIntegrationIds: [],
      resendIntegrationIds: [],
    },
    readOnly: false,
  }
  const part = {
    type: 'turn-interrupted' as const,
    id: 'stream-2:interrupted',
    reason: 'timeout' as const,
    message: 'OpenAB ACP session/prompt timed out',
    createdAt: '2026-08-27T09:45:21.000Z',
  }
  const once = appendTurnInterruptedPart(tab, part, () => 'assistant-x')

  assert.equal(once.messages.length, 2)
  assert.deepEqual(once.messages.at(-1)?.parts, [part])

  const twice = appendTurnInterruptedPart(once, { ...part, reason: 'error' }, () => 'assistant-y')

  assert.equal(twice.messages.length, 2)
  assert.deepEqual(twice.messages.at(-1)?.parts, [{ ...part, reason: 'error' }])
})

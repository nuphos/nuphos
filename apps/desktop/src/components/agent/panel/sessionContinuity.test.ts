import assert from 'node:assert/strict'
import test from 'node:test'

import {
  acceptQueuedSteer,
  eventEmittedAt,
  retainBackgroundTabs,
  statusElapsedSeconds,
} from './sessionContinuity.ts'

import type { Tab } from './model.ts'

const baseTab = (overrides: Partial<Tab> = {}): Tab => ({
  id: 'tab-1',
  sessionId: 'session-1',
  title: 'Chat',
  messages: [],
  streaming: false,
  connected: true,
  streamId: null,
  streamStartedAt: null,
  error: null,
  autoResumeAttempts: 0,
  credentialAccess: {
    awsRoleIds: [],
    gcpServiceAccountIds: [],
    linodeAccountIds: [],
    hetznerAccountIds: [],
    tencentAccountIds: [],
    aliyunAccountIds: [],
    volcengineAccountIds: [],
    huaweiAccountIds: [],
    azureAccountIds: [],
    onpremClusterIds: [],
    betterStackIntegrationIds: [],
    uptimeKumaInstanceIds: [],
    linearWorkspaceIds: [],
    jiraSiteIds: [],
    asanaAccountIds: [],
    sentryAccountIds: [],
    posthogIntegrationIds: [],
    tailscaleClientIds: [],
    zeaburIds: [],
    vantaIntegrationIds: [],
    secureframeIntegrationIds: [],
    resendIntegrationIds: [],
    githubInstallationIds: [],
    gitlabBindingIds: [],
    grafanaInstanceIds: [],
    sonarqubeIntegrationIds: [],
    notionIntegrationIds: [],
    upstashAccountIds: [],
    cloudflareAccountIds: [],
  },
  ...overrides,
})

test('session switches retain streaming, uploading, and queued chats', () => {
  const idle = baseTab({ id: 'idle' })
  const streaming = baseTab({ id: 'streaming', streaming: true })
  const queued = baseTab({
    id: 'queued',
    queued: [{ id: 'q1', text: 'follow up', filePaths: [] }],
  })
  const uploading = baseTab({ id: 'uploading' })

  assert.deepEqual(
    retainBackgroundTabs([idle, streaming, queued, uploading], new Set(['uploading'])).map(
      (tab) => tab.id,
    ),
    ['streaming', 'queued', 'uploading'],
  )
})

test('buffered event timestamps preserve timer anchors', () => {
  const startedAt = 1_700_000_000_000

  assert.equal(eventEmittedAt({ emittedAt: startedAt }, startedAt + 5_000), startedAt)
  assert.equal(eventEmittedAt({}, startedAt + 5_000), startedAt + 5_000)
  assert.equal(
    statusElapsedSeconds(
      startedAt,
      'Thinking…',
      { status: 'Thinking…', startedAt: startedAt + 5_000 },
      startedAt + 12_000,
    ),
    12,
  )
})

test('steer acknowledgement preserves the live assistant and tool-call target', () => {
  const tab = baseTab({
    streaming: true,
    messages: [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'start' }] },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          { type: 'text', text: 'working' },
          { type: 'tool', toolCallId: 'tool-1', toolName: 'bash', state: 'input-available' },
        ],
      },
    ],
    queued: [
      { id: 'q1', text: 'steer now', filePaths: [] },
      { id: 'q2', text: 'later', filePaths: [] },
    ],
  })
  const next = acceptQueuedSteer(tab, 'q1')

  assert.equal(next.messages, tab.messages)
  assert.equal(next.messages.at(-1)?.id, 'a1')
  assert.equal(next.messages.at(-1)?.parts.at(-1)?.type, 'tool')
  assert.deepEqual(
    next.queued?.map((item) => item.id),
    ['q2'],
  )
  assert.equal(acceptQueuedSteer(next, 'q1').messages, tab.messages)
})

test('native steering receipt preserves the assistant identity and deduplicates API/stream acknowledgements', async () => {
  const { appendSteering } = await import('./steering.ts')
  const part = { type: 'data-steering' as const, data: { id: 'receipt', text: 'Focus on tests' } }
  const tab = baseTab({
    streaming: true,
    streamId: 'live',
    messages: [
      {
        id: 'assistant',
        role: 'assistant',
        parts: [
          { type: 'tool', toolCallId: 'running', toolName: 'bash', state: 'input-available' },
        ],
      },
    ],
  })
  const next = appendSteering(tab, part)

  assert.equal(next.streamId, 'live')
  assert.equal(next.messages.at(-1)?.id, 'assistant')
  assert.equal(next.messages.at(-1)?.parts[0], tab.messages[0].parts[0])
  assert.equal(next.messages.at(-1)?.parts[1], part)
  assert.equal(appendSteering(next, part), next)
})

test('a steering receipt keeps whichever acknowledgement carried the sender', async () => {
  const { appendSteering, parseSteeringPart } = await import('./steering.ts')
  const metadata = {
    version: 1 as const,
    sender: { type: 'user' as const, id: 'u-ada', displayName: 'Ada' },
    source: 'nuphos' as const,
    sentAt: '2026-09-29T00:00:00.000Z',
  }
  const bare = { type: 'data-steering' as const, data: { id: 'receipt', text: 'Focus on tests' } }
  const attributed = parseSteeringPart({ ...bare, data: { ...bare.data, metadata } })!
  const tab = baseTab({
    streaming: true,
    streamId: 'live',
    messages: [{ id: 'assistant', role: 'assistant', parts: [{ type: 'text', text: 'Working' }] }],
  })

  assert.deepEqual(attributed.data.metadata, metadata)
  const streamFirst = appendSteering(appendSteering(tab, bare), attributed)

  assert.deepEqual(streamFirst.messages.at(-1)?.parts[1], attributed)
  const apiFirst = appendSteering(appendSteering(tab, attributed), bare)

  assert.deepEqual(apiFirst.messages.at(-1)?.parts[1], attributed)
  assert.equal(appendSteering(apiFirst, attributed), apiFirst)
  assert.equal(
    parseSteeringPart({ ...bare, data: { ...bare.data, metadata: { version: 2 } } })?.data.metadata,
    undefined,
  )
})

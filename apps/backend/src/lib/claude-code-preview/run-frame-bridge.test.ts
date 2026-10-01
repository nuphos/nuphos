import { EventEmitter } from 'node:events'

import { afterEach, describe, expect, test } from 'bun:test'

import { useRedis } from '@/lib/test/doubles/redis'

import type { AgentRun } from '@/routes/agent/types'

// A minimal ioredis stand-in: publish() records, subscribe/unsubscribe resolve.
class FakeSubscriber extends EventEmitter {
  readonly subscribed: string[] = []
  readonly unsubscribed: string[] = []

  subscribe(channel: string) {
    this.subscribed.push(channel)

    return Promise.resolve(1)
  }

  unsubscribe(channel: string) {
    this.unsubscribed.push(channel)

    return Promise.resolve(0)
  }
}

const published: { channel: string; message: string }[] = []
const subscriber = new FakeSubscriber()

useRedis({
  redisEnabled: () => true,
  getSubscriber: () => subscriber as never,
  withRedis: async (op) =>
    op({
      publish: (channel: string, message: string) => {
        published.push({ channel, message })

        return Promise.resolve(1)
      },
    } as never),
})

const { createPreviewFrameBridge, previewFrameChannel } = await import('./run-frame-bridge')

function fakeRun(userId: string, sessionId: string): AgentRun {
  return {
    key: `${userId}:stream`,
    streamId: `${userId}-stream`,
    userId,
    sessionId,
    frames: [],
    done: false,
    createdAt: Date.now(),
  } as unknown as AgentRun
}

const localRuns: AgentRun[] = []
const bridge = createPreviewFrameBridge(() =>
  Promise.resolve({
    findLocalRun: (userId, sessionId) =>
      localRuns.find((run) => run.userId === userId && run.sessionId === sessionId) ?? null,
    appendFrame: (run, sse) => {
      run.frames.push(sse)
    },
    findActiveStreamId: (userId, sessionId) =>
      Promise.resolve(sessionId === 'conv-remote' ? `${userId}-remote-stream` : null),
  }),
)

afterEach(() => {
  localRuns.length = 0
  published.length = 0
})

describe('run-frame bridge', () => {
  test('appends directly when the run is hosted on this replica', async () => {
    const run = fakeRun('user-1', 'conv-1')

    localRuns.push(run)
    await bridge.publishPreviewFrame(
      { userId: 'user-1', sessionId: 'conv-1' },
      { type: 'tool-output-available', toolCallId: 'tc', output: { ok: true } },
    )

    expect(run.frames).toEqual([
      'data: {"type":"tool-output-available","toolCallId":"tc","output":{"ok":true}}\n\n',
    ])
    expect(published).toEqual([])
  })

  test('publishes over Redis when the run lives elsewhere', async () => {
    await bridge.publishPreviewFrame(
      { userId: 'user-2', sessionId: 'conv-2' },
      { type: 'tool-input-available', toolCallId: 'tc2', toolName: 'plan_create', input: {} },
    )

    expect(published).toEqual([
      {
        channel: previewFrameChannel('user-2', 'conv-2'),
        message: JSON.stringify({
          type: 'tool-input-available',
          toolCallId: 'tc2',
          toolName: 'plan_create',
          input: {},
        }),
      },
    ])
  })

  test('routes a shared-channel actor frame to the conversation owner run', async () => {
    const run = fakeRun('owner-1', 'conv-shared')

    localRuns.push(run)
    await bridge.publishPreviewFrame(
      {
        userId: 'actor-2',
        conversationOwnerUserId: 'owner-1',
        sessionId: 'conv-shared',
      },
      { type: 'tool-input-available', toolCallId: 'tc-shared', toolName: 'plan_create' },
    )

    expect(run.frames).toHaveLength(1)
    expect(published).toEqual([])
  })

  test('a bound run receives frames published for its conversation, then unbinds', async () => {
    const run = fakeRun('user-3', 'conv-3')
    const channel = previewFrameChannel('user-3', 'conv-3')
    const unbind = bridge.bindPreviewRunFrameBridge(run, 'user-3', 'conv-3')

    expect(subscriber.subscribed).toContain(channel)
    subscriber.emit('message', channel, JSON.stringify({ type: 'reasoning-delta', delta: 'x' }))
    subscriber.emit('message', 'other-channel', JSON.stringify({ type: 'ignored' }))
    await Bun.sleep(0)

    expect(run.frames).toEqual(['data: {"type":"reasoning-delta","delta":"x"}\n\n'])

    unbind()
    expect(subscriber.unsubscribed).toContain(channel)
    subscriber.emit('message', channel, JSON.stringify({ type: 'late' }))
    await Bun.sleep(0)
    expect(run.frames).toHaveLength(1)
  })

  test('a bound consumer intercepts local and cross-replica internal frames', async () => {
    const run = fakeRun('user-4', 'conv-4')
    const seen: Record<string, unknown>[] = []
    const unbind = bridge.bindPreviewRunFrameBridge(run, 'user-4', 'conv-4', (frame) => {
      if (frame.type !== 'internal') return false
      seen.push(frame)

      return true
    })

    localRuns.push(run)
    await bridge.publishPreviewFrame(
      { userId: 'user-4', sessionId: 'conv-4' },
      { type: 'internal', source: 'local' },
    )
    localRuns.length = 0
    subscriber.emit(
      'message',
      previewFrameChannel('user-4', 'conv-4'),
      JSON.stringify({ type: 'internal', source: 'redis' }),
    )
    await Bun.sleep(0)

    expect(seen).toEqual([
      { type: 'internal', source: 'local' },
      { type: 'internal', source: 'redis' },
    ])
    expect(run.frames).toEqual([])
    unbind()
  })

  test('names the stream of the run a tool call belongs to, wherever it is hosted', async () => {
    localRuns.push(fakeRun('owner-5', 'conv-5'))

    expect(
      await bridge.previewRunStreamId({
        userId: 'actor-5',
        conversationOwnerUserId: 'owner-5',
        sessionId: 'conv-5',
      }),
    ).toBe('owner-5-stream')
    expect(await bridge.previewRunStreamId({ userId: 'user-6', sessionId: 'conv-remote' })).toBe(
      'user-6-remote-stream',
    )
    expect(
      await bridge.previewRunStreamId({ userId: 'user-7', sessionId: 'conv-none' }),
    ).toBeUndefined()
  })
})

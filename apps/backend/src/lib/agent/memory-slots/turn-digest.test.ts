// NUPS-607: the digest builder is the runtime's redaction/cap boundary for
// tool activity, so these tests pin both the shape providers receive and the
// guarantees the ToolCallDigest contract makes about it.
import { describe, expect, test } from 'bun:test'

import { buildTurnDigestMessages, toolActivityFromDigest } from './turn-digest'

import type { TurnMessageDigest } from './types'

const turn = { query: 'which cluster runs it?', answer: 'zeabur-prod-gke.' }

const assistantOf = (messages: TurnMessageDigest[]) =>
  messages.find(
    (m): m is Extract<TurnMessageDigest, { role: 'assistant' }> => m.role === 'assistant',
  )!

describe('buildTurnDigestMessages', () => {
  test('keeps the user/assistant pair and omits toolCalls on a tool-free turn', () => {
    const messages = buildTurnDigestMessages({ steps: [] }, turn)

    expect(messages).toEqual([
      { role: 'user', content: turn.query },
      { role: 'assistant', content: turn.answer },
    ])
  })

  test('redacts secrets in the user/assistant prose, not only in tool text', () => {
    const messages = buildTurnDigestMessages(
      { steps: [] },
      {
        query: 'why does postgres://app:supersecret1@db-host/app time out?',
        answer: 'The DSN postgres://app:supersecret1@db-host/app points at the old host.',
      },
    )

    for (const message of messages) {
      expect(message.content).not.toContain('supersecret1')
      expect(message.content).toContain('[REDACTED:url-credentials]')
    }
  })

  test('tolerates a malformed event instead of throwing into the finalizer', () => {
    for (const event of [null, undefined, {}, { steps: 'nope', response: 7 }]) {
      expect(buildTurnDigestMessages(event, turn)).toHaveLength(2)
    }
  })

  test('pairs each call with its result, arguments JSON-encoded', () => {
    const messages = buildTurnDigestMessages(
      {
        steps: [
          {
            toolCalls: [{ toolCallId: 'c1', toolName: 'kubectl', input: { ns: 'user-charge' } }],
            toolResults: [{ toolCallId: 'c1', output: 'clickhouse-shard0 Running' }],
          },
        ],
      },
      turn,
    )

    expect(assistantOf(messages).toolCalls).toEqual([
      { id: 'c1', name: 'kubectl', arguments: '{"ns":"user-charge"}' },
    ])
    expect(messages.at(-1)).toEqual({
      role: 'tool',
      toolCallId: 'c1',
      content: 'clickhouse-shard0 Running',
    })
  })

  test('captures HITL-approved calls that appear only in response.messages', () => {
    const messages = buildTurnDigestMessages(
      {
        steps: [],
        response: {
          messages: [
            {
              role: 'assistant',
              content: [{ type: 'tool-call', toolCallId: 'a1', toolName: 'gcp', input: { q: 1 } }],
            },
            {
              role: 'tool',
              // Real SDK shape on this path: ToolResultOutput union, not the
              // raw execute() return (review F5).
              content: [
                {
                  type: 'tool-result',
                  toolCallId: 'a1',
                  output: { type: 'json', value: { zone: 'asia-east1-a' } },
                },
              ],
            },
          ],
        },
      },
      turn,
    )

    expect(assistantOf(messages).toolCalls).toHaveLength(1)
    expect(assistantOf(messages).toolCalls?.[0]?.name).toBe('gcp')
    expect(messages.at(-1)).toEqual({
      role: 'tool',
      toolCallId: 'a1',
      content: '{"zone":"asia-east1-a"}',
    })
  })

  test('unwraps every ToolResultOutput variant on the messages path', () => {
    const result = (output: unknown, id: string) => ({
      role: 'tool',
      content: [{ type: 'tool-result', toolCallId: id, output }],
    })
    const call = (id: string) => ({ type: 'tool-call', toolCallId: id, toolName: 't', input: {} })
    const messages = buildTurnDigestMessages(
      {
        steps: [],
        response: {
          messages: [
            { role: 'assistant', content: ['r1', 'r2', 'r3', 'r4'].map(call) },
            result({ type: 'text', value: 'plain text' }, 'r1'),
            result({ type: 'error-text', value: 'boom' }, 'r2'),
            result({ type: 'execution-denied', reason: 'user said no' }, 'r3'),
            result(
              {
                type: 'content',
                value: [
                  { type: 'text', text: 'part one' },
                  { type: 'media', mediaType: 'image/png' },
                ],
              },
              'r4',
            ),
          ],
        },
      },
      turn,
    )
    const contents = messages.filter((m) => m.role === 'tool').map((m) => m.content)

    expect(contents).toEqual([
      'plain text',
      'boom',
      'execution denied: user said no',
      'part one\n[media]',
    ])
  })

  test('deduplicates a call reported by both paths', () => {
    const call = { toolCallId: 'c1', toolName: 'kubectl', input: {} }
    const messages = buildTurnDigestMessages(
      {
        steps: [{ toolCalls: [call], toolResults: [{ toolCallId: 'c1', output: 'a' }] }],
        response: {
          messages: [
            { role: 'assistant', content: [{ type: 'tool-call', ...call }] },
            { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'c1', output: 'a' }] },
          ],
        },
      },
      turn,
    )

    expect(assistantOf(messages).toolCalls).toHaveLength(1)
    expect(messages.filter((m) => m.role === 'tool')).toHaveLength(1)
  })

  test('redacts secrets in both arguments and output', () => {
    // High-entropy fixture, not a real vendor key shape: the entropy sweep is
    // what has to fire here, on both the call input and the result body.
    const fixture = 'Xk9QmZ2vT7bR4wL8nJ5hC3dF6gY1pS0aUeIoAqWz'
    const messages = buildTurnDigestMessages(
      {
        steps: [
          {
            toolCalls: [{ toolCallId: 'c1', toolName: 'curl', input: { token: fixture } }],
            toolResults: [{ toolCallId: 'c1', output: `authorized with ${fixture}` }],
          },
        ],
      },
      turn,
    )

    expect(JSON.stringify(messages)).not.toContain(fixture)
  })

  test('redacts low-entropy passwords inside JSON-stringified arguments (review F1)', () => {
    // The entropy sweep cannot catch a short plain password — only the
    // key-name rule can, and it must fire on the quoted-key JSON form that
    // stringify() produces.
    const messages = buildTurnDigestMessages(
      {
        steps: [
          {
            toolCalls: [
              // eslint-disable-next-line sonarjs/no-hardcoded-passwords -- fake fixture; the test asserts it gets redacted
              { toolCallId: 'c1', toolName: 'db', input: { password: 'short-pwd' } },
            ],
            toolResults: [{ toolCallId: 'c1', output: { credential: 'hunter2pw' } }],
          },
        ],
      },
      turn,
    )

    expect(JSON.stringify(messages)).not.toContain('short-pwd')
    expect(JSON.stringify(messages)).not.toContain('hunter2pw')
  })

  test('redacts before truncating, so no secret survives by being cut short', () => {
    // A secret placed past the argument cap must not reappear: slicing first
    // would leave an unmatched fragment in the kept prefix.
    const fixture = 'AKIAIOSFODNN7EXAMPLEKEYAKIAIOSFODNN7EXAMPLE'
    const messages = buildTurnDigestMessages(
      {
        steps: [
          {
            toolCalls: [
              { toolCallId: 'c1', toolName: 'sh', input: { cmd: 'x'.repeat(380) + fixture } },
            ],
          },
        ],
      },
      turn,
    )

    expect(assistantOf(messages).toolCalls?.[0]?.arguments).not.toContain(fixture.slice(0, 20))
  })

  test('caps argument and output length per call', () => {
    const messages = buildTurnDigestMessages(
      {
        steps: [
          {
            toolCalls: [{ toolCallId: 'c1', toolName: 'sh', input: 'a'.repeat(5000) }],
            toolResults: [{ toolCallId: 'c1', output: 'b'.repeat(5000) }],
          },
        ],
      },
      turn,
    )

    expect(assistantOf(messages).toolCalls?.[0]?.arguments).toHaveLength(400)
    expect((messages.at(-1) as { content: string }).content).toHaveLength(800)
  })

  test('keeps the LAST calls when a turn exceeds the count cap', () => {
    const steps = [
      {
        toolCalls: Array.from({ length: 40 }, (_, i) => ({
          toolCallId: `c${i}`,
          toolName: `t${i}`,
          input: {},
        })),
      },
    ]
    const calls = assistantOf(buildTurnDigestMessages({ steps }, turn)).toolCalls ?? []

    expect(calls).toHaveLength(24)
    expect(calls[0]?.name).toBe('t16')
    expect(calls.at(-1)?.name).toBe('t39')
  })

  test('enforces a whole-turn text budget across many chatty tools', () => {
    const steps = [
      {
        toolCalls: Array.from({ length: 24 }, (_, i) => ({
          toolCallId: `c${i}`,
          toolName: 'sh',
          input: 'a'.repeat(500),
        })),
        toolResults: Array.from({ length: 24 }, (_, i) => ({
          toolCallId: `c${i}`,
          output: 'b'.repeat(900),
        })),
      },
    ]
    const messages = buildTurnDigestMessages({ steps }, turn)
    const toolText =
      (assistantOf(messages).toolCalls ?? []).reduce((n, c) => n + c.arguments.length, 0) +
      messages.reduce((n, m) => n + (m.role === 'tool' ? m.content.length : 0), 0)

    expect(toolText).toBeLessThanOrEqual(6000)
    expect((assistantOf(messages).toolCalls ?? []).length).toBeGreaterThan(0)
  })

  test('skips skill loading — scaffolding, not work the turn can learn from', () => {
    const messages = buildTurnDigestMessages(
      {
        steps: [
          {
            toolCalls: [
              { toolCallId: 's1', toolName: 'skill', input: { name: 'k8s' } },
              { toolCallId: 'c1', toolName: 'kubectl', input: {} },
            ],
          },
        ],
      },
      turn,
    )

    expect((assistantOf(messages).toolCalls ?? []).map((c) => c.name)).toEqual(['kubectl'])
  })

  test('a call with no result still reaches the provider', () => {
    const messages = buildTurnDigestMessages(
      { steps: [{ toolCalls: [{ toolCallId: 'c1', toolName: 'kubectl', input: {} }] }] },
      turn,
    )

    expect(assistantOf(messages).toolCalls).toHaveLength(1)
    expect(messages.filter((m) => m.role === 'tool')).toHaveLength(0)
  })
})

describe('toolActivityFromDigest', () => {
  test('rebuilds call/result pairs from the flat message list', () => {
    const messages = buildTurnDigestMessages(
      {
        steps: [
          {
            toolCalls: [
              { toolCallId: 'c1', toolName: 'kubectl', input: { ns: 'cadvisor' } },
              { toolCallId: 'c2', toolName: 'gcp', input: {} },
            ],
            toolResults: [{ toolCallId: 'c1', output: 'shard0' }],
          },
        ],
      },
      turn,
    )

    expect(toolActivityFromDigest(messages)).toEqual([
      { name: 'kubectl', arguments: '{"ns":"cadvisor"}', output: 'shard0' },
      { name: 'gcp', arguments: '{}', output: '' },
    ])
  })

  test('is empty for a digest built by a provider that carries no tool calls', () => {
    expect(
      toolActivityFromDigest([
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b' },
      ]),
    ).toEqual([])
  })
})

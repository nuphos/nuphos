import { expect, test } from 'bun:test'

import { mintPreviewMcpToken } from './mcp-token'
import { redactStreamedUpdates } from './streamed-token-redaction'

import type { OpenAbSessionUpdate } from './openab-acp-updates'

const token = await mintPreviewMcpToken({ userId: 'u1', sessionId: 'conv-1', teamId: 't1' })
const cut = Math.floor(token.length / 2)

function collect() {
  const seen: OpenAbSessionUpdate[] = []
  const live = redactStreamedUpdates((update) => seen.push(update))
  const emitted = () =>
    seen
      .map((update) =>
        update.kind === 'text'
          ? update.text
          : update.kind === 'agent' && update.update.kind === 'thought'
            ? `<${update.update.text}>`
            : `|${update.kind}|`,
      )
      .join('')

  return { seen, live, emitted }
}

test('a token split across streamed chunks is never emitted, in any chunk', () => {
  const { seen, live, emitted } = collect()

  for (const chunk of ['token: ', token.slice(0, cut), `${token.slice(cut)} done`]) {
    live.deliver({ kind: 'text', text: chunk })
  }
  live.flush()

  expect(emitted()).toBe('token: [redacted] done')
  for (const update of seen) expect(JSON.stringify(update)).not.toContain(token.slice(0, 12 + 8))
})

test('held text survives interleaved updates and is released when the turn ends', () => {
  const { live, emitted } = collect()

  live.deliver({ kind: 'text', text: `key ${token.slice(0, cut)}` })
  live.deliver({ kind: 'status', status: 'active' })
  live.deliver({ kind: 'agent', update: { kind: 'thought', text: `think ${token.slice(0, cut)}` } })
  live.deliver({ kind: 'text', text: token.slice(cut) })
  live.deliver({ kind: 'agent', update: { kind: 'thought', text: token.slice(cut) } })
  live.deliver({ kind: 'text', text: ' tail ey' })
  live.deliver({ kind: 'complete' })
  live.deliver({ kind: 'text', text: 'last' })
  live.flush()

  expect(emitted()).toBe('key |status|<think >[redacted]<[redacted]> tail ey|complete|last')
})

test('a split right after a token’s first characters is still caught', () => {
  for (const at of [1, 2, 3, 40]) {
    const { live, emitted } = collect()

    live.deliver({ kind: 'text', text: `see ${token.slice(0, at)}` })
    live.deliver({ kind: 'text', text: token.slice(at, at + 20) })
    expect(emitted()).not.toContain(token.slice(at, at + 20))
    live.deliver({ kind: 'text', text: `${token.slice(at + 20)}.` })
    live.flush()
    expect(emitted()).not.toContain(token.slice(-20))
    expect(emitted()).toEndWith('[redacted].')
  }
})

test('ordinary text streams through without being held', () => {
  const { live, emitted } = collect()

  live.deliver({ kind: 'text', text: 'the key is' })
  live.deliver({ kind: 'text', text: ' here' })
  expect(emitted()).toBe('the key is here')
})

test('a key printed by a tool is redacted in the streamed tool update', () => {
  const { seen, live } = collect()
  const secret = 'Zx9'.repeat(14)
  const tool = {
    kind: 'tool' as const,
    toolCallId: 'call-1',
    title: 'Bash',
    status: 'completed',
    rawInput: { command: 'cat ~/.aws/credentials' },
    rawOutput: { stdout: `aws_secret_access_key = ${secret}\n` },
    contentText: `aws_secret_access_key = ${secret}`,
  }

  live.deliver({ kind: 'agent', update: tool })

  expect(JSON.stringify(seen)).not.toContain(secret)
  expect(seen[0]).toMatchObject({
    update: {
      rawInput: tool.rawInput,
      contentText: 'aws_secret_access_key = [REDACTED:aws-secret]',
    },
  })
})

test('an update without a key is passed through as the same object', () => {
  const { seen, live } = collect()
  const update: OpenAbSessionUpdate = { kind: 'status', status: 'active' }

  live.deliver(update)
  expect(seen[0]).toBe(update)
})

test('a runtime thread going idle releases held text first', () => {
  const { live, emitted } = collect()

  live.deliver({ kind: 'text', text: 'done ey' })
  live.deliver({ kind: 'status', status: 'idle' })
  expect(emitted()).toBe('done ey|status|')
})

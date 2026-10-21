import { expect, test } from 'bun:test'

import { mintPreviewMcpToken } from './mcp-token'
import { redactStreamedUpdates } from './streamed-token-redaction'

import type { OpenAbSessionUpdate } from './openab-acp-updates'

const token = mintPreviewMcpToken({ userId: 'u1', sessionId: 'conv-1', teamId: 't1' })
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

test('held text is released in order before other updates and at the end', () => {
  const { live, emitted } = collect()

  live.deliver({ kind: 'text', text: 'hello wor' })
  live.deliver({ kind: 'agent', update: { kind: 'thought', text: `think ${token.slice(0, cut)}` } })
  live.deliver({ kind: 'agent', update: { kind: 'thought', text: token.slice(cut) } })
  live.deliver({ kind: 'complete' })
  live.deliver({ kind: 'text', text: 'last' })
  live.flush()

  expect(emitted()).toBe('hello wor<think ><[redacted]>|complete|last')
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

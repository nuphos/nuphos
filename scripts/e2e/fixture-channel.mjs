// How the fixture Bot answers a chat: it reads on until nothing is left, then posts once.
const MARKER = /E2E_DELIVERY:[a-z0-9-]+/g
const indexes = (text) => [...text.matchAll(/"index":\s*(\d+)/g)].map((match) => match[1])
const more = (text) => /"more":\s*true/.test(text)

/** Reads what the wake left with channel_read, logs a page it was shown twice, and answers. */
export async function answerChannel({ call, log, sessionId, channelId, text }) {
  const seen = new Set(indexes(text))
  let read = text
  let last = text

  log({ sessionId, event: 'channel', detail: channelId })
  // E2E_SLOW keeps this turn busy, so the posts that follow wait for one notice.
  if (text.includes('E2E_SLOW')) await new Promise((resolve) => setTimeout(resolve, 5_000))
  for (let tries = 0; tries < 5 && more(last); tries++) {
    const message = await call(sessionId, 'channel_read', { label: 'Read on', channelId })

    last = message.result?.content?.[0]?.text ?? ''
    const repeated = indexes(last).filter((index) => seen.has(index))

    if (repeated.length > 0) log({ sessionId, event: 'channel-repeat', detail: repeated.join(',') })
    for (const index of indexes(last)) seen.add(index)
    read += `\n${last}`
  }
  const marker = (read.match(MARKER) ?? []).at(-1) ?? 'E2E_DELIVERY:missing'

  await call(sessionId, 'channel_post', { label: 'Answer', channelId, text: `POSTED ${marker}` })
}

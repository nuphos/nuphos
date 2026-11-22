import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

// How the fixture Bot answers a chat: it reads on until nothing is left, then posts once.
const MARKER = /E2E_DELIVERY:[a-z0-9-]+/g
const indexes = (text) => [...text.matchAll(/"index":\s*(\d+)/g)].map((match) => match[1])
const more = (text) => /"more":\s*true/.test(text)

/** E2E_WHO: whether the post carrying `marker` spoke for the Bot's owner, as channel_read marked it. */
function whoAsked(read, marker) {
  const post = [...read.matchAll(/"index":\s*\d+((?:(?!"index":)[\s\S])*)/g)].find((match) =>
    match[1].includes(marker),
  )

  return post?.[1].includes('"fromOwner": true') ? 'owner' : 'data'
}

/** Reads what the wake left with channel_read, logs a page it was shown twice, and answers. */
export async function answerChannel({ call, log, sessionId, channelId, text, ask }) {
  // The ask-tools post asks before each Nuphos tool, as a runtime out of Full Access does.
  // Only when it is the newest post: a later turn's wake still carries it.
  const permit =
    (text.match(MARKER) ?? []).at(-1) === 'E2E_DELIVERY:ask-tools' &&
    ((tool, args) => ask({ title: `mcp__nuphos-tools__${tool}`, kind: 'other', rawInput: args }))

  const seen = new Set(indexes(text))
  let read = text
  let last = text

  log({ sessionId, event: 'channel', detail: channelId })
  // Read and answer as a runtime that asks first, then try another channel.
  if (permit) {
    const read = { label: 'Read the chat', channelId }

    if ((await permit('channel_read', read)) === 'allow')
      await call(sessionId, 'channel_read', read)
  }
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
  const who = read.includes('E2E_WHO') ? ` from=${whoAsked(read, marker)}` : ''

  // A post marked E2E_DELIVERY:hold-… is answered only once the scenario writes `release` beside
  // the ACP log. Only while it is the post answered: shown again later, it holds nothing.
  if (marker.startsWith('E2E_DELIVERY:hold-')) {
    const release = join(dirname(process.env.E2E_ACP_LOG), 'release')

    while (!existsSync(release)) await new Promise((resolve) => setTimeout(resolve, 100))
  }

  // E2E_TWO_POSTS posts twice and works on, as a Bot that reports and keeps going.
  const twice = read.includes('E2E_TWO_POSTS')

  if (twice)
    await call(sessionId, 'channel_post', { label: 'Ack', channelId, text: `FIRST ${marker}` })
  // E2E_REPLY_TO answers the post that carries it, by its index, so the answer quotes it.
  const asked = [...read.matchAll(/"index":\s*(\d+)((?:(?!"index":)[\s\S])*)/g)].find((match) =>
    match[2].includes('E2E_REPLY_TO'),
  )

  const answer = {
    label: 'Answer',
    channelId,
    text: `POSTED ${marker}${who}${marker === 'E2E_DELIVERY:link-file-bot' ? ' [missing-report.md](/tmp/nuphos-e2e-missing/missing-report.md)' : ''}`,
    ...(asked ? { replyTo: Number(asked[1]) } : {}),
  }

  if (!permit || (await permit('channel_post', answer)) === 'allow')
    await call(sessionId, 'channel_post', answer)
  if (permit)
    await permit('channel_post', { label: 'Elsewhere', channelId: 'e2e-other-channel', text: 'x' })
  if (twice) await new Promise((resolve) => setTimeout(resolve, 10_000))
}

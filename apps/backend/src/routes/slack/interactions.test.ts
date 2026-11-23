import { createHmac, randomUUID } from 'node:crypto'

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { config } from '@/config'
import { useSlackAgentBot } from '@/lib/test/doubles/slack-agent-bot'

const SECRET = randomUUID()
const savedSecret = config.slack.signingSecret
const votes: string[] = []

useSlackAgentBot({
  upsertSlackReplyFeedback: (args) => {
    votes.push(args.verdict)

    return Promise.resolve()
  },
})

const { registerSlackInteractionRoutes } = await import('./interactions')
const app = new Hono()

registerSlackInteractionRoutes(app as never)

beforeAll(() => {
  config.slack.signingSecret = SECRET
})
afterAll(() => {
  config.slack.signingSecret = savedSecret
})

// Buttons on cards posted before their handlers were retired still send these.
async function press(actionId: string) {
  const payload = {
    type: 'block_actions',
    team: { id: 'T1' },
    user: { id: 'U1' },
    channel: { id: 'C1' },
    message: { ts: '100.1' },
    actions: [{ action_id: actionId, value: 'old-value' }],
  }
  const body = `payload=${encodeURIComponent(JSON.stringify(payload))}`
  const ts = String(Math.floor(Date.now() / 1000))
  const digest = createHmac('sha256', SECRET).update(`v0:${ts}:${body}`).digest('hex')
  const res = await app.request('/interactions', {
    method: 'POST',
    body,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'X-Slack-Request-Timestamp': ts,
      'X-Slack-Signature': `v0=${digest}`,
    },
  })

  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

test('an Approve press on a retired Plan card gets an ephemeral reply', async () => {
  expect(await press('nuphos_plan_approve')).toEqual({
    status: 200,
    body: {
      response_type: 'ephemeral',
      replace_original: false,
      text: 'Plans are retired. Agents now ask for approval with a decision in the Nuphos Inbox.',
    },
  })
})

test('the retired feedback buttons still record a vote', async () => {
  votes.length = 0
  const up = await press('nuphos_feedback_up')
  const down = await press('nuphos_feedback_down')

  expect([up.status, down.status]).toEqual([200, 200])
  expect(up.body).toMatchObject({ response_type: 'ephemeral', replace_original: false })
  expect(votes).toEqual(['up', 'down'])
})

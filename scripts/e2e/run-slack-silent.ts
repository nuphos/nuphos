// #4936: a Slack channel's hidden record pushes to no phone, counts as no unread and
// lists nowhere, even after a restart. Real backend, MongoDB and OpenAB; Slack and APNs
// are stubbed. Run with: bun scripts/e2e/run-slack-silent.ts
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { artifacts, stopAll, until } from './processes.ts'
import { addSlackUser, sealSlackToken, sendSlackEvent } from './slack-stub.ts'
import { startStack } from './stack.ts'

const WORKSPACE = 'TE2E'
const CHANNEL = 'CE2E'
const capture = join(artifacts, 'pushes.jsonl')

writeFileSync(capture, '')
const pushes = () =>
  readFileSync(capture, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { request: { payload: Record<string, unknown> } })

try {
  const stack = await startStack({
    backendStub: {
      preload: resolve(import.meta.dirname, 'computer-push-sender.ts'),
      env: { E2E_PUSH_CAPTURE: capture },
    },
  })
  const api = async <T = unknown>(method: string, path: string, body?: object): Promise<T> => {
    const response = await fetch(stack.apiUrl + path, {
      method,
      headers: { authorization: `Bearer ${stack.token}`, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify({ teamId: stack.teamId, ...body }) } : {}),
    })

    assert(response.ok, `${method} ${path}: ${response.status} ${await response.clone().text()}`)

    return (await response.json()) as T
  }
  const { MongoClient, ObjectId } = await import(
    resolve(import.meta.dirname, '../../apps/backend/node_modules/mongodb/lib/index.js')
  )
  const client = await new MongoClient(stack.mongoUri).connect()
  const db = client.db('nuphos_e2e')

  addSlackUser('UE2EBOT', { team_id: WORKSPACE, email: 'bot@example.com', name: 'E2E App' })
  addSlackUser('UOWNER', { team_id: WORKSPACE, email: stack.email, name: 'Owner in Slack' })
  await db.collection('team_byos_bindings').updateOne(
    { _id: new ObjectId(stack.teamId) },
    {
      $push: {
        slackWorkspaces: {
          id: new ObjectId(),
          slackTeamId: WORKSPACE,
          slackTeamName: 'E2E',
          botUserId: 'UE2EBOT',
          encryptedBotToken: sealSlackToken('xoxb-e2e'),
          installerSlackUserId: null,
          scope: '',
          createdAt: new Date(),
        },
      },
    },
    { upsert: true },
  )
  const bot = await api<{ sessionId: string }>('POST', '/agent/bots', {
    title: 'E2E Bot',
    avatar: '02-leonardo',
  })
  const { mapping } = await api<{ mapping: { externalChatId: string } }>('PUT', '/slack/mappings', {
    slackWorkspaceId: WORKSPACE,
    slackChannelId: CHANNEL,
  })
  const chatId: string = mapping.externalChatId

  await api('POST', `/slack/mappings/${WORKSPACE}/${CHANNEL}/bots`, { botSessionId: bot.sessionId })
  await api('PUT', '/push/devices', {
    token: 'ab'.repeat(32),
    deviceId: 'e2e-phone',
    platform: 'ios',
    environment: 'sandbox',
  })
  // As the startup backfill before #4936 left it: the connecting admin watching it.
  const me = (await api<{ id: string }>('GET', '/auth/me')).id

  await db
    .collection('agent_conversations')
    .updateOne({ sessionId: chatId }, { $set: { watcherIds: [me] } })
  // A deploy restarts the backend, which runs its startup migrations on every record.
  await stack.restartBackend()
  const record = await db.collection('agent_conversations').findOne({ sessionId: chatId })
  const before = pushes().length
  let events = 0
  const slack = async (text: string) => {
    events += 1
    await sendSlackEvent(stack, {
      type: 'event_callback',
      team_id: WORKSPACE,
      event_id: `EvSilent${String(events)}`,
      event: {
        type: 'message',
        channel: CHANNEL,
        user: 'UOWNER',
        ts: `${String(1_800_000_000 + events)}.000100`,
        text,
      },
    })
    await until(`the Bot to answer "${text}"`, async () =>
      Boolean(
        await db.collection('agent_messages').findOne({
          sessionId: chatId,
          'metadata.sender.type': 'agent',
          'parts.text': { $regex: text.split(' ').at(-1) },
        }),
      ),
    )
  }

  await slack('Status update E2E_DELIVERY:slack-silent')
  // The answer's nudge goes out right after the post; give it time to arrive.
  await new Promise((done) => setTimeout(done, 3000))
  const chatPushes = pushes()
    .slice(before)
    .filter((push) => JSON.stringify(push).includes(chatId))
  const unread = await api<{ count: number }>('GET', `/agent/unread-count?teamId=${stack.teamId}`)
  const listed = await api<{ conversations: { sessionId: string }[] }>(
    'GET',
    `/agent/conversations?teamId=${stack.teamId}&scope=team&kind=channel`,
  )
  const evidence = {
    chatId,
    owner: record?.userId,
    watcherIdsAfterRestart: record?.watcherIds ?? null,
    chatPushes,
    unread,
    listed: listed.conversations.some((row) => row.sessionId === chatId),
  }

  writeFileSync(join(artifacts, 'slack-silent.json'), JSON.stringify(evidence, null, 2))
  console.log(JSON.stringify(evidence, null, 2))
  assert.deepEqual(chatPushes, [], 'the Slack channel pushed to a phone')
  assert.equal(evidence.watcherIdsAfterRestart, null, 'someone still watches the hidden record')
  assert.equal(unread.count, 0, 'the hidden record counts as unread')
  assert.equal(evidence.listed, false, 'the hidden record is listed')
  await client.close()
  console.log('PASS')
} finally {
  await stopAll()
}

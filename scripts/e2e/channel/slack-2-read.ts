// #4157: an agent reads a Slack channel the app has joined, and one of its threads, through
// slack_read, and finds its members to mention through slack_members, the way it posts
// there; a channel the app is not in stays closed.
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

import { agentLog } from '../agent-log.ts'
import { addSlackChannel, sealSlackToken } from '../slack-stub.ts'
import { newTask, send } from '../ui.ts'

import type { Stack } from '../stack.ts'
import type { Scenario } from '../ui.ts'
import type { Page } from 'playwright-core'

const BACKEND_DIR = resolve(import.meta.dirname, '../../../apps/backend')
const WORKSPACE = 'TE2EREAD'

/** Runs `body` against the e2e database with `args`; prints what it returns. */
function mongo(stack: Stack, body: string, args: unknown): unknown {
  const script = `
    import { MongoClient, ObjectId } from 'mongodb'
    const client = await new MongoClient(process.argv[1]).connect()
    const db = client.db('nuphos_e2e')
    const args = JSON.parse(process.argv[2])
    const result = await (async () => { ${body} })()
    console.log(JSON.stringify(result ?? null))
    await client.close()`
  const out = execFileSync('bun', ['-e', script, stack.mongoUri, JSON.stringify(args)], {
    cwd: BACKEND_DIR,
    timeout: 10_000,
  })

  return JSON.parse(out.toString()) as unknown
}

let reads = 0

/** What `tool` answered when the agent called it with `args`. */
async function slackCall(page: Page, stack: Stack, tool: string, args: object): Promise<string> {
  const marker = `slack-read-${String(++reads)}`
  const before = agentLog(stack).length

  await send(
    page,
    `Read E2E_CALL ${tool} ${JSON.stringify({ label: 'Read Slack', ...args })} E2E_DELIVERY:${marker}`,
  )
  await page.getByText(`ACK E2E_DELIVERY:${marker}`).waitFor()

  return JSON.stringify(
    agentLog(stack)
      .slice(before)
      .find((entry) => entry.event === 'called' && entry.name === tool)?.result,
  )
}

function expectIn(answer: string, words: string[], absent: string[] = []) {
  for (const word of words)
    if (!answer.includes(word)) throw new Error(`Slack tool lacks "${word}": ${answer}`)
  for (const word of absent)
    if (answer.includes(word)) throw new Error(`Slack tool has "${word}": ${answer}`)
}

export default {
  name: 'an agent reads a joined Slack channel and one of its threads, but not a channel the app is not in',
  run: async (page, stack) => {
    addSlackChannel('CREAD', {
      name: 'e2e-ops',
      joined: true,
      messages: [
        { ts: '1700000001.000100', user: 'U1', text: 'Deploy started' },
        {
          ts: '1700000002.000100',
          user: 'U2',
          text: 'In the thread: rollback?',
          thread_ts: '1700000001.000100',
        },
        { ts: '1700000003.000100', user: 'U1', text: 'Deploy finished' },
      ],
      members: [
        { id: 'U1', name: 'ada', real_name: 'Ada Lovelace' },
        { id: 'U2', name: 'grace', real_name: 'Grace Hopper' },
      ],
    })
    addSlackChannel('PREAD', {
      name: 'e2e-private',
      private: true,
      joined: true,
      messages: [{ ts: '1700000004.000100', user: 'U1', text: 'Private note' }],
    })
    addSlackChannel('COUT', {
      name: 'e2e-elsewhere',
      joined: false,
      messages: [{ ts: '1700000005.000100', user: 'U1', text: 'Not for the app' }],
      members: [{ id: 'U3', name: 'outsider', real_name: 'Out Sider' }],
    })
    const created = mongo(
      stack,
      `const done = await db.collection('team_byos_bindings').updateOne(
        { _id: new ObjectId(args.teamId) },
        { $push: { slackWorkspaces: { id: new ObjectId(), slackTeamId: args.workspace,
          slackTeamName: 'E2E', botUserId: 'UE2EBOT', encryptedBotToken: args.token,
          installerSlackUserId: null, scope: '', createdAt: new Date() } } },
        { upsert: true })
      return Boolean(done.upsertedId)`,
      { teamId: stack.teamId, workspace: WORKSPACE, token: sealSlackToken('xoxb-e2e-read') },
    ) as boolean

    try {
      await newTask(page)
      // The channel's top-level messages, newest first; the thread reply stays in its thread.
      expectIn(
        await slackCall(page, stack, 'slack_read', { channelId: 'CREAD' }),
        ['Deploy finished', 'Deploy started'],
        ['rollback?'],
      )
      // The thread: its root and replies, oldest first.
      expectIn(
        await slackCall(page, stack, 'slack_read', {
          channelId: 'CREAD',
          threadTs: '1700000001.000100',
        }),
        ['Deploy started', 'In the thread: rollback?'],
      )
      // A private channel is open to a team administrator, as this e2e member is.
      expectIn(await slackCall(page, stack, 'slack_read', { channelId: 'PREAD' }), ['Private note'])
      // A channel the app has not joined gives nothing of it away.
      expectIn(
        await slackCall(page, stack, 'slack_read', { channelId: 'COUT' }),
        ['not in that Slack channel'],
        ['Not for the app'],
      )
      // Its members, named for a mention: only this channel's people, and no email.
      expectIn(
        await slackCall(page, stack, 'slack_members', { channelId: 'CREAD' }),
        ['"id":"U1"', 'Ada Lovelace', '"id":"U2"', 'Grace Hopper'],
        ['outsider', 'email'],
      )
      expectIn(
        await slackCall(page, stack, 'slack_members', { channelId: 'CREAD', query: 'hopper' }),
        ['"id":"U2"'],
        ['"id":"U1"'],
      )
      expectIn(
        await slackCall(page, stack, 'slack_members', { channelId: 'COUT' }),
        ['not in that Slack channel'],
        ['outsider'],
      )
    } finally {
      mongo(
        stack,
        `const team = { _id: new ObjectId(args.teamId) }
        if (args.created) await db.collection('team_byos_bindings').deleteOne(team)
        else await db.collection('team_byos_bindings').updateOne(team, { $pull: { slackWorkspaces: { slackTeamId: args.workspace } } })`,
        { teamId: stack.teamId, workspace: WORKSPACE, created },
      )
    }
  },
} satisfies Scenario

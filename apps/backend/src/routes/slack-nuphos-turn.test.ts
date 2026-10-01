// The Slack delivery for a turn typed in the Nuphos app on a Slack-bound
// conversation: interop message ordering, sender-name resolution, fail-open
// when the workspace bot is gone, and the finalize sequence (notices, thread
// transcript record, status clear, pause visibility).
import { beforeEach, describe, expect, test } from 'bun:test'

import { useFileTransferService } from '@/lib/test/doubles/file-transfer-service'
import { useSlackAgentBot } from '@/lib/test/doubles/slack-agent-bot'
import { useSlackApi } from '@/lib/test/doubles/slack-api'
import { useSlackInstallations } from '@/lib/test/doubles/slack-installations'

import type { SlackAgentThread, SlackUserMapping } from '@/lib/slack/agent-bot'

const WORKSPACE = 'T1'
const CHANNEL = 'C1'
const THREAD_TS = '100.1'
const TEAM = '69e989027ab63e8d6a0ffcb6'
const OWNER = '62e6289482f5f9d9408f1a79'
const SESSION_ID = 'sess-nuphos-turn-1'

type PostedMessage = { text: string; blocks?: unknown[] }

const posted: PostedMessage[] = []
const transcript: { ts: string; authorName: string; text: string; fromBot?: boolean }[] = []
const statusUpdates: string[] = []
const state: {
  botAvailable: boolean
  mapping: SlackUserMapping | null
  interopDelayMs: number
} = { botAvailable: true, mapping: null, interopDelayMs: 0 }

useSlackInstallations({
  resolveSlackBotForWorkspace: async () =>
    state.botAvailable
      ? { botToken: 'xoxb-test', botUserId: 'UBOT', nuphosTeamId: TEAM, binding: null }
      : null,
})

useSlackAgentBot({
  getSlackUserMappingForNuphosUser: async () => state.mapping,
  appendSlackThreadMessage: async (
    _key: unknown,
    message: { ts: string; authorName: string; text: string; fromBot?: boolean },
  ) => {
    transcript.push(message)
  },
})

useSlackApi({
  postSlackMessage: async (args: PostedMessage) => {
    // The interop message is the only post carrying blocks; give it a delay so
    // the ordering test proves the sink waits for it.
    if (args.blocks && state.interopDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, state.interopDelayMs))
    }
    posted.push(args)

    return { ok: true, ts: '1.1' }
  },
  slackApiGet: async () => ({
    ok: true,
    user: { id: 'UMAPPED', profile: { display_name: 'patrick.slack' } },
  }),
  setSlackAssistantStatus: async (args: { status: string }) => {
    statusUpdates.push(args.status)

    return { ok: true }
  },
})

useFileTransferService({
  listSessionDownloadsSince: async () => [],
})

const { beginNuphosSlackTurn } = await import('./slack/nuphos-turn')

function makeThread(): SlackAgentThread {
  return {
    slackWorkspaceId: WORKSPACE,
    slackChannelId: CHANNEL,
    slackThreadTs: THREAD_TS,
    teamId: TEAM,
    agentUserId: OWNER,
    sessionId: SESSION_ID,
    createdBySlackUserId: 'USLACK',
    origin: 'slack',
    createdAt: new Date(),
    lastActiveAt: new Date(),
  }
}

function beginArgs(overrides?: Partial<Parameters<typeof beginNuphosSlackTurn>[0]>) {
  return {
    thread: makeThread(),
    userId: OWNER,
    userName: 'Patrick',
    streamId: 'stream-1',
    mirror: {
      messageId: 'msg-1',
      questionText: 'Why is the api pod crashing?',
      attachmentCount: 0,
    },
    ...overrides,
  }
}

async function flushAsyncChains(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  posted.length = 0
  transcript.length = 0
  statusUpdates.length = 0
  state.botAvailable = true
  state.mapping = null
  state.interopDelayMs = 0
})

describe('beginNuphosSlackTurn', () => {
  test('fails open when no bot is installed for the workspace any more', async () => {
    state.botAvailable = false
    expect(await beginNuphosSlackTurn(beginArgs())).toBeNull()
    expect(posted).toHaveLength(0)
  })

  test('the "@Name says:" interop lands before the first mirrored reply, even when slow', async () => {
    state.interopDelayMs = 30
    const delivery = (await beginNuphosSlackTurn(beginArgs()))!

    await delivery.frameSink.say('On it — checking the pod.')

    expect(posted).toHaveLength(2)
    expect(posted[0]!.blocks).toBeDefined()
    expect(JSON.stringify(posted[0]!.blocks)).toContain('@Patrick')
    expect(posted[1]!.blocks).toBeUndefined()
    expect(posted[1]!.text).toContain('On it')
  })

  test('records the question in the thread transcript with a deterministic ts', async () => {
    await beginNuphosSlackTurn(beginArgs())
    await flushAsyncChains()
    expect(transcript).toEqual([
      { ts: 'nuphos:msg-1', authorName: 'Patrick', text: 'Why is the api pod crashing?' },
    ])
  })

  test('a continuation (mirror: null) re-attaches the mirror without re-posting the question', async () => {
    const delivery = await beginNuphosSlackTurn(beginArgs({ mirror: null }))

    await flushAsyncChains()
    expect(delivery).not.toBeNull()
    expect(posted).toHaveLength(0)
    expect(transcript).toHaveLength(0)
  })

  test('interop uses the mapped Slack display name; the prompt keeps the sender id without blocking on it', async () => {
    state.mapping = {
      slackWorkspaceId: WORKSPACE,
      slackUserId: 'UMAPPED',
      teamId: TEAM,
      nuphosUserId: OWNER,
      enabled: true,
      createdBy: 'auto:slack-email',
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    const delivery = (await beginNuphosSlackTurn(beginArgs()))!

    // The name fetch is an external HTTP call — the interop (which waits on
    // it) shows the Slack name, while the prompt-facing sender resolves
    // immediately from the Nuphos name.
    await delivery.frameSink.say('ack')
    expect(JSON.stringify(posted[0]!.blocks)).toContain('@patrick.slack')
    expect(delivery.slackReply.nuphosOriginated).toBe(true)
    expect(delivery.slackReply.sender).toMatchObject({
      slackUserId: 'UMAPPED',
      displayName: 'Patrick',
    })
  })
})

describe('finalize', () => {
  test('appends the reply tail to the thread transcript and clears the status line', async () => {
    const delivery = (await beginNuphosSlackTurn(beginArgs()))!

    delivery.frameSink.frame(
      `data: ${JSON.stringify({ type: 'text-delta', delta: 'The pod is OOMKilled.' })}`,
    )
    delivery.frameSink.done()
    await delivery.finalize({ stopped: false })

    const botLine = transcript.find((m) => m.fromBot)

    expect(botLine).toMatchObject({ ts: 'bot:nuphos:stream-1', authorName: 'Nuphos' })
    expect(botLine!.text).toContain('OOMKilled')
    expect(statusUpdates.at(-1)).toBe('')
  })

  test('a stopped turn tells the thread instead of going silently dark', async () => {
    const delivery = (await beginNuphosSlackTurn(beginArgs()))!

    await delivery.finalize({ stopped: true })
    expect(posted.some((m) => m.text.includes('Stopped from Nuphos'))).toBe(true)
  })

  test('a thrown turn posts an error notice into the thread', async () => {
    const delivery = (await beginNuphosSlackTurn(beginArgs()))!

    await delivery.finalize({ stopped: false, error: new Error('model exploded') })
    expect(posted.some((m) => m.text.includes('hit an error'))).toBe(true)
  })

  test('a budget pause the client will not auto-resume gets a thread notice', async () => {
    const delivery = (await beginNuphosSlackTurn(beginArgs()))!

    delivery.frameSink.frame(`data: ${JSON.stringify({ type: 'atlas-turn-paused' })}`)
    delivery.frameSink.done()
    await delivery.finalize({ stopped: false, pauseReason: 'output-budget' })
    expect(posted.some((m) => m.text.includes('too long to finish'))).toBe(true)
  })

  test('a pause the client auto-resumes stays silent in the thread', async () => {
    const delivery = (await beginNuphosSlackTurn(beginArgs()))!

    delivery.frameSink.frame(`data: ${JSON.stringify({ type: 'atlas-turn-paused' })}`)
    delivery.frameSink.done()
    await delivery.finalize({ stopped: false, pauseReason: 'model-silence' })
    // Only the interop question was posted; the continuation keeps the thread
    // moving without a notice.
    expect(posted.filter((m) => !m.blocks)).toHaveLength(0)
  })
})

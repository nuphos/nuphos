import { beforeEach, describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { createSlackOutboundContext } from './agent-outbound'

import type { SlackOutboundDependencies } from './agent-outbound'
import type { SlackIncidentReservation, SlackIncidentReserveResult } from './incident-notifications'

const teamId = new ObjectId().toHexString()
const incidentIdentity = {
  teamId,
  triggerId: 'trigger-1',
  incidentScope: 'default',
  slackWorkspaceId: 'T1',
  slackChannelId: 'C1',
}
let installed = true
let channelGrants: { slackWorkspaceId: string; slackChannelId: string }[] = []
let workspaceBot: { botToken: string; workspaceName: string } | null = {
  botToken: 'grant-token',
  workspaceName: 'HostCo',
}
let selfMapping: { slackUserId: string } | null = { slackUserId: 'U1' }
let existingThread: { slackChannelId: string } | null = null
let postCount = 0
const bindings: Record<string, unknown>[] = []
const rebinds: Record<string, unknown>[] = []
const postedMessages: Record<string, unknown>[] = []
const transcriptAppends: { key: Record<string, unknown>; message: Record<string, unknown> }[] = []
const channelTriggerNotification = {
  triggerId: 'trigger-1',
  incidentScope: 'default',
  triggerConfigRevision: 1,
  approvedDestination: { type: 'channel' as const, channelId: 'C1' },
}
const newChannelTriggerNotification = channelTriggerNotification
const FORK_SESSION_ID = 'forked-session-1'

const dependencies: SlackOutboundDependencies = {
  getBinding: async () =>
    installed ? { slackTeamId: 'T1', slackTeamName: 'Acme', botUserId: 'B1' } : null,
  resolveBot: async () =>
    installed
      ? {
          botToken: 'secret-token',
          binding: { slackTeamId: 'T1', slackTeamName: 'Acme' },
        }
      : null,
  listChannelGrants: async () => channelGrants,
  resolveWorkspaceBot: async () => workspaceBot,
  getSelfMapping: async () => selfMapping,
  canViewPrivateChannels: async () => true,
  isTriggerConfigurationCurrent: async () => true,
  getThreadBySessionId: async () => existingThread,
  bindThread: async (input) => {
    bindings.push(input)

    return input
  },
  appendThreadMessage: async (key, message) => {
    transcriptAppends.push({ key, message })
  },
  newSessionId: () => FORK_SESSION_ID,
  listChannels: async () => [{ id: 'C1', name: 'ops', isPrivate: false }],
  getChannel: async (_token: string, channelId: string) => ({
    id: channelId,
    name: 'ops',
    isPrivate: false,
  }),
  openDm: async () => 'D1',
  postMessage: async (input) => {
    postCount += 1
    postedMessages.push(input)

    return { ok: true, channel: input.channel, ts: input.threadTs ? '123.789' : '123.456' }
  },
  reserveIncident: async () => {
    throw new Error('Unexpected incident reservation')
  },
  listAlertThreads: async () => ['111.222'],
  rebindThreadSession: async (input) => {
    rebinds.push(input)
  },
  completeIncident: async () => {},
  recordIncidentDelivery: async () => {},
  abortIncident: async () => {},
}

beforeEach(() => {
  installed = true
  channelGrants = []
  workspaceBot = { botToken: 'grant-token', workspaceName: 'HostCo' }
  selfMapping = { slackUserId: 'U1' }
  existingThread = null
  postCount = 0
  bindings.length = 0
  rebinds.length = 0
  postedMessages.length = 0
  transcriptAppends.length = 0
})

describe('agent outbound Slack context', () => {
  test('is absent without a team-owned Slack installation', async () => {
    installed = false
    await expect(
      createSlackOutboundContext(
        { userId: 'user-1', conversationId: 'conv-1', teamId },
        dependencies,
      ),
    ).resolves.toBeNull()
  })

  test('lists joined channels and current-user DM availability', async () => {
    const context = await createSlackOutboundContext(
      { userId: 'user-1', conversationId: 'conv-1', teamId },
      dependencies,
    )

    await expect(context?.listDestinations()).resolves.toEqual({
      ok: true,
      workspace: { id: 'T1', name: 'Acme' },
      channels: [
        {
          id: 'C1',
          name: 'ops',
          isPrivate: false,
          slackWorkspaceId: 'T1',
          slackWorkspaceName: 'Acme',
        },
      ],
      dmSelfAvailable: true,
    })
  })

  test('does not disclose private destination names to non-administrators', async () => {
    const context = await createSlackOutboundContext(
      { userId: 'user-1', conversationId: 'conv-1', teamId },
      {
        ...dependencies,
        canViewPrivateChannels: async () => false,
        listChannels: async () => [
          { id: 'C1', name: 'ops', isPrivate: false },
          { id: 'G1', name: 'executive-incidents', isPrivate: true },
        ],
      },
    )

    await expect(context?.listDestinations()).resolves.toEqual(
      expect.objectContaining({
        channels: [expect.objectContaining({ id: 'C1', name: 'ops', isPrivate: false })],
      }),
    )
  })

  test('posts one root and binds it to the current conversation', async () => {
    const context = await createSlackOutboundContext(
      { userId: 'user-1', conversationId: 'conv-1', teamId },
      dependencies,
    )
    const first = await context?.post({
      destination: { type: 'channel', channelId: 'C1' },
      text: 'Incident report',
      bindConversation: true,
    })

    expect(first).toEqual({
      ok: true,
      destination: { type: 'channel', channelId: 'C1', label: '#ops' },
      delivery: 'root',
      messageTs: '123.456',
      rootThreadTs: '123.456',
      threadBound: true,
    })
    expect(bindings).toEqual([
      expect.objectContaining({
        slackWorkspaceId: 'T1',
        slackChannelId: 'C1',
        slackThreadTs: '123.456',
        teamId,
        agentUserId: 'user-1',
        sessionId: 'conv-1',
      }),
    ])
    // A fresh root is seeded by bindThread's rootText — appending it too would
    // record the same message twice.
    expect(transcriptAppends).toHaveLength(0)

    await expect(
      context?.post({
        destination: { type: 'channel', channelId: 'C1' },
        text: 'Duplicate',
        bindConversation: true,
      }),
    ).resolves.toEqual(expect.objectContaining({ ok: false }))
    expect(postCount).toBe(1)
  })

  test('posts a material trigger update into the existing incident thread', async () => {
    const reservation: SlackIncidentReservation = {
      recordId: new ObjectId(),
      token: 'lease-1',
      action: 'post_thread',
      contentHash: 'hash',
      sessionId: 'conv-1',
      triggerConfigRevision: 1,
      createdNew: false,
      threadTs: '111.222',
      postCountInWindow: 0,
      identity: incidentIdentity,
    }
    let completed: SlackIncidentReservation | undefined
    const incidentDependencies: SlackOutboundDependencies = {
      ...dependencies,
      reserveIncident: async (): Promise<SlackIncidentReserveResult> => ({
        action: 'post_thread',
        reservation,
      }),
      completeIncident: async (value) => {
        completed = value
      },
    }
    const context = await createSlackOutboundContext(
      {
        userId: 'user-1',
        conversationId: 'conv-1',
        teamId,
        triggerNotification: channelTriggerNotification,
      },
      incidentDependencies,
    )

    await expect(
      context?.post({
        destination: { type: 'channel', channelId: 'C1' },
        text: 'Impact expanded to two regions',
        bindConversation: true,
        replyToThread: '111.222',
      }),
    ).resolves.toEqual({
      ok: true,
      destination: { type: 'channel', channelId: 'C1', label: '#ops' },
      delivery: 'thread_update',
      messageTs: '123.789',
      rootThreadTs: '111.222',
      threadBound: true,
    })
    expect(postedMessages).toEqual([
      expect.objectContaining({ channel: 'C1', threadTs: '111.222' }),
    ])
    expect(bindings).toHaveLength(0)
    expect(completed).toEqual(reservation)
    // The update the bot just posted must reach the transcript the addressing
    // judge reads, keyed by the real Slack ts so a redelivery cannot double it.
    expect(transcriptAppends).toEqual([
      {
        key: { slackWorkspaceId: 'T1', slackChannelId: 'C1', slackThreadTs: '111.222' },
        message: {
          ts: '123.789',
          authorName: 'Nuphos',
          text: 'Impact expanded to two regions',
          fromBot: true,
        },
      },
    ])
  })

  test('a failed transcript append never fails a delivered thread update', async () => {
    const reservation: SlackIncidentReservation = {
      recordId: new ObjectId(),
      token: 'lease-1',
      action: 'post_thread',
      contentHash: 'hash',
      sessionId: 'conv-1',
      triggerConfigRevision: 1,
      createdNew: false,
      threadTs: '111.222',
      postCountInWindow: 0,
      identity: incidentIdentity,
    }
    let completed: SlackIncidentReservation | undefined
    const context = await createSlackOutboundContext(
      {
        userId: 'user-1',
        conversationId: 'conv-1',
        teamId,
        triggerNotification: channelTriggerNotification,
      },
      {
        ...dependencies,
        reserveIncident: async (): Promise<SlackIncidentReserveResult> => ({
          action: 'post_thread',
          reservation,
        }),
        completeIncident: async (value) => {
          completed = value
        },
        appendThreadMessage: async () => {
          throw new Error('mongo down')
        },
      },
    )

    await expect(
      context?.post({
        destination: { type: 'channel', channelId: 'C1' },
        text: 'Impact expanded to two regions',
        bindConversation: true,
        replyToThread: '111.222',
      }),
    ).resolves.toEqual(
      expect.objectContaining({ ok: true, delivery: 'thread_update', threadBound: true }),
    )
    expect(completed).toEqual(reservation)
  })

  test('reserves and binds exactly one root for a new trigger incident', async () => {
    const reservation: SlackIncidentReservation = {
      recordId: new ObjectId(),
      token: 'lease-root',
      action: 'post_root',
      contentHash: 'hash',
      sessionId: 'conv-root',
      triggerConfigRevision: 1,
      createdNew: true,
      postCountInWindow: 0,
      identity: incidentIdentity,
    }
    let completed = false
    const context = await createSlackOutboundContext(
      {
        userId: 'user-1',
        conversationId: 'conv-root',
        teamId,
        triggerNotification: newChannelTriggerNotification,
      },
      {
        ...dependencies,
        reserveIncident: async () => ({ action: 'post_root', reservation }),
        completeIncident: async () => {
          completed = true
        },
      },
    )

    await expect(
      context?.post({
        destination: { type: 'channel', channelId: 'C1' },
        text: 'New production incident',
        bindConversation: true,
      }),
    ).resolves.toEqual(expect.objectContaining({ ok: true, delivery: 'root' }))
    expect(postCount).toBe(1)
    expect(bindings).toEqual([
      expect.objectContaining({ sessionId: 'conv-root', slackThreadTs: '123.456' }),
    ])
    expect(completed).toBe(true)
  })

  test('posts a new incident alert before one investigation result in the same thread', async () => {
    const rootReservation: SlackIncidentReservation = {
      recordId: new ObjectId(),
      token: 'lease-root-two-phase',
      action: 'post_root',
      contentHash: 'root-hash',
      sessionId: 'conv-two-phase',
      triggerConfigRevision: 1,
      createdNew: true,
      postCountInWindow: 0,
      identity: incidentIdentity,
    }
    const resultReservation: SlackIncidentReservation = {
      recordId: rootReservation.recordId,
      token: 'lease-result-two-phase',
      action: 'post_thread',
      contentHash: 'result-hash',
      sessionId: 'conv-two-phase',
      triggerConfigRevision: 1,
      createdNew: false,
      threadTs: '123.456',
      postCountInWindow: 0,
      identity: incidentIdentity,
    }
    let reservationCalls = 0
    const context = await createSlackOutboundContext(
      {
        userId: 'user-1',
        conversationId: 'conv-two-phase',
        teamId,
        triggerNotification: newChannelTriggerNotification,
      },
      {
        ...dependencies,
        reserveIncident: async () => {
          reservationCalls += 1

          return reservationCalls === 1
            ? { action: 'post_root', reservation: rootReservation }
            : { action: 'post_thread', reservation: resultReservation }
        },
      },
    )

    await expect(
      context?.post({
        destination: { type: 'channel', channelId: 'C1' },
        text: 'CPU alert fired; Nuphos is investigating.',
        bindConversation: true,
      }),
    ).resolves.toEqual(expect.objectContaining({ ok: true, delivery: 'root' }))
    await expect(
      context?.post({
        destination: { type: 'channel', channelId: 'C1' },
        text: 'Investigation found a runaway deployment.',
        bindConversation: true,
        replyToThread: '111.222',
      }),
    ).resolves.toEqual(expect.objectContaining({ ok: true, delivery: 'thread_update' }))

    expect(postCount).toBe(2)
    expect(postedMessages).toHaveLength(2)
    expect(postedMessages[0]).toEqual(expect.objectContaining({ channel: 'C1' }))
    expect(postedMessages[0]).not.toHaveProperty('threadTs')
    expect(postedMessages[1]).toEqual(
      expect.objectContaining({ channel: 'C1', threadTs: '123.456' }),
    )
  })

  test('lets the on-call choose to reply first, with no server-imposed ordering', async () => {
    // The old contract forced an "initial" post before anything else. Whether
    // to reply into an existing thread rather than open a new one is exactly
    // the judgment this design hands to the agent, so the store is consulted
    // rather than the call being refused up front.
    let seenPlacement: string | undefined
    const context = await createSlackOutboundContext(
      {
        userId: 'user-1',
        conversationId: 'conv-reply-first',
        teamId,
        triggerNotification: newChannelTriggerNotification,
      },
      {
        ...dependencies,
        reserveIncident: async (input) => {
          seenPlacement = input.placement.type

          return {
            action: 'post_thread',
            reservation: {
              recordId: new ObjectId(),
              token: 'lease-reply',
              action: 'post_thread',
              contentHash: 'hash',
              sessionId: 'conv-reply-first',
              triggerConfigRevision: 1,
              createdNew: false,
              threadTs: '111.222',
              postCountInWindow: 0,
              identity: incidentIdentity,
            },
          }
        },
      },
    )

    await expect(
      context?.post({
        destination: { type: 'channel', channelId: 'C1' },
        text: 'Same problem as an hour ago, picking it up.',
        bindConversation: true,
        replyToThread: '111.222',
      }),
    ).resolves.toEqual(expect.objectContaining({ ok: true, delivery: 'thread_update' }))
    expect(seenPlacement).toBe('reply')
    expect(postedMessages).toEqual([
      expect.objectContaining({ channel: 'C1', threadTs: '111.222' }),
    ])
    // Continuing a thread hands it to the run that is working the alert now, and
    // carries the owner so the move cannot cross into another team's thread.
    expect(rebinds).toEqual([
      expect.objectContaining({
        slackThreadTs: '111.222',
        sessionId: 'conv-reply-first',
        teamId,
        agentUserId: 'user-1',
      }),
    ])
  })

  test('a post rejected before it reaches Slack does not cost the incident its opening post', async () => {
    // Reproduced live: the model aimed its first post at a channel instead of
    // the trigger's approved DM. The rejection never reached Slack but still
    // consumed the one opening post a new incident turn gets, so the corrected
    // post and the investigation result were both refused and the firing
    // notified nobody.
    const rootReservation: SlackIncidentReservation = {
      recordId: new ObjectId(),
      token: 'lease-root',
      action: 'post_root',
      contentHash: 'root-hash',
      sessionId: 'conv-wrong-dest',
      triggerConfigRevision: 1,
      createdNew: true,
      postCountInWindow: 0,
      identity: incidentIdentity,
    }
    const context = await createSlackOutboundContext(
      {
        userId: 'user-1',
        conversationId: 'conv-wrong-dest',
        teamId,
        triggerNotification: {
          ...newChannelTriggerNotification,
          approvedDestination: { type: 'dm_self' as const },
        },
      },
      {
        ...dependencies,
        reserveIncident: async () => ({ action: 'post_root', reservation: rootReservation }),
      },
    )

    await expect(
      context?.post({
        destination: { type: 'channel', channelId: 'C1' },
        text: 'Alert fired.',
        bindConversation: true,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.stringContaining('different Slack destination'),
      }),
    )
    expect(postCount).toBe(0)

    await expect(
      context?.post({
        destination: { type: 'dm_self' },
        text: 'Alert fired.',
        bindConversation: true,
      }),
    ).resolves.toEqual(expect.objectContaining({ ok: true, delivery: 'root' }))
    expect(postCount).toBe(1)
  })

  test('a non-destination rejection is capped too, so no validation path loops', async () => {
    // Every pre-delivery rejection must reach the same cap. An unbound-DM
    // refusal hits the datastore on each call, so an uncapped path is a real
    // loop, not just a noisy one.
    selfMapping = null
    const context = await createSlackOutboundContext(
      {
        userId: 'user-1',
        conversationId: 'conv-dm-loop',
        teamId,
        triggerNotification: {
          ...newChannelTriggerNotification,
          approvedDestination: { type: 'dm_self' as const },
        },
      },
      dependencies,
    )
    const unlinkedDm = () =>
      context?.post({
        destination: { type: 'dm_self' },
        text: 'Alert fired.',
        bindConversation: true,
      })

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(unlinkedDm()).resolves.toEqual(
        expect.objectContaining({ ok: false, error: expect.stringContaining('not linked') }),
      )
    }
    await expect(unlinkedDm()).resolves.toEqual(
      expect.objectContaining({ ok: false, error: expect.stringContaining('Too many invalid') }),
    )
    expect(postCount).toBe(0)
  })

  test('repeated invalid posts still stop, so a confused model cannot loop forever', async () => {
    const context = await createSlackOutboundContext(
      {
        userId: 'user-1',
        conversationId: 'conv-loop-invalid',
        teamId,
        triggerNotification: {
          ...newChannelTriggerNotification,
          approvedDestination: { type: 'dm_self' as const },
        },
      },
      dependencies,
    )
    const wrongDestination = () =>
      context?.post({
        destination: { type: 'channel', channelId: 'C1' },
        text: 'Alert fired.',
        bindConversation: true,
      })

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(wrongDestination()).resolves.toEqual(
        expect.objectContaining({
          ok: false,
          error: expect.stringContaining('different Slack destination'),
        }),
      )
    }
    await expect(wrongDestination()).resolves.toEqual(
      expect.objectContaining({ ok: false, error: expect.stringContaining('Too many invalid') }),
    )
    expect(postCount).toBe(0)
  })

  test('a throwing dependency is capped too, so a failing channel cannot loop', async () => {
    // Resolving a channel calls Slack, so an uncapped retry here is a loop
    // against their API rather than a local one.
    let lookups = 0
    const context = await createSlackOutboundContext(
      {
        userId: 'user-1',
        conversationId: 'conv-throwing',
        teamId,
        triggerNotification: newChannelTriggerNotification,
      },
      {
        ...dependencies,
        getChannel: async () => {
          lookups += 1
          throw new Error('channel_not_found')
        },
      },
    )
    const failingPost = () =>
      context?.post({
        destination: { type: 'channel', channelId: 'C1' },
        text: 'Alert fired.',
        bindConversation: true,
      })

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(failingPost()).resolves.toEqual(
        expect.objectContaining({ ok: false, error: expect.stringContaining('channel_not_found') }),
      )
    }
    await expect(failingPost()).resolves.toEqual(
      expect.objectContaining({ ok: false, error: expect.stringContaining('Too many invalid') }),
    )
    expect(lookups).toBe(5)
    expect(postCount).toBe(0)
  })

  test('a repeatedly wrong thread is capped, and does not spend the delivery budget', async () => {
    // This rejection happens after the attempt was committed, so it has to
    // both refund the delivery budget and count as a rejection. Getting only
    // the refund right leaves an unbounded loop over reserveIncident and
    // listAlertThreads — database I/O driven by model output.
    let reserveCalls = 0
    const context = await createSlackOutboundContext(
      {
        userId: 'user-1',
        conversationId: 'conv-wrong-thread',
        teamId,
        triggerNotification: newChannelTriggerNotification,
      },
      {
        ...dependencies,
        listAlertThreads: async () => ['111.222'],
        reserveIncident: async () => {
          reserveCalls += 1

          return { action: 'suppress', reason: 'unknown_thread' }
        },
      },
    )
    const wrongThread = () =>
      context?.post({
        destination: { type: 'channel', channelId: 'C1' },
        text: 'Alert fired.',
        bindConversation: true,
        replyToThread: '999.999',
      })

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(wrongThread()).resolves.toEqual(
        expect.objectContaining({ ok: false, error: expect.stringContaining('does not belong') }),
      )
    }
    await expect(wrongThread()).resolves.toEqual(
      expect.objectContaining({ ok: false, error: expect.stringContaining('Too many invalid') }),
    )
    expect(reserveCalls).toBe(5)
    expect(postCount).toBe(0)
  })

  test('hands the delivered text and placement to completion, which is what the ledger keeps', async () => {
    // Found live: completion accepted these and dropped them, so the ledger had
    // no threadTs. incident_history then had no thread to offer, a reply could
    // never be validated, and the agent could not continue its own thread —
    // all from one silently ignored argument.
    const rootReservation: SlackIncidentReservation = {
      recordId: new ObjectId(),
      token: 'lease-root',
      action: 'post_root',
      contentHash: 'root-hash',
      sessionId: 'conv-ledger',
      triggerConfigRevision: 1,
      createdNew: true,
      postCountInWindow: 0,
      identity: incidentIdentity,
    }
    let completedWith: { threadTs: string; text?: string; startedNewThread?: boolean } | undefined
    const context = await createSlackOutboundContext(
      {
        userId: 'user-1',
        conversationId: 'conv-ledger',
        teamId,
        triggerNotification: newChannelTriggerNotification,
      },
      {
        ...dependencies,
        reserveIncident: async () => ({ action: 'post_root', reservation: rootReservation }),
        completeIncident: async (_reservation, result) => {
          completedWith = result
        },
      },
    )

    await expect(
      context?.post({
        destination: { type: 'channel', channelId: 'C1' },
        text: 'CPU is saturated on prod-1.',
        bindConversation: true,
      }),
    ).resolves.toEqual(expect.objectContaining({ ok: true, delivery: 'root' }))
    expect(completedWith).toEqual({
      threadTs: '123.456',
      text: 'CPU is saturated on prod-1.',
      startedNewThread: true,
    })
  })

  test('two ordinary posts issued together cannot both spend the same budget', async () => {
    // An ordinary turn allows exactly one outbound message. The ceiling check at
    // the top of post() sits before several awaits, and a model can emit two
    // tool calls in one step, so that check alone bounds nothing — commitAttempt
    // has to be the gate.
    const context = await createSlackOutboundContext(
      { userId: 'user-1', conversationId: 'conv-race', teamId },
      {
        ...dependencies,
        // Yield inside the pre-commit window so both calls get past the fast path.
        getChannel: async (_token: string, channelId: string) => {
          await new Promise((resolve) => setTimeout(resolve, 5))

          return { id: channelId, name: 'ops', isPrivate: false }
        },
      },
    )
    const send = (text: string) =>
      context!.post({
        destination: { type: 'channel', channelId: 'C1' },
        text,
        bindConversation: false,
      })

    const results = await Promise.all([send('first report'), send('second report')])

    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(results.filter((r) => !r.ok)).toHaveLength(1)
    expect(postCount).toBe(1)
  })

  test('keeps an accepted Slack delivery reserved when thread binding fails', async () => {
    const reservation: SlackIncidentReservation = {
      recordId: new ObjectId(),
      token: 'lease-accepted',
      action: 'post_root',
      contentHash: 'hash',
      sessionId: 'conv-accepted',
      triggerConfigRevision: 1,
      createdNew: true,
      postCountInWindow: 0,
      identity: incidentIdentity,
    }
    let recorded = false
    let aborted = false
    const context = await createSlackOutboundContext(
      {
        userId: 'user-1',
        conversationId: 'conv-accepted',
        teamId,
        triggerNotification: newChannelTriggerNotification,
      },
      {
        ...dependencies,
        reserveIncident: async () => ({ action: 'post_root', reservation }),
        recordIncidentDelivery: async () => {
          recorded = true
        },
        bindThread: async () => {
          throw new Error('temporary binding failure')
        },
        abortIncident: async () => {
          aborted = true
        },
      },
    )

    await expect(
      context?.post({
        destination: { type: 'channel', channelId: 'C1' },
        text: 'Accepted incident root',
        bindConversation: true,
      }),
    ).resolves.toEqual(expect.objectContaining({ ok: false, error: 'temporary binding failure' }))
    expect(recorded).toBe(true)
    expect(aborted).toBe(false)
    expect(postCount).toBe(1)
  })

  test('treats a byte-identical repeat as success and never calls Slack', async () => {
    const context = await createSlackOutboundContext(
      {
        userId: 'user-1',
        conversationId: 'conv-2',
        teamId,
        triggerNotification: channelTriggerNotification,
      },
      {
        ...dependencies,
        reserveIncident: async () => ({
          action: 'suppress',
          reason: 'duplicate_content',
          threadTs: '111.222',
        }),
      },
    )

    await expect(
      context?.post({
        destination: { type: 'channel', channelId: 'C1' },
        text: 'Same incident again',
        bindConversation: true,
      }),
    ).resolves.toEqual({
      ok: true,
      destination: { type: 'channel', channelId: 'C1', label: '#ops' },
      delivery: 'suppressed',
      rootThreadTs: '111.222',
      suppressedReason: 'duplicate_content',
      threadBound: true,
    })
    expect(postCount).toBe(0)
  })

  test("a reply to a thread that is not this alert's is correctable, not fatal", async () => {
    const rootReservation: SlackIncidentReservation = {
      recordId: new ObjectId(),
      token: 'lease-root',
      action: 'post_root',
      contentHash: 'root-hash',
      sessionId: 'conv-1',
      triggerConfigRevision: 1,
      createdNew: true,
      postCountInWindow: 0,
      identity: incidentIdentity,
    }
    const context = await createSlackOutboundContext(
      {
        userId: 'user-1',
        conversationId: 'conv-1',
        teamId,
        triggerNotification: channelTriggerNotification,
      },
      {
        ...dependencies,
        reserveIncident: async (input) =>
          input.placement.type === 'reply'
            ? { action: 'suppress', reason: 'unknown_thread' }
            : { action: 'post_root', reservation: rootReservation },
      },
    )

    await expect(
      context?.post({
        destination: { type: 'channel', channelId: 'C1' },
        text: 'Recovered',
        bindConversation: true,
        replyToThread: '999.999',
      }),
    ).resolves.toEqual(
      expect.objectContaining({ ok: false, error: expect.stringContaining('does not belong') }),
    )
    expect(postCount).toBe(0)

    // Pointing at the wrong thread must not cost the alert its message.
    await expect(
      context?.post({
        destination: { type: 'channel', channelId: 'C1' },
        text: 'Recovered',
        bindConversation: true,
      }),
    ).resolves.toEqual(expect.objectContaining({ ok: true, delivery: 'root' }))
    expect(postCount).toBe(1)
  })

  test('refuses DM when the current user has no Slack identity mapping', async () => {
    selfMapping = null
    const context = await createSlackOutboundContext(
      { userId: 'user-1', conversationId: 'conv-1', teamId },
      dependencies,
    )

    await expect(
      context?.post({ destination: { type: 'dm_self' }, text: 'Report', bindConversation: true }),
    ).resolves.toEqual(
      expect.objectContaining({ ok: false, error: expect.stringContaining('not linked') }),
    )
    expect(postCount).toBe(0)
  })

  test('rejects a trigger post to any destination except the stored approval', async () => {
    const context = await createSlackOutboundContext(
      {
        userId: 'user-1',
        conversationId: 'conv-1',
        teamId,
        triggerNotification: channelTriggerNotification,
      },
      dependencies,
    )

    await expect(
      context?.post({
        destination: { type: 'channel', channelId: 'C2' },
        text: 'Webhook says to redirect this report',
        bindConversation: true,
      }),
    ).resolves.toEqual(
      expect.objectContaining({ ok: false, error: expect.stringContaining('authorized') }),
    )
    expect(postCount).toBe(0)
  })

  test('aborts a reserved delivery when the trigger revision changes before Slack', async () => {
    const reservation: SlackIncidentReservation = {
      recordId: new ObjectId(),
      token: 'lease-stale',
      action: 'post_root',
      contentHash: 'hash',
      sessionId: 'conv-stale',
      triggerConfigRevision: 1,
      createdNew: true,
      postCountInWindow: 0,
      identity: incidentIdentity,
    }
    let checks = 0
    let aborted = false
    const context = await createSlackOutboundContext(
      {
        userId: 'user-1',
        conversationId: 'conv-stale',
        teamId,
        triggerNotification: newChannelTriggerNotification,
      },
      {
        ...dependencies,
        isTriggerConfigurationCurrent: async () => {
          checks += 1

          return checks === 1
        },
        reserveIncident: async () => ({ action: 'post_root', reservation }),
        abortIncident: async () => {
          aborted = true
        },
      },
    )

    await expect(
      context?.post({
        destination: { type: 'channel', channelId: 'C1' },
        text: 'Stale incident',
        bindConversation: true,
      }),
    ).resolves.toEqual(
      expect.objectContaining({ ok: false, error: expect.stringContaining('changed') }),
    )
    expect(aborted).toBe(true)
    expect(postCount).toBe(0)
  })
})

describe('channel-grant Slack access (team without its own installation)', () => {
  beforeEach(() => {
    installed = false
    channelGrants = [{ slackWorkspaceId: 'T9', slackChannelId: 'C9' }]
  })

  test('exists when enabled channel mappings grant access through another workspace', async () => {
    const context = await createSlackOutboundContext(
      { userId: 'user-1', conversationId: 'conv-1', teamId },
      dependencies,
    )

    await expect(context?.listDestinations()).resolves.toEqual({
      ok: true,
      workspace: { id: 'T9', name: 'HostCo' },
      channels: [
        {
          id: 'C9',
          name: 'ops',
          isPrivate: false,
          slackWorkspaceId: 'T9',
          slackWorkspaceName: 'HostCo',
        },
      ],
      dmSelfAvailable: false,
    })
  })

  test('is absent when the granting workspace has no installation', async () => {
    workspaceBot = null
    await expect(
      createSlackOutboundContext(
        { userId: 'user-1', conversationId: 'conv-1', teamId },
        dependencies,
      ),
    ).resolves.toBeNull()
  })

  test('posts to a granted channel with the granting workspace bot', async () => {
    const context = await createSlackOutboundContext(
      { userId: 'user-1', conversationId: 'conv-1', teamId },
      dependencies,
    )

    await expect(
      context?.post({
        destination: { type: 'channel', channelId: 'C9' },
        text: 'hello',
        bindConversation: false,
      }),
    ).resolves.toEqual(expect.objectContaining({ ok: true, delivery: 'root' }))
    expect(postedMessages).toEqual([
      expect.objectContaining({ token: 'grant-token', channel: 'C9' }),
    ])
  })

  test('rejects channels outside the grant', async () => {
    const context = await createSlackOutboundContext(
      { userId: 'user-1', conversationId: 'conv-1', teamId },
      dependencies,
    )

    await expect(
      context?.post({
        destination: { type: 'channel', channelId: 'C-ELSEWHERE' },
        text: 'hello',
        bindConversation: false,
      }),
    ).resolves.toEqual(
      expect.objectContaining({ ok: false, error: expect.stringContaining('not linked') }),
    )
    expect(postCount).toBe(0)
  })

  test('rejects any DM destination', async () => {
    const context = await createSlackOutboundContext(
      { userId: 'user-1', conversationId: 'conv-1', teamId },
      dependencies,
    )

    await expect(
      context?.post({
        destination: { type: 'dm_self' },
        text: 'hello',
        bindConversation: false,
      }),
    ).resolves.toEqual(
      expect.objectContaining({ ok: false, error: expect.stringContaining('DM is unavailable') }),
    )
    expect(postCount).toBe(0)
  })

  test('fails closed when the grant is revoked between planning and posting', async () => {
    const context = await createSlackOutboundContext(
      { userId: 'user-1', conversationId: 'conv-1', teamId },
      dependencies,
    )

    channelGrants = []
    await expect(
      context?.post({
        destination: { type: 'channel', channelId: 'C9' },
        text: 'hello',
        bindConversation: false,
      }),
    ).resolves.toEqual(
      expect.objectContaining({ ok: false, error: expect.stringContaining('no longer connected') }),
    )
    expect(postCount).toBe(0)
  })

  test('binds a trigger incident thread through the granting workspace', async () => {
    const reservation = {
      reservationId: 'res-1',
      rootThreadTs: undefined,
      rootSessionId: undefined,
    } as never
    const context = await createSlackOutboundContext(
      {
        userId: 'user-1',
        conversationId: 'conv-1',
        teamId,
        triggerNotification: {
          triggerId: 'trigger-1',
          incidentScope: 'default',
          triggerConfigRevision: 1,
          approvedDestination: { type: 'channel', channelId: 'C9' },
        },
      },
      {
        ...dependencies,
        reserveIncident: async (input) => {
          expect(input.slackWorkspaceId).toBe('T9')

          return { action: 'post_root', reservation } as never
        },
      },
    )

    await expect(
      context?.post({
        destination: { type: 'channel', channelId: 'C9' },
        text: 'alert',
        bindConversation: true,
      }),
    ).resolves.toEqual(expect.objectContaining({ ok: true, delivery: 'root' }))
    expect(bindings).toEqual([
      expect.objectContaining({ slackWorkspaceId: 'T9', slackChannelId: 'C9', teamId }),
    ])
  })
})

describe('mixed access (own installation plus foreign channel grants)', () => {
  beforeEach(() => {
    installed = true
    channelGrants = [{ slackWorkspaceId: 'T9', slackChannelId: 'C9' }]
  })

  test('lists own joined channels and granted foreign channels together', async () => {
    const context = await createSlackOutboundContext(
      { userId: 'user-1', conversationId: 'conv-1', teamId },
      dependencies,
    )

    await expect(context?.listDestinations()).resolves.toEqual({
      ok: true,
      workspace: { id: 'T1', name: 'Acme' },
      channels: [
        {
          id: 'C1',
          name: 'ops',
          isPrivate: false,
          slackWorkspaceId: 'T1',
          slackWorkspaceName: 'Acme',
        },
        {
          id: 'C9',
          name: 'ops',
          isPrivate: false,
          slackWorkspaceId: 'T9',
          slackWorkspaceName: 'HostCo',
        },
      ],
      dmSelfAvailable: true,
    })
  })

  test('routes a workspace-qualified granted destination through the granting bot', async () => {
    const context = await createSlackOutboundContext(
      { userId: 'user-1', conversationId: 'conv-1', teamId },
      dependencies,
    )

    await expect(
      context?.post({
        destination: { type: 'channel', channelId: 'C9', slackWorkspaceId: 'T9' },
        text: 'hello',
        bindConversation: false,
      }),
    ).resolves.toEqual(expect.objectContaining({ ok: true }))
    expect(postedMessages).toEqual([
      expect.objectContaining({ token: 'grant-token', channel: 'C9' }),
    ])
  })

  test('falls back to the grant when the own bot cannot reach an unqualified channel', async () => {
    const context = await createSlackOutboundContext(
      { userId: 'user-1', conversationId: 'conv-1', teamId },
      {
        ...dependencies,
        getChannel: async (token: string, channelId: string) => {
          if (token === 'secret-token' && channelId === 'C9') {
            throw new Error('not_in_channel')
          }

          return { id: channelId, name: 'ops', isPrivate: false }
        },
      },
    )

    await expect(
      context?.post({
        destination: { type: 'channel', channelId: 'C9' },
        text: 'hello',
        bindConversation: false,
      }),
    ).resolves.toEqual(expect.objectContaining({ ok: true }))
    expect(postedMessages).toEqual([
      expect.objectContaining({ token: 'grant-token', channel: 'C9' }),
    ])
  })

  test('prefers the own bot for an unqualified channel it can reach', async () => {
    const context = await createSlackOutboundContext(
      { userId: 'user-1', conversationId: 'conv-1', teamId },
      dependencies,
    )

    await expect(
      context?.post({
        destination: { type: 'channel', channelId: 'C9' },
        text: 'hello',
        bindConversation: false,
      }),
    ).resolves.toEqual(expect.objectContaining({ ok: true }))
    expect(postedMessages).toEqual([
      expect.objectContaining({ token: 'secret-token', channel: 'C9' }),
    ])
  })
})

describe('a report that opens its own reply thread', () => {
  test('posts the root, opens the thread, and gives it a conversation of its own', async () => {
    const context = await createSlackOutboundContext(
      { userId: 'user-1', conversationId: 'conv-1', teamId },
      dependencies,
    )
    const result = await context?.post({
      destination: { type: 'channel', channelId: 'C1' },
      text: 'Lighthouse cost is up 12%',
      bindConversation: true,
      replyThread: { text: 'Full breakdown per instance…' },
    })

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        delivery: 'root',
        threadBound: true,
        replyThread: { opened: true, sessionId: FORK_SESSION_ID },
      }),
    )
    // The root, then one reply under it.
    expect(postedMessages).toEqual([
      expect.objectContaining({ channel: 'C1', text: 'Lighthouse cost is up 12%' }),
      expect.objectContaining({ channel: 'C1', threadTs: '123.456' }),
    ])
    expect(postedMessages[1]?.text).toContain('Full breakdown per instance…')
    // The invitation is the server's, not the model's.
    expect(postedMessages[1]?.text).toContain('Reply in this thread')
    // The root is seeded by bindThread's rootText; the reply under it must be
    // appended separately or the fork's judge never sees the bot's own report.
    expect(transcriptAppends).toEqual([
      {
        key: { slackWorkspaceId: 'T1', slackChannelId: 'C1', slackThreadTs: '123.456' },
        message: expect.objectContaining({
          ts: '123.789',
          authorName: 'Nuphos',
          fromBot: true,
          text: postedMessages[1]?.text,
        }),
      },
    ])
  })

  test('binds the fork, never the conversation that produced the report', async () => {
    const context = await createSlackOutboundContext(
      { userId: 'user-1', conversationId: 'conv-1', teamId },
      dependencies,
    )

    await context?.post({
      destination: { type: 'channel', channelId: 'C1' },
      text: 'Daily digest',
      bindConversation: true,
      replyThread: { text: 'Detail' },
    })
    expect(bindings).toEqual([
      expect.objectContaining({ sessionId: FORK_SESSION_ID, slackThreadTs: '123.456' }),
    ])
    expect(bindings[0]?.sessionId).not.toBe('conv-1')
  })

  test('carries the untruncated report to the fork, so its first reply has it in hand', async () => {
    const context = await createSlackOutboundContext(
      { userId: 'user-1', conversationId: 'conv-1', teamId },
      dependencies,
    )

    await context?.post({
      destination: { type: 'channel', channelId: 'C1' },
      text: 'Root summary',
      bindConversation: true,
      replyThread: { text: 'Thread detail' },
    })
    const context_ = bindings[0]?.notificationContext as string

    expect(context_).toContain('Root summary')
    expect(context_).toContain('Thread detail')
  })

  test('a thread that fails to open never fails the report already delivered', async () => {
    let posts = 0
    const context = await createSlackOutboundContext(
      { userId: 'user-1', conversationId: 'conv-1', teamId },
      {
        ...dependencies,
        postMessage: async (input) => {
          posts += 1
          if (posts === 2) throw new Error('thread_not_found')
          postedMessages.push(input)

          return { ok: true, channel: input.channel, ts: '123.456' }
        },
      },
    )
    const result = await context?.post({
      destination: { type: 'channel', channelId: 'C1' },
      text: 'Digest',
      bindConversation: true,
      replyThread: { text: 'Detail' },
    })

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        messageTs: '123.456',
        threadBound: false,
        replyThread: expect.objectContaining({ opened: false, error: 'thread_not_found' }),
      }),
    )
    expect(bindings).toEqual([])
  })

  test('cannot open a thread under a message that is itself a reply', async () => {
    const context = await createSlackOutboundContext(
      { userId: 'user-1', conversationId: 'conv-1', teamId },
      dependencies,
    )

    await expect(
      context?.post({
        destination: { type: 'channel', channelId: 'C1' },
        text: 'Update',
        bindConversation: true,
        replyToThread: '111.222',
        replyThread: { text: 'Detail' },
      }),
    ).resolves.toEqual({ ok: false, error: expect.stringContaining('replyToThread') })
    expect(postCount).toBe(0)
  })

  test('is refused on a monitoring alert, which already keeps a replyable thread', async () => {
    const context = await createSlackOutboundContext(
      {
        userId: 'user-1',
        conversationId: 'conv-1',
        teamId,
        triggerNotification: channelTriggerNotification,
      },
      dependencies,
    )

    await expect(
      context?.post({
        destination: { type: 'channel', channelId: 'C1' },
        text: 'Alert',
        bindConversation: true,
        replyThread: { text: 'Detail' },
      }),
    ).resolves.toEqual({ ok: false, error: expect.stringContaining('replyable thread') })
    expect(postCount).toBe(0)
  })
})

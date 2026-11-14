import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { config } from '@/config'

import { createMeetingBot, leaveMeeting } from './recall'

const realFetch = globalThis.fetch
const realMeetings = { ...config.meetings }

beforeEach(() => {
  config.meetings.recall = {
    apiKey: 'key',
    region: 'us-west-2',
    webhookSecret: 'whsec_x',
    botsPerTeamPerDay: 20,
  }
})

afterEach(() => {
  globalThis.fetch = realFetch
  config.meetings.recall = realMeetings.recall
})

function answer(status: number, body: object) {
  globalThis.fetch = (() =>
    Promise.resolve(new Response(JSON.stringify(body), { status }))) as unknown as typeof fetch
}

describe('createMeetingBot', () => {
  test('asks Recall to leave a call of notetakers, telling bots by name only', async () => {
    let sent: { automatic_leave?: { bot_detection?: Record<string, { timeout: number }> } } = {}

    globalThis.fetch = ((_url: string, init: RequestInit) => {
      sent = JSON.parse(init.body as string)

      return Promise.resolve(new Response(JSON.stringify({ id: 'bot' })))
    }) as unknown as typeof fetch

    await createMeetingBot({
      meetingUrl: 'https://meet.google.com/a',
      botName: 'B',
      webhookUrl: 'https://w',
    })

    const detection = sent.automatic_leave?.bot_detection

    // Judging by activity would take people who only type in the chat for bots.
    expect(detection?.using_participant_events).toBeUndefined()
    expect(detection?.using_participant_names?.timeout).toBe(60)
  })
})

describe('leaveMeeting', () => {
  test('a bot whose call already ended has left', async () => {
    answer(400, { code: 'cannot_command_unstarted_bot', detail: 'Cannot send a command…' })

    await expect(leaveMeeting('bot')).resolves.toBeUndefined()
  })

  test('other Recall errors still fail', async () => {
    answer(400, { code: 'bad_request', detail: 'no' })

    await expect(leaveMeeting('bot')).rejects.toThrow('bad_request')
  })
})

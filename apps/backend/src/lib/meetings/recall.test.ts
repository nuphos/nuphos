import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { config } from '@/config'

import { createMeetingBot, leaveMeeting, meetingBotStatus } from './recall'

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
    let sent: {
      automatic_leave?: {
        bot_detection?: Record<string, { timeout: number; activate_after: number }>
      }
    } = {}

    globalThis.fetch = ((_url: string, init: RequestInit) => {
      sent = JSON.parse(init.body as string)

      return Promise.resolve(new Response(JSON.stringify({ id: 'bot' })))
    }) as unknown as typeof fetch

    await createMeetingBot({
      meetingUrl: 'https://meet.google.com/a',
      botName: 'B',
      face: 'jpeg',
      webhookUrl: 'https://w',
    })

    const detection = sent.automatic_leave?.bot_detection

    // Judging by activity would take people who only type in the chat for bots, and Recall has no
    // way to turn it off, so it starts later than any call lasts.
    expect(detection?.using_participant_events?.activate_after).toBe(86_400)
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

const { warn } = console
let logged: string[] = []

afterEach(() => {
  // eslint-disable-next-line no-console -- restored even when a test throws
  console.warn = warn
})

/** logEvent writes its record to console.warn; this collects what the test logs. */
function captureWarnings(): { lines: () => Record<string, unknown>[] } {
  logged = []
  // eslint-disable-next-line no-console
  console.warn = (line: unknown) => logged.push(String(line))

  return { lines: () => logged.map((line) => JSON.parse(line) as Record<string, unknown>) }
}

const sendBot = () =>
  createMeetingBot({
    meetingUrl: 'https://meet.google.com/a',
    botName: 'B',
    face: 'j',
    webhookUrl: 'https://w',
  })

describe('a refused request logs meeting_bot.failed', () => {
  test('an account out of credit is account-level', async () => {
    const warnings = captureWarnings()

    // Recall documents 402 as "Insufficient credit balance", with no code of its own.
    answer(402, { detail: 'Insufficient credit balance' })
    await expect(sendBot()).rejects.toThrow('Insufficient credit balance')
    expect(warnings.lines()).toEqual([
      expect.objectContaining({
        event: 'meeting_bot.failed',
        reason: 'request_failed',
        path: '/bot/',
        status: 402,
        account_level: true,
      }),
    ])
  })

  test('an error code nobody has seen before still counts', async () => {
    const warnings = captureWarnings()

    answer(418, { code: 'brand_new_failure', detail: '?' })
    await expect(sendBot()).rejects.toThrow('brand_new_failure')
    expect(warnings.lines()).toEqual([
      expect.objectContaining({
        event: 'meeting_bot.failed',
        reason: 'request_failed',
        status: 418,
        code: 'brand_new_failure',
        account_level: false,
      }),
    ])
  })

  test('leaving a call that already ended is not a failure', async () => {
    const warnings = captureWarnings()

    answer(400, { code: 'cannot_command_unstarted_bot', detail: 'Cannot send a command…' })
    await leaveMeeting('bot')
    expect(warnings.lines()).toEqual([])
  })
})

describe('meetingBotStatus', () => {
  test('a bot is in its call once Recall gave it any in_call status', async () => {
    answer(200, {
      status_changes: [
        { code: 'joining_call', sub_code: null },
        { code: 'in_call_recording', sub_code: null },
        { code: 'call_ended', sub_code: 'timeout_exceeded_everyone_left' },
      ],
    })
    await expect(meetingBotStatus('bot')).resolves.toMatchObject({ joined: true })
    answer(200, { status_changes: [{ code: 'in_waiting_room', sub_code: null }] })
    await expect(meetingBotStatus('bot')).resolves.toEqual({
      joined: false,
      last: { code: 'in_waiting_room', sub_code: null },
    })
  })
})

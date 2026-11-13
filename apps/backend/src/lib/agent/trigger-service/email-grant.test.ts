import { beforeEach, describe, expect, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'

import { APPROVE_EMAIL_GRANT, assertEmailGrantAuthorized, emailGrantBlocks } from './email-grant'

import type { InputRequest } from '../db/pending-decision'

const owner = 'fixture-owner'
const block = [
  'Standing email grant:',
  '- From: Acme <hello@example.com>, reply-to support@example.com',
  '- Purpose and template: day-one welcome',
  '- Recipients: users who signed up 24-48 hours ago, read from the users table',
  '- Dedupe: never twice to the same address',
  '- Per-run cap: 20',
].join('\n')
const instruction = `Mail new sign-ups.\n\n${block}\n\nReport the run.`
let requests: InputRequest[] = []

useAgentDb({ getConversationBySessionId: async () => ({ inputRequests: requests }) })
beforeEach(() => {
  requests = []
})

function approval(overrides: Partial<InputRequest> = {}): InputRequest {
  return {
    id: 'card-1',
    category: 'approval',
    question: 'Add this grant to the welcome Trigger?',
    body: `Schedule: daily 09:00\n\n${block}`,
    options: [APPROVE_EMAIL_GRANT, 'No'],
    askedAt: new Date(),
    status: 'answered',
    answeredBy: owner,
    answerChoices: [APPROVE_EMAIL_GRANT],
    ...overrides,
  }
}

const write = (
  next: string,
  extra: Partial<Parameters<typeof assertEmailGrantAuthorized>[0]> = {},
) =>
  assertEmailGrantAuthorized({
    next,
    triggerType: 'cron',
    principalUserId: owner,
    sessionId: 'session-1',
    ...extra,
  })

describe('standing email grant writes', () => {
  test('finds a block however it is spelled', () => {
    expect(emailGrantBlocks(instruction)).toEqual([block])
    expect(emailGrantBlocks('  standing   EMAIL grant -  cap 999')).toHaveLength(1)
    expect(emailGrantBlocks('Mail the people I name.')).toEqual([])
  })

  test('an instruction without a grant is not checked', async () => {
    await expect(write('Mail new sign-ups.', { triggerType: 'webhook' })).resolves.toBeUndefined()
  })

  test('adding a grant needs the owner to pick the fixed approval on a card quoting it', async () => {
    await expect(write(instruction)).rejects.toMatchObject({ code: 'email_grant_not_approved' })

    requests = [approval()]
    await expect(write(instruction)).resolves.toBeUndefined()
  })

  test('a card that does not approve this exact block by the owner does not count', async () => {
    for (const card of [
      approval({ answerChoices: ['No'] }),
      approval({ answeredBy: 'teammate' }),
      approval({ status: 'open', answeredBy: undefined, answerChoices: undefined }),
      approval({ category: 'preference' }),
      approval({ body: block.replace('cap: 20', 'cap: 200') }),
      approval({ body: block.replace('- Per-run cap: 20', '') }),
    ]) {
      requests = [card]
      await expect(write(instruction)).rejects.toMatchObject({ code: 'email_grant_not_approved' })
    }
    requests = [approval()]
    await expect(write(instruction, { sessionId: undefined })).rejects.toMatchObject({
      code: 'email_grant_not_approved',
    })
  })

  test('widening an approved grant needs a new approval; keeping or removing it does not', async () => {
    await expect(write(instruction, { previous: instruction })).resolves.toBeUndefined()
    await expect(write('Mail new sign-ups.', { previous: instruction })).resolves.toBeUndefined()
    await expect(
      write(instruction.replace('cap: 20', 'cap: 200'), { previous: instruction }),
    ).rejects.toMatchObject({ code: 'email_grant_not_approved' })
  })

  test('a webhook Trigger never holds a grant', async () => {
    requests = [approval()]
    await expect(write(instruction, { triggerType: 'webhook' })).rejects.toMatchObject({
      code: 'email_grant_webhook',
    })
  })
})

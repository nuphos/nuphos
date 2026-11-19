// The member's own Personal Credentials in the composer's selector (#3743).
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

import { agentLog } from './agent-log.ts'
import { client, must } from './binding-access-scenarios.ts'
import { artifacts, until } from './processes.ts'
import { newTask, send } from './ui.ts'

import type { Stack } from './stack.ts'
import type { Scenario } from './ui.ts'

const BACKEND_DIR = resolve(import.meta.dirname, '../../apps/backend')

/** Runs `script` against the database; it reads its arguments from process.argv. */
function inDatabase(stack: Stack, script: string, ...args: string[]): string {
  const run = `
    import { MongoClient } from 'mongodb'
    const client = await new MongoClient(process.argv[1]).connect()
    const db = client.db('nuphos_e2e')
    ${script}
    await client.close()`

  return execFileSync('bun', ['-e', run, stack.mongoUri, ...args], {
    cwd: BACKEND_DIR,
    timeout: 10_000,
  })
    .toString()
    .trim()
}

/** The newest conversation's own Personal Credential selection, as the turn's listing reads it. */
const selected = (stack: Stack, userId: string) =>
  inDatabase(
    stack,
    `const conversation = await db.collection('agent_conversations')
      .find({ userId: process.argv[2] }).sort({ updatedAt: -1 }).limit(1).next()
    console.log(JSON.stringify(conversation?.credentialAccess?.personalCredentialIds ?? null))`,
    userId,
  )

/** What the Google Calendar handout answered the turn marked `marker`, once it has. */
async function handout(stack: Stack, marker: string): Promise<{ status: number; code?: string }> {
  const answered = () =>
    agentLog(stack).find((entry) => entry.event === 'personal-token' && entry.marker === marker)

  await until(`the ${marker} turn to ask for its Google Calendar token`, async () =>
    Boolean(answered()),
  )

  return answered()!.result as { status: number; code?: string }
}

const NOT_SELECTED = 'personal_credential_not_selected'

export const personalCredentialScenarios: Scenario[] = [
  {
    // #3743: Google Personal Credentials were never offered, could not be unticked, and ignored
    // the selection. They now follow the connector rule: ticked in a new chat, refused by a list
    // without them, and kept by a conversation that never stored a list.
    name: 'a Google Personal Credential follows the connector rule: default, unticked, and no list',
    run: async (page, stack) => {
      const owner = client(stack.apiUrl, stack.token)
      const me = (await owner('GET', '/auth/me')).body as { user?: { id: string }; id?: string }
      const userId = me.user?.id ?? me.id ?? ''
      const login = 'e2e-calendar@example.com'
      let triggerId = ''

      // The Google OAuth consent can't run here, so the grant it stores is written directly.
      inDatabase(
        stack,
        `await db.collection('personal_credentials').insertOne({
          userId: process.argv[2], provider: 'google-calendar', providerUserId: 'e2e-google',
          login: process.argv[4], teamId: process.argv[3], encryptedRefreshToken: null,
          accessTokenExpiresAt: null, createdAt: new Date(), updatedAt: new Date(),
        })`,
        userId,
        stack.teamId,
        login,
      )

      try {
        // Options already loaded predate the grant.
        await page.reload()
        await newTask(page)
        await send(
          page,
          'Personal E2E_PERSONAL_TOKEN:google-calendar E2E_DELIVERY:personal-default',
        )
        await page.getByText('ACK E2E_DELIVERY:personal-default').waitFor()
        must(selected(stack, userId).includes('"google-calendar"'), 'a new chat to tick it')
        // Past the gate; this stack has no Google client, which is what it reports next.
        must(
          (await handout(stack, 'E2E_DELIVERY:personal-default')).code !== NOT_SELECTED,
          'a new chat to be handed it',
        )

        await page.getByRole('button', { name: 'Credentials', exact: true }).last().click()
        const row = page.getByRole('menuitemcheckbox', {
          name: `Google Calendar · You (${login}) · Personal`,
        })

        await row.waitFor()
        must((await row.getAttribute('aria-checked')) === 'true', 'the row to start ticked')
        await page.screenshot({ path: `${artifacts}/personal-google-row-light.png` })
        await row.click()
        await until(
          'the untick to be saved on the conversation',
          async () => selected(stack, userId) === '[]',
        )
        await page.screenshot({ path: `${artifacts}/personal-google-unticked-light.png` })
        await page.keyboard.press('Escape')
        await send(page, 'Again E2E_PERSONAL_TOKEN:google-calendar E2E_DELIVERY:personal-blocked')
        must(
          (await handout(stack, 'E2E_DELIVERY:personal-blocked')).code === NOT_SELECTED,
          'a list without it to refuse it',
        )

        // A conversation with no list keeps its reach. Desktop stores one with every message, so
        // the list is removed and a Trigger, which leaves the selection as it is, runs the turn.
        const sessionId = inDatabase(
          stack,
          `const c = await db.collection('agent_conversations')
            .find({ userId: process.argv[2] }).sort({ updatedAt: -1 }).limit(1).next()
          console.log(c.sessionId)`,
          userId,
        )
        const created = await owner('POST', '/agent/triggers', {
          teamId: stack.teamId,
          targetSessionId: sessionId,
          name: 'Personal credential scope',
          triggerType: 'cron',
          cronExpression: '0 * * * *',
          messageTemplate: 'Run E2E_PERSONAL_TOKEN:google-calendar E2E_DELIVERY:personal-trigger',
        })

        triggerId = (created.body as { id: string }).id
        inDatabase(
          stack,
          `await db.collection('agent_conversations').updateOne({ sessionId: process.argv[2] }, {
            $unset: { 'credentialAccess.personalCredentialIds': '' },
          })`,
          sessionId,
        )
        must(
          (await owner('POST', `/agent/triggers/${triggerId}/test-fire?teamId=${stack.teamId}`))
            .status < 300,
          'the Trigger to fire',
        )
        must(
          (await handout(stack, 'E2E_DELIVERY:personal-trigger')).code !== NOT_SELECTED,
          'a conversation with no list to keep it',
        )
      } finally {
        if (triggerId) await owner('DELETE', `/agent/triggers/${triggerId}?teamId=${stack.teamId}`)
        inDatabase(
          stack,
          `await db.collection('personal_credentials').deleteMany({ login: process.argv[2] })`,
          login,
        )
      }
    },
  },
]

// The member's own Personal Credentials in the composer's selector (#3743).
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

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

export const personalCredentialScenarios: Scenario[] = [
  {
    // Google Personal Credentials were never offered, so a member could neither see nor tick them.
    name: 'a connected Google Personal Credential is a row in the composer selector, and ticking it selects it',
    run: async (page, stack) => {
      const owner = client(stack.apiUrl, stack.token)
      const me = (await owner('GET', '/auth/me')).body as { user?: { id: string }; id?: string }
      const userId = me.user?.id ?? me.id ?? ''
      const login = 'e2e-calendar@example.com'

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
        await newTask(page)
        await send(page, 'Personal credential E2E_DELIVERY:personal-google')
        await page.getByText('ACK E2E_DELIVERY:personal-google').waitFor()
        await page.getByRole('button', { name: 'Credentials', exact: true }).last().click()
        const row = page.getByRole('menuitemcheckbox', {
          name: `Google Calendar · You (${login}) · Personal`,
        })

        await row.waitFor()
        await page.screenshot({ path: `${artifacts}/personal-google-row-light.png` })
        must((await row.getAttribute('aria-checked')) === 'false', 'the row to start unticked')
        await row.click()
        await until('the tick to be saved on the conversation', async () =>
          inDatabase(
            stack,
            `const conversation = await db.collection('agent_conversations')
              .find({ userId: process.argv[2] }).sort({ updatedAt: -1 }).limit(1).next()
            console.log(JSON.stringify(conversation?.credentialAccess?.personalCredentialIds ?? []))`,
            userId,
          ).includes('"google-calendar"'),
        )
        await page.screenshot({ path: `${artifacts}/personal-google-ticked-light.png` })
        await page.keyboard.press('Escape')
      } finally {
        inDatabase(
          stack,
          `await db.collection('personal_credentials').deleteMany({ login: process.argv[2] })`,
          login,
        )
      }
    },
  },
]

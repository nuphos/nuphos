// What a Bot may use, as its chat shows it. Runs in the Bot chat the scenarios before opened.
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

import { artifacts, until } from './processes.ts'

import type { Stack } from './stack.ts'
import type { Scenario } from './ui.ts'

const BACKEND_DIR = resolve(import.meta.dirname, '../../apps/backend')
const CHOOSE = "This Bot can't use any computers or credentials yet. Choose what it may use."

/** The E2E Bot's stored credentialAccess. */
function botAccess(stack: Stack): { sessionId: string; access: unknown } {
  const script = `
    import { MongoClient } from 'mongodb'
    const client = await new MongoClient(process.argv[1]).connect()
    const bots = client.db('nuphos_e2e').collection('agent_conversations')
    const bot = await bots.findOne({ title: 'E2E Bot', avatar: { $exists: true } })
    console.log(JSON.stringify({ sessionId: bot.sessionId, access: bot.credentialAccess ?? null }))
    await client.close()`

  return JSON.parse(
    execFileSync('bun', ['-e', script, stack.mongoUri], {
      cwd: BACKEND_DIR,
      timeout: 10_000,
    }).toString(),
  ) as { sessionId: string; access: unknown }
}

export const botAccessScenarios: Scenario[] = [
  {
    // #3259: a Bot made with "+" stored no selection, so its picker showed every computer
    // selected while the Bot could use none of them. It now shows none, and asks.
    name: 'a Bot made with "+" can use nothing until its owner chooses, and its chat says so',
    run: async (page, stack) => {
      const made = botAccess(stack)

      if (made.access) throw new Error('"+" stored computers or credentials nobody chose')
      await page.getByText(CHOOSE).waitFor()
      await page.screenshot({ path: `${artifacts}/bot-choose-access-light.png` })
      // Any choice saved, even of nothing, is the Bot's answer: the prompt goes.
      const response = await fetch(
        `${stack.apiUrl}/agent/conversations/${made.sessionId}/credentials`,
        {
          method: 'PATCH',
          headers: { authorization: `Bearer ${stack.token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ teamId: stack.teamId, credentialAccess: { deviceIds: [] } }),
        },
      )

      if (!response.ok) throw new Error(`Saving a choice answered ${String(response.status)}`)
      await page.reload()
      await page.getByRole('button', { name: 'Computers' }).last().waitFor()
      await until(
        'the prompt to go once a choice is saved',
        async () => (await page.getByText(CHOOSE).count()) === 0,
      )
      await page.screenshot({ path: `${artifacts}/bot-choose-access-chosen-light.png` })
      // The picker shows what the Bot can use: the team-wide kinds, and nothing it was not given.
      await page.getByRole('button', { name: 'Agent credentials' }).last().click()
      await page.waitForTimeout(500)
      await page.screenshot({ path: `${artifacts}/bot-access-picker-light.png` })
      await page.keyboard.press('Escape')
    },
  },
]

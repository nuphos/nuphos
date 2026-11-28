// #4103: Codex speaks only the OpenAI Responses API, so a custom provider that does not serve
// `<base URL>/responses` is refused when it is saved, with the reason in plain words.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { artifacts, until } from './processes.ts'
import { openComputers } from './ui.ts'

import type { Scenario } from './ui.ts'
import type { AddressInfo } from 'node:net'

export const customProviderScenarios: Scenario[] = [
  {
    name: 'a Codex custom provider without the Responses API is refused at save, with the reason',
    run: async (page, stack) => {
      const asked: string[] = []
      // A chat-completions provider: `/v1/responses` refuses an empty body, as a provider that
      // serves the Responses API does, and a pasted endpoint gets a 404 under it.
      const provider = createServer((req, res) => {
        asked.push(req.url ?? '')
        res.writeHead(req.url === '/v1/responses' ? 400 : 404).end('{"detail":"Not Found"}')
      })

      await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve))
      const base = `http://127.0.0.1:${String((provider.address() as AddressInfo).port)}/v1`

      // This computer's own Codex, signed in: its runtime is what holds the custom provider.
      const bin = join(homedir(), '.local', 'bin')
      const codex = join(bin, 'codex')

      mkdirSync(bin, { recursive: true })
      writeFileSync(
        codex,
        `#!/usr/bin/env node
const args = process.argv.slice(2)
if (args.includes('--version')) console.log('codex-cli 0.167.0')
else if (args[0] === 'login' && args[1] === 'status') console.log('Logged in using ChatGPT')
`,
        { mode: 0o755, flag: 'wx' },
      )
      try {
        const { deviceId } = await page.evaluate(() => window.api.localRuntimeRefresh())

        await until('this computer’s Codex runtime to be listed', () =>
          page.evaluate(
            async ({ teamId, deviceId }) =>
              (await window.api.atlasListRuntimeInstances(teamId)).some(
                (instance) =>
                  instance.provider === 'codex' && instance.local?.deviceId === deviceId,
              ),
            { teamId: stack.teamId, deviceId },
          ),
        )
        // Its custom provider is at the top of the runtime's details.
        await openComputers(page)
        await page.getByRole('button', { name: 'Open Codex details' }).first().click()
        const card = page.getByRole('complementary', { name: /Codex/ })
        const save = async (baseUrl: string) => {
          await card.getByLabel('Base URL').fill(baseUrl)
          await card.getByLabel('API key').fill('sk-e2e-provider')
          // Codex takes several model IDs, each in its own model catalog entry (#5214).
          await card.getByLabel('Model IDs').fill('model-a\nmodel-b')
          await card.getByRole('button', { name: 'Save', exact: true }).click()
        }

        await card.getByRole('button', { name: 'Set up', exact: true }).click()
        await save(`${base}/chat/completions`)
        // The toast, and the alert that reads it out.
        await page
          .getByText(/Codex needs the OpenAI Responses API, which this URL doesn’t serve/u)
          .first()
          .waitFor()
        await page.waitForTimeout(500)
        await page.screenshot({ path: join(artifacts, 'custom-provider-1-refused.png') })
        if ((await page.getByText(/Error invoking remote method/u).count()) > 0)
          throw new Error('The refusal shows the IPC wrapper')

        // The base URL itself passes the check and is saved; a dev build keeps its key in memory.
        await save(base)
        await page.getByText('Custom provider saved').first().waitFor()
        await page.waitForTimeout(500)
        await page.screenshot({ path: join(artifacts, 'custom-provider-2-base-url.png') })
        if (asked.join(' ') !== '/v1/chat/completions/responses /v1/responses')
          throw new Error(`The provider was asked ${asked.join(', ')}`)
        await card.getByRole('button', { name: 'Remove', exact: true }).click()
        await card.getByRole('button', { name: 'Set up', exact: true }).waitFor()
        // Escape closes the details and leaves Settings.
        await page.keyboard.press('Escape')
        await page.getByText('Back to app', { exact: true }).waitFor({ state: 'detached' })
      } finally {
        provider.close()
        rmSync(codex, { force: true })
        await page.evaluate(() => window.api.localRuntimeRefresh())
      }
    },
  },
]

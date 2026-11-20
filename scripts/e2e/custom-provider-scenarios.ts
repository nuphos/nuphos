// #4103: Codex speaks only the OpenAI Responses API, so a custom provider that does not serve
// `<base URL>/responses` is refused when it is saved, with the reason in plain words.
import { createServer } from 'node:http'
import { join } from 'node:path'

import { openLocalRuntime } from './install-scenarios.ts'
import { artifacts } from './processes.ts'

import type { Scenario } from './ui.ts'
import type { AddressInfo } from 'node:net'

export const customProviderScenarios: Scenario[] = [
  {
    name: 'a Codex custom provider without the Responses API is refused at save, with the reason',
    run: async (page) => {
      const asked: string[] = []
      // A chat-completions provider: `/v1/responses` refuses an empty body, as a provider that
      // serves the Responses API does, and a pasted endpoint gets a 404 under it.
      const provider = createServer((req, res) => {
        asked.push(req.url ?? '')
        res.writeHead(req.url === '/v1/responses' ? 400 : 404).end('{"detail":"Not Found"}')
      })

      await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve))
      const base = `http://127.0.0.1:${String((provider.address() as AddressInfo).port)}/v1`

      try {
        await openLocalRuntime(page)
        const card = page
          .locator('div')
          .filter({ has: page.getByText('Codex', { exact: true }) })
          .filter({ has: page.getByRole('button', { name: 'Check again' }) })
          .last()
        const save = async (baseUrl: string) => {
          await card.getByLabel('Base URL').fill(baseUrl)
          await card.getByLabel('API key').fill('sk-e2e-provider')
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

        // The base URL itself passes the check. A dev build keeps no key in the OS credential
        // store, so the save stops there, and says so.
        await save(base)
        await page
          .getByText(/no secure credential store/u)
          .first()
          .waitFor()
        await page.waitForTimeout(500)
        await page.screenshot({ path: join(artifacts, 'custom-provider-2-base-url.png') })
        if (asked.join(' ') !== '/v1/chat/completions/responses /v1/responses')
          throw new Error(`The provider was asked ${asked.join(', ')}`)
        await card.getByRole('button', { name: 'Cancel', exact: true }).click()
        await page.getByText('Back to app', { exact: true }).click()
      } finally {
        provider.close()
      }
    },
  },
]

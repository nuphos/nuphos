// #5183: this computer's Codex signs in with an API key from its card, a turned-down key says
// so, and its custom provider is tested before it is saved, with each answer in the form.
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { artifacts, until } from './processes.ts'
import { openComputers } from './ui.ts'

import type { Scenario } from './ui.ts'
import type { AddressInfo } from 'node:net'
import type { Page } from 'playwright-core'

// A Codex CLI that signs in with any key but one with "revoked" in it, and keeps the key where
// `CODEX_HOME` says, as the real one does with `cli_auth_credentials_store="file"`.
const CODEX = `#!/usr/bin/env node
const fs = require('fs'), path = require('path'), os = require('os')
const args = process.argv.slice(2)
const auth = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'auth.json')
if (args.includes('--version')) console.log('codex-cli 0.167.0')
else if (args.includes('--with-api-key')) {
  const key = fs.readFileSync(0, 'utf8').trim()
  if (key.includes('revoked')) {
    console.error('Error: 401 Unauthorized: Incorrect API key provided')
    process.exit(1)
  }
  fs.mkdirSync(path.dirname(auth), { recursive: true })
  fs.writeFileSync(auth, JSON.stringify({ OPENAI_API_KEY: key }))
} else if (args.includes('status')) {
  if (fs.existsSync(auth)) console.log('Logged in using an API key')
  else {
    console.error('Not logged in')
    process.exit(1)
  }
}
`

const shot = (page: Page, name: string) =>
  page.waitForTimeout(400).then(() => page.screenshot({ path: join(artifacts, `${name}.png`) }))

/** The app's own folder for this account, where it keeps the saved custom providers. */
function userDir(userId: string): string {
  const config = join(homedir(), '.config')
  const found = readdirSync(config)
    .map((name) => join(config, name, 'local-runtime', 'users', userId))
    .find((dir) => existsSync(dir))

  if (!found) throw new Error(`No local-runtime folder for ${userId} under ${config}`)

  return found
}

export const runtimeSettingsScenarios: Scenario[] = [
  {
    name: 'Codex signs in with an API key from its card, and its custom provider is tested first',
    run: async (page) => {
      // Answers as a Responses API does: 401 for a turned-down key, 400 for an empty body.
      const provider = createServer((req, res) => {
        let status = req.url === '/v1/responses' ? 400 : 404

        if (req.headers.authorization?.includes('wrong')) status = 401
        res.writeHead(status).end('{"detail":"e2e"}')
      })

      await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve))
      const base = `http://127.0.0.1:${String((provider.address() as AddressInfo).port)}/v1`
      // A port nothing answers on: one that was free a moment ago.
      const closed = createServer()

      await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve))
      const silent = `http://127.0.0.1:${String((closed.address() as AddressInfo).port)}/v1`

      closed.close()
      const bin = join(homedir(), '.local', 'bin')
      const codex = join(bin, 'codex')
      let saved: string | undefined

      mkdirSync(bin, { recursive: true })
      writeFileSync(codex, CODEX, { mode: 0o755, flag: 'wx' })
      try {
        const { userId } = await page.evaluate(() => window.api.localRuntimeRefresh())

        await openComputers(page)
        await page.getByRole('button', { name: 'Open Codex details' }).first().click()
        const card = page.getByRole('complementary', { name: /Codex/ })

        // Account or key: the key one, a turned-down key first.
        await card.getByRole('button', { name: 'Sign in with Codex' }).click()
        const dialog = page.getByRole('dialog', { name: /Connect Codex/ })

        await dialog.getByRole('radio', { name: 'API key' }).click()
        const key = dialog.getByLabel('OpenAI API key')
        const signIn = async (value: string) => {
          await key.fill(value)
          await dialog.getByRole('button', { name: 'Sign in', exact: true }).click()
        }

        await shot(page, 'runtime-settings-1-key')
        await signIn('sk-e2e-revoked-0000000000000000')
        await page.getByText('The API key was not accepted.').first().waitFor()
        await shot(page, 'runtime-settings-2-key-rejected')
        await signIn('sk-e2e-accepted-000000000000000')
        await dialog.getByText(/Codex is connected/).waitFor({ timeout: 60_000 })
        await shot(page, 'runtime-settings-3-key-accepted')
        await dialog.getByRole('button', { name: 'Done' }).click()

        // The custom provider: the URL rule as it is typed.
        await card.getByRole('button', { name: 'Set up', exact: true }).click()
        const url = card.getByLabel('Base URL')

        await url.fill('http://gateway.example')
        await card
          .getByText('The base URL must use https://, or http:// to this computer.')
          .waitFor()
        await shot(page, 'runtime-settings-4-url-rule')
        await card.getByLabel('API key', { exact: true }).fill('sk-e2e-wrong-provider')
        const test = async (baseUrl: string, answer: string | RegExp) => {
          await url.fill(baseUrl)
          await card.getByRole('button', { name: 'Test connection' }).click()
          await card.getByText(answer).first().waitFor({ timeout: 20_000 })
        }

        await test(base, 'The provider turned down this key.')
        await shot(page, 'runtime-settings-5-test-key')
        await card.getByLabel('API key', { exact: true }).fill('sk-e2e-provider')
        await test(`${base}/chat/completions`, /Codex needs the OpenAI Responses API/u)
        await shot(page, 'runtime-settings-6-test-api')
        await test(silent, /Couldn’t reach/u)
        await card.getByRole('button', { name: 'Save anyway' }).waitFor()
        await shot(page, 'runtime-settings-7-test-unreachable')
        await test(base, 'Key accepted')
        await shot(page, 'runtime-settings-8-test-passed')
        // A dev build keeps no key in a credential store: the refusal stays in the form.
        await card.getByRole('button', { name: 'Save', exact: true }).click()
        await card
          .getByRole('alert')
          .getByText(/no secure credential store/u)
          .waitFor()
        await shot(page, 'runtime-settings-9-save-refused')
        await card.getByRole('button', { name: 'Cancel', exact: true }).click()

        // A saved one, as a packaged app would leave it: its key is never shown, only replaced.
        saved = join(userDir(userId ?? ''), 'custom-providers.json')
        writeFileSync(saved, JSON.stringify({ codex: { baseUrl: base, models: ['gpt-e2e'] } }))
        await page.evaluate(() => window.api.localRuntimeRefresh())
        await until('the saved custom provider to show', async () =>
          card.getByRole('button', { name: 'Edit', exact: true }).isVisible(),
        )
        await card.getByRole('button', { name: 'Edit', exact: true }).click()
        await card.getByText('•••• saved').waitFor()
        await shot(page, 'runtime-settings-10-key-saved')
        await card.getByRole('button', { name: 'Replace' }).click()
        await card.getByLabel('API key', { exact: true }).waitFor()
        await shot(page, 'runtime-settings-11-replace')
        await card.getByRole('button', { name: 'Cancel', exact: true }).click()
        await page.keyboard.press('Escape')
        await page.getByText('Back to app', { exact: true }).waitFor({ state: 'detached' })
      } finally {
        provider.close()
        if (saved) rmSync(saved, { force: true })
        await page.evaluate(() => window.api.localRuntimeApplyApiKey('codex', null)).catch(() => {})
        rmSync(codex, { force: true })
        await page.evaluate(() => window.api.localRuntimeRefresh())
      }
    },
  },
]

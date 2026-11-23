// Scenarios about connecting a provider from the Connectors dialog.
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'

import { artifacts, until } from './processes.ts'

import type { Scenario } from './ui.ts'

// What Cloudflare's authorize endpoint sends back, before any sign-in, for a
// scope the OAuth client is not registered for.
const REJECTION =
  "The requested scope is invalid, unknown, or malformed. The OAuth 2.0 Client is not allowed to request scope 'dns-firewall.read'."

export const connectorScenarios: Scenario[] = [
  {
    // #3848: Connect used to leave the dialog for Settings without starting authorization.
    name: 'a personal Connect starts authorization without leaving the current route',
    run: async (page) => {
      const fixture = await page.evaluateHandle(async (modulePath) => {
        const { api } = await import(modulePath)
        const originalStart = api.atlasStartPersonalCredential
        const originalOpen = api.appOpenExternal
        const started: string[] = []
        const opened: string[] = []
        const authorizeUrl = 'https://github.com/login/oauth/authorize?client_id=e2e&state=e2e'

        api.atlasStartPersonalCredential = async (provider: string) => {
          started.push(provider)

          return { authorizeUrl }
        }
        api.appOpenExternal = async (url: string) => {
          opened.push(url)
        }

        return {
          started,
          opened,
          authorizeUrl,
          restore: () => {
            api.atlasStartPersonalCredential = originalStart
            api.appOpenExternal = originalOpen
          },
        }
      }, '/src/api.ts')

      try {
        await page.getByRole('button', { name: 'Connectors' }).click()
        const dialog = page.getByRole('dialog', { name: 'Connectors', exact: true })
        const route = page.url()

        await dialog.getByRole('button', { name: 'Add GitHub', exact: true }).click()
        const service = page.getByRole('dialog', { name: 'GitHub', exact: true })

        await service.getByRole('button', { name: 'Connect', exact: true }).click()
        await until('the personal OAuth URL to open', async () =>
          fixture.evaluate((state) => state.opened.length > 0),
        )
        const evidence = await fixture.evaluate((state) => ({
          providerRequests: state.started,
          openedUrls: state.opened,
          expectedUrl: state.authorizeUrl,
        }))

        assert.deepEqual(evidence.providerRequests, ['github'])
        assert.deepEqual(evidence.openedUrls, [evidence.expectedUrl])
        assert.equal(page.url(), route)
        await service.waitFor({ state: 'visible' })
        assert.equal(
          await page.getByRole('heading', { name: 'Personal Credentials', exact: true }).count(),
          0,
        )
        writeFileSync(
          `${artifacts}/personal-connect-start.json`,
          JSON.stringify({ ...evidence, routeBefore: route, routeAfter: page.url() }, null, 2),
        )
        await page.screenshot({ path: `${artifacts}/personal-connect-start.png` })
        await service.getByLabel('Close modal').click()
      } finally {
        await fixture.evaluate((state) => state.restore())
        await fixture.dispose()
      }
    },
  },
  {
    // #2918: Cloudflare's rejection reached only the nuphos:// deep link; when the app did
    // not receive it, the dialog waited ten minutes and people retried.
    name: 'Cloudflare rejecting the authorization shows its reason in the app',
    run: async (page, stack) => {
      await page.getByRole('button', { name: 'Connectors' }).click()
      await page.getByLabel('Add Cloudflare').click()
      const share = page.getByRole('button', { name: 'All members', exact: true })
      const connect = page.getByRole('button', { name: 'Connect with Cloudflare' })
      const action = await connect.elementHandle()

      assert.equal(
        await share.evaluate(
          (field, button) =>
            Boolean(field.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING),
          action,
        ),
        true,
        'the sharing field appears before the authorization action',
      )
      await share.click()
      await page.screenshot({ path: `${artifacts}/cloudflare-connect-sharing.png` })
      await connect.click()
      await page.getByText('Waiting for browser authorization…').waitFor()
      assert.deepEqual(stack.cloudflareShare(), { mode: 'team', memberIds: [] })
      await page.screenshot({ path: `${artifacts}/cloudflare-waiting.png` })
      // Cloudflare's redirect, answered in place of it. No deep link reaches the app.
      const query = new URLSearchParams({
        state: stack.cloudflareState(),
        error: 'invalid_scope',
        error_description: REJECTION,
      })
      const response = await fetch(`${stack.apiUrl}/cloudflare-app/setup?${query.toString()}`)

      if (!response.ok) throw new Error(`The callback answered ${String(response.status)}`)
      await page
        .getByRole('region', { name: 'Notifications' })
        .getByText(/not allowed to request scope 'dns-firewall\.read'/)
        .waitFor()
      await page.screenshot({ path: `${artifacts}/cloudflare-rejected.png` })
      await page.keyboard.press('Escape')
      await page.getByRole('dialog', { name: 'Connect Cloudflare' }).waitFor({ state: 'detached' })
      // Leave Connectors closed for the next scenario.
      const connectors = page.getByRole('dialog', { name: 'Connectors' })

      await connectors.getByLabel('Close modal').click()
      await connectors.waitFor({ state: 'detached' })
    },
  },
]

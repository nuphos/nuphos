// Scenarios about connecting a provider from the Connectors dialog.
import { fakeCloudflare } from './fake-cloudflare.ts'
import { artifacts } from './processes.ts'

import type { Scenario } from './ui.ts'

// What Cloudflare's authorize endpoint sends back, before any sign-in, for a
// scope the OAuth client is not registered for.
const REJECTION =
  "The requested scope is invalid, unknown, or malformed. The OAuth 2.0 Client is not allowed to request scope 'dns-firewall.read'."

export const connectorScenarios: Scenario[] = [
  {
    // #2918: Connect asks Cloudflare only for scopes the OAuth client is registered with,
    // read with the backend's token; without a working token it says why instead.
    name: 'Cloudflare connect requests registered scopes, or says why it cannot',
    run: async (page, stack) => {
      fakeCloudflare.rejectToken = true
      await page.getByRole('button', { name: 'Connectors' }).click()
      await page.getByLabel('Add Cloudflare').click()
      await page.getByRole('button', { name: 'Connect with Cloudflare' }).click()
      await page
        .getByRole('region', { name: 'Notifications' })
        .getByText(/registered scopes .*Authentication error/)
        .waitFor()
      await page.screenshot({ path: `${artifacts}/cloudflare-token-rejected.png` })
      fakeCloudflare.rejectToken = false
      // The dialog's Read for Developer platform; dns.read and workers-scripts.read are
      // not registered, so neither is requested.
      const response = await fetch(
        `${stack.apiUrl}/teams/${stack.teamId}/cloudflare-accounts/start-oauth`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${stack.token}` },
          body: JSON.stringify({ access: { dns_and_zones: 'write', developer_platform: 'read' } }),
        },
      )
      const { authorizeUrl } = (await response.json()) as { authorizeUrl: string }
      const scope = new URL(authorizeUrl).searchParams.get('scope')

      console.log(`Cloudflare scope requested: ${scope ?? ''}`)
      if (
        scope !==
        'account-settings.read user-details.read memberships.read zone.read dns.write offline_access'
      )
        throw new Error(`Unexpected scope ${scope ?? ''}`)
      await page.keyboard.press('Escape')
      await page.getByRole('dialog', { name: 'Connect Cloudflare' }).waitFor({ state: 'detached' })
      const connectors = page.getByRole('dialog', { name: 'Connectors' })

      await connectors.getByLabel('Close modal').click()
      await connectors.waitFor({ state: 'detached' })
    },
  },
  {
    // #2918: Cloudflare's rejection reached only the nuphos:// deep link; when the app did
    // not receive it, the dialog waited ten minutes and people retried.
    name: 'Cloudflare rejecting the authorization shows its reason in the app',
    run: async (page, stack) => {
      await page.getByRole('button', { name: 'Connectors' }).click()
      await page.getByLabel('Add Cloudflare').click()
      await page.getByRole('button', { name: 'Connect with Cloudflare' }).click()
      await page.getByText('Waiting for browser authorization…').waitFor()
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

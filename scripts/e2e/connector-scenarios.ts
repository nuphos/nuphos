// Scenarios about connecting a provider from the Connectors dialog.
import { artifacts } from './processes.ts'

import type { Scenario } from './ui.ts'

// What Cloudflare's authorize endpoint sends back, before any sign-in, for a
// scope the OAuth client is not registered for.
const REJECTION =
  "The requested scope is invalid, unknown, or malformed. The OAuth 2.0 Client is not allowed to request scope 'dns-firewall.read'."

export const connectorScenarios: Scenario[] = [
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
      await page.keyboard.press('Escape')
    },
  },
]

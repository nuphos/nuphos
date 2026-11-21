// #3802: a webhook Trigger whose secret leaked could not get a new one.
import { client, createWebhook, deliver, taskWith } from './trigger-scenarios.ts'
import { newTask, send } from './ui.ts'

import type { Scenario } from './ui.ts'

export const webhookSecretScenarios: Scenario[] = [
  {
    name: 'rotating a webhook secret refuses the old one at once, and the new one delivers',
    // The delivery with the old secret is expected to be refused.
    expected: /"path":"\/webhooks\/[^"]+","status":401/u,
    run: async (page, stack) => {
      await newTask(page)
      await send(page, 'Home of the rotated webhook E2E_DELIVERY:rotate-home')
      await page.getByText('ACK E2E_DELIVERY:rotate-home').waitFor()
      const sessionId = await taskWith(stack, 'E2E_DELIVERY:rotate-home')
      const hook = await createWebhook(stack, sessionId, 'Rotated alerts')
      const rotated = await client(stack)<{ webhookUrl: string; webhookSecret: string }>(
        'POST',
        `/agent/triggers/${hook.id}/rotate-secret?teamId=${stack.teamId}`,
      )

      const old = await deliver(stack, hook, { state: 'firing', id: 'rotate-old' })
      const fresh = await deliver(
        stack,
        { ...hook, webhookSecret: rotated.webhookSecret },
        { state: 'firing', id: 'rotate-new' },
      )

      console.log(`Old secret: ${String(old.status)}, new secret: ${String(fresh.status)}`)
      if (
        old.status !== 401 ||
        fresh.status !== 200 ||
        rotated.webhookSecret === hook.webhookSecret
      )
        throw new Error(`Rotation did not swap the secret: ${JSON.stringify({ old, fresh })}`)
      if (!rotated.webhookUrl.endsWith(`/webhooks/${hook.id}`))
        throw new Error(`Rotation answered another URL: ${rotated.webhookUrl}`)
      await page.getByText('ACK E2E_DELIVERY:rotate-new').waitFor()
    },
  },
]

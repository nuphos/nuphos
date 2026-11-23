// #4361: an administrator adds a webhook in Team settings, and the team's own endpoint gets
// what its conversations and Tasks do, retried after a failure and switched off by 410 Gone.
// An MCP client then manages webhooks with nuphos_webhooks.
import { writeFileSync } from 'node:fs'

import { client, must } from './binding-access-scenarios.ts'
import { REPORT_DATA } from './fixture-mcp.mjs'
import { mcp } from './mcp-scenarios.ts'
import { artifacts, until } from './processes.ts'
import { replyWith, webhookRequests, webhookUrl } from './webhook-receiver.ts'

import type { Scenario } from './ui.ts'
import type { WebhookRequest } from './webhook-receiver.ts'
import type { Page } from 'playwright-core'

const KEY = 'Bearer e2e-webhook-key'

async function openWebhooks(page: Page) {
  await page
    .getByRole('button', { name: /^Search/ })
    .first()
    .click()
  await page.keyboard.type('Team settings')
  await page.getByRole('option', { name: 'Team settings' }).first().click()
  await page.getByRole('searchbox', { name: 'Search settings' }).fill('Webhooks')
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: /Add webhook/ }).waitFor()
}

async function shoot(page: Page, name: string) {
  await page.evaluate(() => {
    document.documentElement.classList.remove('dark')
    document.documentElement.classList.add('light')
  })
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${artifacts}/${name}.png` })
}

/** Waits for a request that `wanted` picks, and checks it is signed and identified as sent. */
async function received(label: string, wanted: (request: WebhookRequest) => boolean) {
  let found: WebhookRequest | undefined

  await until(`the endpoint to receive ${label}`, async () => {
    found = webhookRequests().find(wanted)

    return found
  })
  must(found!.headers.authorization === KEY, `${label} to carry the saved Authorization header`)
  must(found!.headers['webhook-id'] === found!.body.id, `${label} to carry its id as webhook-id`)

  return found!
}

type Client = ReturnType<typeof client>

/** Adds the endpoint in Settings with a secret header, and checks the header never comes back. */
async function addWebhook(page: Page, as: Client, teamId: string) {
  const main = page.locator('main').last()

  await openWebhooks(page)
  await main.getByRole('button', { name: /Add webhook/ }).click()
  await page.getByPlaceholder('e.g. Ops alerts').fill('E2E endpoint')
  await page.locator('input[placeholder="https://example.com/nuphos-webhook"]').fill(webhookUrl())
  await page.getByRole('checkbox', { name: /Task reported/ }).click()
  await page.getByRole('button', { name: /Add header/ }).click()
  await page.getByLabel('Header name').fill('Authorization')
  await page.getByLabel('Header value').fill(KEY)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await main.getByText('E2E endpoint').waitFor()
  const listed = await as('GET', `/teams/${teamId}/webhooks`)

  must(listed.status === 200 && !listed.text.includes(KEY), 'the list to omit header values')
  await main.getByRole('button', { name: 'Edit', exact: true }).click()
  const value = page.getByLabel('Header value')

  must((await value.inputValue()) === '', 'the saved header value to stay hidden')
  must(
    (await value.getAttribute('placeholder')) === 'Saved. Leave blank to keep it.',
    'the form to say the header is saved',
  )
  await shoot(page, 'webhook-saved-header')
  // Escape would leave Settings too.
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await main.getByRole('button', { name: 'Send test' }).click()
  await page.getByText('Test event delivered').waitFor()
  await received('the test event', (r) => r.body.type === 'webhook.test')
  await shoot(page, 'webhook-test-delivered')
}

/** A conversation that hands work to a Task, which reports back (`reportBack` in the fixture). */
async function delegate(ask: (prompt: string) => Promise<string>) {
  const parent = await ask('Delegate E2E_REPORT_BACK E2E_DELIVERY:webhook-parent')

  await received(
    'the conversation’s finished reply',
    (r) => r.body.type === 'session.turn.completed' && r.body.data.session_id === parent,
  )
  const reported = await received('the Task’s report', (r) => r.body.type === 'task.reported')

  must(reported.body.data.session_id !== parent, 'task.reported to name the Task')
  must(
    JSON.stringify(reported.body.data.task_report?.data) === JSON.stringify(REPORT_DATA),
    `task.reported to carry the report's data unchanged (#4751), got ${JSON.stringify(reported.body.data)}`,
  )
  // #4749: a session with no parent reports too, and only the webhook hears it.
  const report = {
    label: 'Report',
    report_id: 'top-1',
    status: 'done',
    summary: 'Top-level work finished.',
  }
  const top = await ask(
    `Finish E2E_CALL report_task ${JSON.stringify(report)} E2E_DELIVERY:webhook-top`,
  )
  const own = await received(
    'the top-level session’s report',
    (r) => r.body.type === 'task.reported' && r.body.data.session_id === top,
  )

  must(own.body.data.task_report?.status === 'done', 'task.reported to carry the report')
}

/** A 503 is retried with the same event; 410 switches the endpoint off. */
async function failures(
  page: Page,
  as: Client,
  teamId: string,
  ask: (p: string) => Promise<string>,
) {
  const retried = await ask('Reply E2E_DELIVERY:webhook-retry')

  replyWith(retried, 503)
  const first = await received(
    'the reply that fails once',
    (r) => r.status === 503 && r.body.data.session_id === retried,
  )

  await received('its retry', (r) => r.status === 200 && r.body.id === first.body.id)
  const gone = await ask('Reply E2E_DELIVERY:webhook-gone')

  replyWith(gone, 410)
  await received('the reply answered 410', (r) => r.body.data.session_id === gone)
  let hook: { id: string; enabled: boolean } | undefined

  await until('the endpoint to be switched off', async () => {
    const reply = await as('GET', `/teams/${teamId}/webhooks`)

    hook = (reply.body as { webhooks: { id: string; enabled: boolean }[] }).webhooks[0]

    return hook?.enabled === false
  })
  await page.getByRole('button', { name: 'Back to app' }).click()
  await openWebhooks(page)
  await page.getByText(/Switched off: The endpoint answered 410 Gone/).waitFor()
  await shoot(page, 'webhook-switched-off')
  await page.getByRole('button', { name: 'Back to app' }).click()

  return hook!.id
}

/** An MCP client adds an endpoint that gets the next reply, then removes both endpoints. */
async function overMcp(
  tool: ReturnType<typeof mcp>['tool'],
  teamId: string,
  ask: (p: string) => Promise<string>,
  switchedOff: string,
) {
  const manage = async (args: Record<string, unknown>) => {
    const reply = await tool<{ webhook?: { id: string } }>('nuphos_webhooks', {
      team_id: teamId,
      ...args,
    })

    must(!reply.isError, `nuphos_webhooks to ${String(args.action)}, got ${JSON.stringify(reply)}`)

    return reply
  }
  const created = await manage({
    action: 'create',
    name: 'E2E MCP endpoint',
    url: webhookUrl(),
    events: ['session.turn.completed'],
    headers: [{ name: 'Authorization', value: KEY }],
  })

  must(!JSON.stringify(created).includes(KEY), 'nuphos_webhooks to omit header values')
  const replied = await ask('Reply E2E_DELIVERY:webhook-mcp')

  // The endpoint added in Settings is switched off, so only this one sends it.
  await received(
    'the reply, at the endpoint added over MCP',
    (r) => r.body.data.session_id === replied,
  )
  await manage({ action: 'delete', webhook_id: created.structuredContent!.webhook!.id })
  await manage({ action: 'delete', webhook_id: switchedOff })
}

export const webhookScenarios: Scenario[] = [
  {
    name: 'a team webhook receives its conversations and Tasks, retries, and stops on 410',
    run: async (page, stack) => {
      const as = client(stack.apiUrl, stack.token)
      const { tool } = mcp(as)
      const ask = async (prompt: string) => {
        const asked = await tool<{ session_id: string }>('nuphos_ask', {
          team_id: stack.teamId,
          prompt,
          wait: false,
        })

        return asked.structuredContent!.session_id
      }

      await addWebhook(page, as, stack.teamId)
      await delegate(ask)
      const id = await failures(page, as, stack.teamId, ask)

      await overMcp(tool, stack.teamId, ask, id)
      const log = webhookRequests().map(({ headers, body, status }) => ({
        status,
        'webhook-id': headers['webhook-id'],
        authorization: headers.authorization === KEY ? 'the saved value' : headers.authorization,
        type: body.type,
        session_id: body.data.session_id,
      }))

      writeFileSync(`${artifacts}/webhook-requests.json`, JSON.stringify(log, null, 2))
    },
  },
]

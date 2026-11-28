// #5323: each OpenCode runtime on this computer can run on a custom provider of its own. Two run
// a real OpenCode turn, each on a loopback stub of its own; removing one deletes its provider. A
// dev build keeps no key in the OS credential store, so the stubs, on this computer, need none.
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
} from 'node:fs'
import { createServer } from 'node:http'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { artifacts, until } from './processes.ts'
import { newTask, openComputers, pickInRow, send } from './ui.ts'

import type { Scenario } from './ui.ts'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Page } from 'playwright-core'

// npm's latest, the one Desktop installs.
const OPENCODE = '1.19.6'

/** An OpenAI-compatible API on loopback whose every answer names it, and the models asked. */
async function stub(name: string, asked: string[]): Promise<{ url: string; server: Server }> {
  const server = createServer((req, res) => {
    let body = ''

    req.on('data', (chunk: Buffer) => {
      body += chunk.toString()
    })
    req.on('end', () => {
      if (!req.url?.endsWith('/chat/completions')) return res.writeHead(404).end()
      const json = (body ? JSON.parse(body) : {}) as { model?: string; stream?: boolean }
      const content = `Hello from ${name}.`
      const base = { id: 'chatcmpl-e2e', created: 0, model: json.model }

      asked.push(json.model ?? '')
      if (!json.stream) {
        const choice = { index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }

        return res
          .writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify({ ...base, object: 'chat.completion', choices: [choice] }))
      }
      const chunk = (delta: object, finish: string | null) =>
        `data: ${JSON.stringify({ ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`

      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write(chunk({ role: 'assistant', content }, null))
      res.write(chunk({}, 'stop'))
      res.end('data: [DONE]\n\n')
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

  return { url: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/v1`, server }
}

/** OpenCode from npm where this computer looks for it; one already there is used as it is. */
function installOpenCode(): () => void {
  const link = join(homedir(), '.local', 'bin', 'opencode')

  if (existsSync(link)) return () => {}
  const dir = mkdtempSync(join(tmpdir(), 'nuphos-e2e-opencode-'))

  execFileSync('npm', ['install', '--no-audit', '--no-fund', `opencode-ai@${OPENCODE}`], {
    cwd: dir,
    stdio: 'ignore',
  })
  mkdirSync(dirname(link), { recursive: true })
  symlinkSync(join(dir, 'node_modules', '.bin', 'opencode'), link)

  return () => {
    rmSync(link, { force: true })
    rmSync(dir, { recursive: true, force: true })
  }
}

async function shot(page: Page, name: string) {
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(artifacts, `opencode-provider-${name}.png`) })
}

/** Adds an OpenCode named `label` on this computer, its provider chosen in the same dialog. */
async function addOpenCode(page: Page, label: string, baseUrl: string, model: string) {
  await openComputers(page)
  await page
    .getByRole('button', { name: /^New runtime on / })
    .first()
    .click()
  await page.getByRole('menuitem', { name: 'OpenCode', exact: true }).click()
  await page.getByLabel('Runtime name').fill(label)
  await page.getByRole('combobox', { name: 'Provider' }).click()
  if (model === 'model-a') await shot(page, '1-provider-select')
  await page.getByRole('option', { name: 'Custom endpoint' }).click()
  await page.getByLabel('Base URL').fill(baseUrl)
  await page.getByLabel('Model IDs').fill(model)
  if (model === 'model-a') await shot(page, '2-new-runtime')
  await page.getByRole('button', { name: 'Continue' }).click()
  // Saved with its runtime, it has no sign-in to go through.
  await page.getByText(/ is ready on /).waitFor({ timeout: 60_000 })
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await page.getByText('Back to app', { exact: true }).click()
}

async function turn(page: Page, computer: string, label: string, reply: string) {
  await newTask(page)
  await page.getByRole('button', { name: /^Runtime:/ }).click()
  await pickInRow(page, computer, new RegExp(label))
  await send(page, `Say hello, ${label}`)
  // An earlier Task's same reply stays in the page, hidden.
  await page.getByText(reply).filter({ visible: true }).first().waitFor({ timeout: 180_000 })
}

/** The provider in a runtime's details, and Azure's form with a pasted URL, never saved. */
async function details(page: Page, label: string) {
  await openComputers(page)
  await page.getByRole('button', { name: `Open ${label} details` }).click()
  const card = page.getByRole('complementary', { name: new RegExp(label) })

  await card.getByRole('button', { name: 'Edit', exact: true }).click()
  await shot(page, '4-details')
  await card.getByRole('combobox', { name: 'Provider' }).click()
  await page.getByRole('option', { name: 'Azure OpenAI' }).click()
  await card.getByLabel('Resource name').fill('https://acme-openai.openai.azure.com')
  await card.getByLabel('Deployment names').fill('gpt-4o-prod')
  await card.getByText(/Enter only the resource name/u).waitFor()
  await shot(page, '5-details-azure-url')
  await card.getByLabel('Resource name').fill('acme-openai')
  // A saved provider's key is never shown; Replace opens a field for a new one.
  await card.getByRole('button', { name: 'Replace', exact: true }).click()
  await card.getByLabel('API key').fill('e2e-fictional-key')
  await shot(page, '6-details-azure')
  await card.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.keyboard.press('Escape')
  await page.getByText('Back to app', { exact: true }).waitFor({ state: 'detached' })
}

const files = (dir: string) => readdirSync(dir, { recursive: true, encoding: 'utf8' }) as string[]

export const opencodeProviderScenarios: Scenario[] = [
  {
    name: 'two OpenCode runtimes each run a turn on a custom provider of their own, and removing one deletes its own',
    run: async (page, stack) => {
      const asked = { a: [] as string[], b: [] as string[] }
      const [a, b] = [await stub('stub A', asked.a), await stub('stub B', asked.b)]
      const uninstall = installOpenCode()
      const added: string[] = []
      const remove = (instanceId: string) =>
        page.evaluate(
          async ({ teamId, instanceId }) => {
            const { deviceId } = await window.api.localRuntimeGetState()

            await window.api.boxRemoveAgent(deviceId ?? '', teamId, instanceId)
          },
          { teamId: stack.teamId, instanceId },
        )

      try {
        await page.evaluate(() => {
          document.documentElement.classList.remove('dark')
          document.documentElement.classList.add('light')
        })
        await page.evaluate(() => window.api.localRuntimeRefresh())
        await openComputers(page)
        const computer = (
          (await page
            .getByRole('button', { name: /^New runtime on / })
            .first()
            .getAttribute('aria-label')) ?? ''
        ).replace('New runtime on ', '')

        await page.keyboard.press('Escape')
        await addOpenCode(page, 'Acme gateway A', a.url, 'model-a')
        await addOpenCode(page, 'Acme gateway B', b.url, 'model-b')
        const { instances = [], instanceProviders = {} } = await page.evaluate(() =>
          window.api.localRuntimeGetState(),
        )
        const [first, second] = ['Acme gateway A', 'Acme gateway B'].map(
          (label) => instances.find((instance) => instance.label === label)?.instanceId ?? '',
        )

        added.push(first, second)
        if (!instanceProviders[first] || !instanceProviders[second])
          throw new Error(`Both providers: ${JSON.stringify(instanceProviders)}`)

        await turn(page, computer, 'Acme gateway A', 'Hello from stub A.')
        await turn(page, computer, 'Acme gateway B', 'Hello from stub B.')
        await shot(page, '3-turn')
        // Each runtime asked only its own stub, for its own model.
        if (
          asked.a.length === 0 ||
          asked.b.length === 0 ||
          asked.a.some((model) => model !== 'model-a') ||
          asked.b.some((model) => model !== 'model-b')
        )
          throw new Error(`The stubs were asked for ${JSON.stringify(asked)}`)
        await details(page, 'Acme gateway B')

        // OpenCode reads the key from the launch, never from its config file. The workspace is
        // <data dir>/users/<user>/workspace; each added runtime is under instances.
        const workspace =
          (await page.evaluate(() => window.api.localRuntimeGetState())).workspace ?? ''
        const instanceDir = (id: string) =>
          join(dirname(dirname(dirname(workspace))), 'instances', id)
        const config = files(instanceDir(second))
          .filter((file) => file.endsWith('opencode.json'))
          .map((file) => readFileSync(join(instanceDir(second), file), 'utf8'))
          .join('')

        if (!config.includes(b.url) || !config.includes('{env:NUPHOS_OPENCODE_PROVIDER_KEY}'))
          throw new Error(`B's opencode.json: ${config}`)

        await remove(first)
        added.shift()
        await until('the removed runtime’s directory and provider to go', async () => {
          const state = await page.evaluate(() => window.api.localRuntimeGetState())

          return (
            !existsSync(instanceDir(first)) &&
            !state.instanceProviders?.[first] &&
            Boolean(state.instanceProviders?.[second])
          )
        })
        // The one left still runs on its own provider.
        const before = asked.b.length

        await turn(page, computer, 'Acme gateway B', 'Hello from stub B.')
        if (asked.b.length === before) throw new Error('B did not ask its stub after A went')
      } finally {
        for (const instanceId of added) await remove(instanceId).catch(() => {})
        a.server.close()
        b.server.close()
        uninstall()
        await page.evaluate(() => window.api.localRuntimeRefresh())
      }
    },
  },
]

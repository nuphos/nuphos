// A Codex on Azure OpenAI and a Claude Code on a gateway, each added on this computer with a
// provider of its own, run a real turn on a loopback stub; removing one deletes its own. Every key
// is fictional, and a dev build keeps it in memory.
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { AZURE_STAND_IN_PORT, anthropicStub, azureStub } from './agent-provider-stubs.ts'
import { artifacts, until } from './processes.ts'
import { newTask, openComputers, pickInRow, send } from './ui.ts'

import type { Request } from './agent-provider-stubs.ts'
import type { Scenario } from './ui.ts'
import type { Page } from 'playwright-core'

/** A vendor's CLI from npm where this computer looks for it; whatever was there comes back after. */
function install(bin: string, pkg: string): () => void {
  const link = join(homedir(), '.local', 'bin', bin)
  const aside = `${link}.e2e-aside`
  const dir = mkdtempSync(join(tmpdir(), `nuphos-e2e-${bin}-`))

  execFileSync('npm', ['install', '--no-audit', '--no-fund', pkg], { cwd: dir, stdio: 'ignore' })
  mkdirSync(dirname(link), { recursive: true })
  if (existsSync(link)) renameSync(link, aside)
  symlinkSync(join(dir, 'node_modules', '.bin', bin), link)

  return () => {
    rmSync(link, { force: true })
    if (existsSync(aside)) renameSync(aside, link)
    rmSync(dir, { recursive: true, force: true })
  }
}

async function shot(page: Page, name: string) {
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(artifacts, `agent-provider-${name}.png`) })
}

/** Adds `agent` named `label` on this computer, its provider filled in by `fill`. */
async function add(page: Page, agent: string, label: string, fill: () => Promise<void>) {
  await openComputers(page)
  await page
    .getByRole('button', { name: /^New runtime on / })
    .first()
    .click()
  await page.getByRole('menuitem', { name: agent, exact: true }).click()
  await page.getByLabel('Runtime name').fill(label)
  await fill()
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

const turns = (seen: Request[], path: RegExp) =>
  seen.filter((request) => request.method === 'POST' && path.test(request.url))

export const agentProviderScenarios: Scenario[] = [
  {
    name: 'a Codex on Azure OpenAI and a Claude Code on a gateway each run a turn, and removing one deletes its own',
    run: async (page, stack) => {
      const azure = await azureStub(AZURE_STAND_IN_PORT, 'Hello from Azure.')
      const gateway = await anthropicStub('Hello from the gateway.')
      const uninstall: (() => void)[] = []
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
        uninstall.push(install('codex', '@openai/codex@0.172.0'))
        uninstall.push(install('claude', '@anthropic-ai/claude-code@2.1.332'))
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
        await add(page, 'Codex', 'Acme Azure', async () => {
          await page.getByRole('combobox', { name: 'Provider' }).click()
          await shot(page, '1-codex-providers')
          await page.getByRole('option', { name: 'Azure OpenAI' }).click()
          await page.getByLabel('Resource name').fill('acme-openai')
          await page.getByLabel('API key').fill('e2e-fictional-key')
          await page.getByLabel('Deployment names').fill('gpt-4o-prod')
          await shot(page, '2-codex-azure')
        })
        await add(page, 'Claude Code', 'Acme gateway', async () => {
          await page.getByRole('combobox', { name: 'Provider' }).click()
          await shot(page, '3-claude-providers')
          await page.getByRole('option', { name: 'Custom endpoint' }).click()
          await page.getByLabel('Base URL').fill(gateway.url)
          await page.getByLabel('API key').fill('e2e-fictional-key')
          await page.getByLabel('Model IDs').fill('claude-e2e-model')
          await shot(page, '4-claude-custom')
        })
        const { instances = [], instanceProviders = {} } = await page.evaluate(() =>
          window.api.localRuntimeGetState(),
        )
        const [codex, claude] = ['Acme Azure', 'Acme gateway'].map(
          (label) => instances.find((instance) => instance.label === label)?.instanceId ?? '',
        )

        added.push(codex, claude)
        if (!instanceProviders[codex] || !instanceProviders[claude])
          throw new Error(`Both providers: ${JSON.stringify(instanceProviders)}`)

        await turn(page, computer, 'Acme Azure', 'Hello from Azure.')
        await turn(page, computer, 'Acme gateway', 'Hello from the gateway.')
        await shot(page, '5-turn')
        // Azure's v1 API: no api-version, the key as a bearer token, the deployment as the model.
        const codexTurns = turns(azure.seen, /^\/openai\/v1\/responses$/u)
        const claudeTurns = turns(gateway.seen, /^\/v1\/messages(\?|$)/u)

        if (
          codexTurns.length === 0 ||
          codexTurns.some((request) => !request.bearer || request.model !== 'gpt-4o-prod') ||
          claudeTurns.length === 0 ||
          claudeTurns.some((request) => !request.bearer || request.model !== 'claude-e2e-model')
        )
          throw new Error(`Asked ${JSON.stringify({ azure: azure.seen, gateway: gateway.seen })}`)

        // The workspace is <data dir>/users/<user>/workspace; each added runtime is under
        // instances. Codex reads its key from the launch, never from config.toml.
        const workspace =
          (await page.evaluate(() => window.api.localRuntimeGetState())).workspace ?? ''
        const instanceDir = (id: string) =>
          join(dirname(dirname(dirname(workspace))), 'instances', id)
        const config = (
          readdirSync(instanceDir(codex), { recursive: true, encoding: 'utf8' }) as string[]
        )
          .filter((file) => file.endsWith('config.toml'))
          .map((file) => readFileSync(join(instanceDir(codex), file), 'utf8'))
          .join('')

        if (!config.includes('name = "Azure"') || config.includes('e2e-fictional-key'))
          throw new Error(`Codex's config.toml: ${config}`)

        await remove(codex)
        added.shift()
        await until('the removed runtime’s directory and provider to go', async () => {
          const state = await page.evaluate(() => window.api.localRuntimeGetState())

          return (
            !existsSync(instanceDir(codex)) &&
            !state.instanceProviders?.[codex] &&
            Boolean(state.instanceProviders?.[claude])
          )
        })
        // The one left still runs on its own provider.
        const before = claudeTurns.length

        await turn(page, computer, 'Acme gateway', 'Hello from the gateway.')
        if (turns(gateway.seen, /^\/v1\/messages(\?|$)/u).length === before)
          throw new Error('Claude Code did not ask its gateway after Codex went')
      } finally {
        for (const instanceId of added) await remove(instanceId).catch(() => {})
        azure.server.close()
        gateway.server.close()
        for (const undo of uninstall) undo()
        await page.evaluate(() => window.api.localRuntimeRefresh())
      }
    },
  },
]

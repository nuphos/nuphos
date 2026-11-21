// The real local codex-acp adapter receives a wrapper whose platform binary is missing.
// No vendor CLI is installed, and an existing Codex installation is never overwritten.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { inDatabase } from './agent-sign-in-scenarios.ts'
import { artifacts, until } from './processes.ts'
import { send } from './ui.ts'

import type { Scenario } from './ui.ts'

const REINSTALL =
  "This runtime couldn't start on its computer. Switch this Bot to another runtime, or reinstall it there from its official installer, then resend your message."

export const botCliLocalScenarios: Scenario[] = [
  {
    name: 'this computer offers Install Codex for a missing platform binary during Bot onboarding and later replies',
    expected: /Codex process has exited with code 1:[\s\S]*ENOENT/,
    run: async (page, stack) => {
      const bin = join(homedir(), '.local', 'bin')
      const wrapper = join(bin, 'codex')
      const missing = join(artifacts, 'npm-codex', 'vendor', 'codex', 'codex')

      mkdirSync(bin, { recursive: true })
      writeFileSync(
        wrapper,
        `#!/usr/bin/env node
const args = process.argv.slice(2)
if (args.includes('--version')) console.log('codex-cli 0.167.0')
else if (args[0] === 'login' && args[1] === 'status') console.log('Logged in using ChatGPT')
else {
  require('node:child_process').spawn(${JSON.stringify(missing)}, args).on('error', error => {
    console.error(error)
    process.exit(1)
  })
}
`,
        { mode: 0o755, flag: 'wx' },
      )
      try {
        const state = await page.evaluate(() => window.api.localRuntimeRefresh())

        if (!state.agents.codex.cli?.installed || state.agents.codex.cli.path !== wrapper)
          throw new Error('The local runtime did not resolve the test Codex wrapper')
        let runtimeId = ''

        await until('the local Codex runtime to be listed', async () => {
          runtimeId = await page.evaluate(
            async ({ teamId, deviceId }) => {
              const instances = await window.api.atlasListRuntimeInstances(teamId)

              return (
                instances.find(
                  (instance) =>
                    instance.provider === 'codex' && instance.local?.deviceId === deviceId,
                )?.id ?? ''
              )
            },
            { teamId: stack.teamId, deviceId: state.deviceId },
          )

          return runtimeId
        })
        const chatId = await page.evaluate(
          async ({ teamId, runtimeId }) => {
            const bot = await window.api.agentCreateBot(teamId, {
              onboarding: true,
              title: 'Local Codex repair',
              runtimeId,
              agentRuntime: 'codex',
            })
            const chat = await window.api.agentCreateChannel(teamId)

            await window.api.agentAddChannelAgent(chat.sessionId, teamId, bot.sessionId)
            await window.api.agentStartBotOnboarding(bot.sessionId, teamId, chat.sessionId)

            return chat.sessionId
          },
          { teamId: stack.teamId, runtimeId },
        )

        await page.reload()
        await page.getByRole('tab', { name: /^Bots/ }).click()
        await page
          .locator('[data-sidebar-row]')
          .filter({ hasText: 'Local Codex repair' })
          .first()
          .click()
        await page.getByText(`couldn’t reply: ${REINSTALL}`).first().waitFor()
        await page.getByRole('button', { name: 'Install Codex', exact: true }).first().waitFor()
        await page.evaluate(() => {
          document.documentElement.classList.remove('dark')
          document.documentElement.classList.add('light')
        })
        await page.screenshot({ path: join(artifacts, 'bot-local-codex-onboarding-light.png') })
        // When the Bot's couldn't-reply line in the chat was written.
        const failedAt = () =>
          inDatabase(
            stack.mongoUri,
            `const row = await db.collection('agent_conversations').findOne({ sessionId: process.argv[2] })
            console.log((row?.timelineEvents ?? []).findLast((e) => e.kind === 'agent_reply_failed')?.at?.toISOString() ?? '')`,
            chatId,
          ).trim()
        const sent = new Date().toISOString()

        await send(page, 'Try Codex again')
        // The later failure replaces the line: the chat keeps one per Bot (#4056).
        await until('the later reply to fail too', async () => failedAt() > sent)
        await until(
          'one line for the Bot',
          async () => (await page.getByText(`couldn’t reply: ${REINSTALL}`).count()) === 1,
        )
        await page.getByRole('button', { name: 'Install Codex', exact: true }).last().waitFor()
        await page.screenshot({ path: join(artifacts, 'bot-local-codex-reply-light.png') })
      } finally {
        rmSync(wrapper)
        await page.evaluate(() => window.api.localRuntimeRefresh())
      }
    },
  },
]

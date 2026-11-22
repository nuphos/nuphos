// #3250: people meet Bots and Tasks, so no label on screen says "Agent".
// Runs in the Task the scenario before opened and answered.
import { artifacts } from './processes.ts'

import type { Scenario } from './ui.ts'
import type { Page } from 'playwright-core'

async function noAgentLabel(page: Page, shot: string) {
  await page.screenshot({ path: `${artifacts}/${shot}.png` })
  const labels = await page
    .getByText(/^Agents?$/)
    .filter({ visible: true })
    .count()

  if (labels > 0) throw new Error(`${String(labels)} visible labels say Agent on ${shot}`)
}

export const agentWordScenarios: Scenario[] = [
  {
    name: 'a Task and the shortcuts list never say Agent',
    run: async (page) => {
      await noAgentLabel(page, 'agent-words-task')
      await page.getByRole('button', { name: 'Help', exact: true }).click()
      await page.getByRole('menuitem', { name: /Keyboard shortcuts/ }).click()
      await page.getByText('Send message', { exact: true }).waitFor()
      await noAgentLabel(page, 'agent-words-shortcuts')
      await page.keyboard.press('Escape')
    },
  },
  {
    // Batch 2 of #3250: the cards to add to the home page describe Bots and tasks.
    name: 'the home cards on offer never say agent',
    run: async (page) => {
      const stats = page.getByRole('button', { name: 'Stats', exact: true })
      const gallery = page.getByRole('dialog')

      await stats.click()
      await page.getByRole('button', { name: 'Add card', exact: true }).click()
      await gallery.getByText('Add cards', { exact: true }).waitFor()
      // The dialog fades in; shoot it once it has settled.
      await page.waitForTimeout(1_000)
      await page.screenshot({ path: `${artifacts}/agent-words-cards.png` })
      const said = (await gallery.innerText())
        .split('\n')
        .filter((line) => /\bagents?\b/i.test(line))

      if (said.length > 0) throw new Error(`The home cards say agent: ${said.join(' | ')}`)
      await page.keyboard.press('Escape')
      await stats.click()
    },
  },
  {
    // Batch 3 of #3250: Settings describe Bots, tasks and runtimes.
    name: 'Settings pages never say agent',
    // The e2e backend has no skills store, so the Skills page's list answers 503.
    expected: /Skills store is not configured|skills_store_unconfigured/,
    run: async (page) => {
      const main = page.locator('main').last()
      const said: string[] = []

      for (const [settings, section, shot] of [
        ['Team settings', 'Instructions', 'agent-words-team-instructions'],
        ['User settings', 'Local runtime', 'agent-words-local-runtime'],
        // Batch 5: the team's skills, memories and audit log.
        ['Team settings', 'Skills', 'agent-words-team-skills'],
        ['Team settings', 'Memories', 'agent-words-team-memories'],
        ['Team settings', 'Audit log', 'agent-words-team-audit'],
      ]) {
        await page
          .getByRole('button', { name: /^Search/ })
          .first()
          .click()
        await page.keyboard.type(settings!)
        await page.getByRole('option', { name: settings }).first().click()
        await page.getByRole('searchbox', { name: 'Search settings' }).fill(section!)
        await page.keyboard.press('Enter')
        // Skills shows its name in a toolbar, not a heading.
        await main
          .getByRole('heading')
          .or(main.getByText(section!, { exact: true }))
          .first()
          .waitFor()
        // The section loads its data after it opens; shoot it once it has settled.
        await page.waitForTimeout(1_500)
        await page.screenshot({ path: `${artifacts}/${shot!}.png` })
        // ssh-agent, AGENTS.md and the host's log file are names, not agents.
        const lines = (await main.innerText())
          .split('\n')
          .filter((line) =>
            /\bagents?\b/i.test(line.replace(/ssh-agent|AGENTS\.md|nuphos-agent\.log/g, '')),
          )

        said.push(...lines.map((line) => `${section!}: ${line}`))
        await page.getByRole('button', { name: 'Back to app' }).click()
      }
      if (said.length > 0) throw new Error(`Settings say agent: ${said.join(' | ')}`)
    },
  },
  {
    // Batch 4 of #3250: the Connectors list describes Nuphos, Bots and tasks.
    name: 'the Connectors list never says agent',
    run: async (page) => {
      await page.getByRole('button', { name: 'Connectors', exact: true }).click()
      const aws = page.getByRole('button', { name: 'Add AWS' })
      const slack = page.getByRole('button', { name: 'Add Slack' })
      // The smallest part of the page that holds both rows: the list itself, not the sidebar.
      const list = aws.locator('xpath=ancestor::*[.//button[@aria-label="Add Slack"]][1]')

      await aws.waitFor()
      await slack.scrollIntoViewIfNeeded()
      await page.waitForTimeout(1_000)
      await page.screenshot({ path: `${artifacts}/agent-words-connectors.png` })
      const said = (await list.innerText()).split('\n').filter((line) => /\bagents?\b/i.test(line))

      if (said.length > 0) throw new Error(`The Connectors list says agent: ${said.join(' | ')}`)
      await page.keyboard.press('Escape')
    },
  },
]

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

import { artifacts, until } from '../processes.ts'
import { setBotDetails } from '../ui.ts'

import type { Scenario } from '../ui.ts'
import type { Page } from 'playwright-core'

const NAME = 'Layout Review Bot'
const details = (page: Page) => page.getByRole('complementary', { name: 'Bot details' })
const region = (page: Page) =>
  details(page).getByRole('region', { name: 'Bot instructions', exact: true })
const toggle = (page: Page) =>
  region(page).getByRole('button', { name: 'Bot instructions', exact: true })
const handle = (page: Page) =>
  region(page).getByRole('button', { name: 'Drag to reorder: Bot instructions', exact: true })
const order = (page: Page) =>
  details(page)
    .locator('[data-summary-section]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-summary-section')))

async function shoot(page: Page, name: string) {
  if (name !== 'mid-drag') await page.waitForTimeout(800)
  await page.screenshot({ path: `${artifacts}/summary-${name}-light.png` })
}

async function openBot(page: Page) {
  await page.getByRole('tab', { name: /^Bots/ }).click()
  await page.locator('[data-sidebar-row]').filter({ hasText: NAME }).first().click()
  await page.locator(`[aria-placeholder="Message ${NAME}"]`).waitFor()
  await setBotDetails(page, true)
  await region(page).waitFor()
}

const scenario: Scenario = {
  name: 'summary sections preserve drafts and team preferences through pointer and keyboard reorder',
  run: async (page, stack) => {
    const api = async (path: string, body: object) => {
      const response = await fetch(`${stack.apiUrl}${path}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${stack.token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })

      assert.ok(response.ok, `${path}: ${response.status}`)

      return response.json()
    }

    await api('/agent/bots', { teamId: stack.teamId, title: NAME, avatar: '07-ada' })
    await openBot(page)
    await page.evaluate(() => {
      document.documentElement.classList.remove('dark')
      document.documentElement.classList.add('light')
      localStorage.setItem('theme', 'light')
    })
    const initial = await order(page)

    assert.ok(initial.includes('instructions'))
    await shoot(page, 'expanded')
    await toggle(page).click()
    assert.equal(await toggle(page).getAttribute('aria-expanded'), 'false')
    await shoot(page, 'collapsed')
    await region(page).getByRole('button', { name: 'Edit instructions' }).click()
    const draft = region(page).getByRole('textbox', { name: 'Bot instructions' })

    await draft.fill('Draft: review the weekly project notes before replying.')
    await toggle(page).click()
    await toggle(page).click()
    assert.equal(
      await draft.inputValue(),
      'Draft: review the weekly project notes before replying.',
    )
    await handle(page).focus()
    await handle(page).press('ArrowDown')
    await until('keyboard reorder', async () => (await order(page))[1] === 'instructions')
    assert.ok(await handle(page).evaluate((node) => node === document.activeElement))
    assert.equal(
      await draft.inputValue(),
      'Draft: review the weekly project notes before replying.',
    )
    await handle(page).press('ArrowUp')
    assert.deepEqual(await order(page), initial)
    await region(page).getByRole('button', { name: 'Cancel', exact: true }).click()
    const source = await handle(page).boundingBox()
    const last = await details(page).locator('[data-summary-section]').last().boundingBox()

    assert.ok(source && last)
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2)
    await page.mouse.down()
    await page.mouse.move(source.x + source.width / 2, source.y + 12, { steps: 4 })
    await page.waitForTimeout(150)
    await page.mouse.move(source.x + source.width / 2, last.y + last.height - 12, { steps: 30 })
    await shoot(page, 'mid-drag')
    await page.mouse.up()
    await until('pointer reorder', async () => (await order(page)).at(-1) === 'instructions')
    await page.waitForTimeout(600)
    await shoot(page, 'reordered')
    const savedOrder = await order(page)

    await toggle(page).click()
    await page.reload()
    await region(page).waitFor()
    assert.deepEqual(await order(page), savedOrder)
    assert.equal(await toggle(page).getAttribute('aria-expanded'), 'false')
    await shoot(page, 'reloaded')
    const other = await api('/teams', { name: 'Layout Second Team' })

    const fixtureUrl = execFileSync(
      'bun',
      [
        '-e',
        `
      import { MongoClient } from 'mongodb'
      const client = await new MongoClient(process.argv[1]).connect()
      const runtime = await client.db('nuphos_e2e').collection('claude_code_runtimes')
        .findOne({ teamId: process.argv[2], label: 'E2E fixture agent' })
      console.log(runtime.url)
      await client.close()`,
        stack.mongoUri,
        stack.teamId,
      ],
      {
        cwd: resolve(import.meta.dirname, '../../../apps/backend'),
      },
    )
      .toString()
      .trim()

    assert.equal(new URL(fixtureUrl).hostname, '127.0.0.1')
    await api(`/teams/${other.team.id}/agent-runtimes/external`, {
      url: fixtureUrl,
      provider: 'claude-code',
      label: 'Layout fixture agent',
      authKey: 'local-e2e-openab-transport-key-123456789',
      controlKey: 'local-e2e-openab-control-key-123456789',
    })
    await api('/agent/bots', { teamId: other.team.id, title: NAME, avatar: '07-ada' })
    const switchTeam = async (name: string) => {
      await page
        .getByText(/^(?:E2E|Layout Second Team)$/)
        .first()
        .click()
      await page.getByRole('menuitem', { name: 'Switch workspace' }).click()
      await page.getByRole('menuitem', { name: new RegExp(`${name}$`) }).click()
      await openBot(page)
    }

    await switchTeam('Layout Second Team')
    assert.deepEqual(await order(page), initial)
    assert.equal(await toggle(page).getAttribute('aria-expanded'), 'true')
    await toggle(page).click()
    await page.reload()
    await region(page).waitFor()
    assert.equal(await toggle(page).getAttribute('aria-expanded'), 'false')
    await switchTeam('E2E')
    assert.deepEqual(await order(page), savedOrder)
    assert.equal(await toggle(page).getAttribute('aria-expanded'), 'false')
    await shoot(page, 'team-return')
    // Leave the next Bot scenario with its original team layout.
    await page.evaluate(
      (teamId) => localStorage.removeItem(`chat-summary-layout:${teamId}`),
      stack.teamId,
    )
    await page.reload()
    await setBotDetails(page, false)
    await page.locator('[data-sidebar-row]').filter({ hasText: 'E2E Bot' }).first().click()
  },
}

export default scenario

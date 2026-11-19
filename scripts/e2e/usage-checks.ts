// Checks and captures the token usage scenarios share.
import { api } from './dashboard-scenarios.ts'
import { artifacts } from './processes.ts'

import type { Stack } from './stack.ts'
import type { Locator, Page } from 'playwright-core'

/** The whole section, scrolled to the top of the window first, so a tall one is not cut off. */
export async function shot(section: Locator, name: string) {
  await section.evaluate((element) => element.scrollIntoView({ block: 'start' }))
  await section.screenshot({ path: `${artifacts}/${name}.png` })
}

/** Filters take several values per dimension: the member picked by clicking is ticked. */
export async function captureFilterMenu(page: Page, section: Locator) {
  // Filters take several values per dimension: the member picked by clicking is ticked.
  await section.getByRole('button', { name: 'Filter', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Member' }).click()
  await page.getByRole('menuitemcheckbox', { checked: true }).waitFor()
  await page.screenshot({ path: `${artifacts}/token-usage-filter-menu.png` })
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
}

/** As the second member and as the owner. A Task started in the app is private by default, so
 *  the member gets the team's numbers by member, but the owner's conversations only as the
 *  one merged row, with no id or name of theirs; the owner gets their own. */
export async function checkNamesByRole(
  stack: Stack,
  ids: { sessionId: string; privateId: string; owner: string },
  teammateToken: string,
) {
  const now = Date.now()
  const read = async (token: string, groupBy: string) => {
    const query = new URLSearchParams({
      from: new Date(now - 7 * 86_400_000).toISOString(),
      to: new Date(now + 86_400_000).toISOString(),
      groupBy,
    })
    const answer = await api(stack, token)(
      'GET',
      `/teams/${stack.teamId}/usage/query?${query.toString()}`,
    )

    return answer.body as unknown as { rows: { keys: Record<string, string | null> }[] }
  }
  const byMember = await read(teammateToken, 'member')
  const asTeammate = await read(teammateToken, 'conversation')
  const asOwner = await read(stack.token, 'conversation')
  const conversations = (answer: typeof asOwner) => answer.rows.map((row) => row.keys.conversation)

  if (!byMember.rows.some((row) => row.keys.member === ids.owner))
    throw new Error('A member does not see the team’s numbers')
  if (JSON.stringify(conversations(asTeammate)) !== JSON.stringify(['private:others']))
    throw new Error(`A member sees another’s conversations: ${JSON.stringify(asTeammate)}`)
  if (
    JSON.stringify(asTeammate).includes(ids.sessionId) ||
    JSON.stringify(asTeammate).includes(ids.privateId)
  )
    throw new Error('A member is told of another’s private conversation')
  if (
    !conversations(asOwner).includes(ids.sessionId) ||
    !conversations(asOwner).includes(ids.privateId)
  )
    throw new Error('The owner does not see their own conversations')
}

/** A member's own computer is named, and a teammate's private conversation is one merged row. */
export async function computersAndPrivate(page: Page, section: Locator) {
  const table = section.getByRole('table', { name: 'Token usage by group' })

  await section.getByRole('combobox', { name: 'Group by' }).click()
  await page.getByRole('option', { name: 'Computer' }).click()
  await table.getByRole('columnheader', { name: 'Computer' }).waitFor()
  const computer = table.getByRole('row').filter({ hasNotText: 'Not recorded' }).nth(1)
  const label = await computer.getByRole('cell').first().innerText()

  if (/^[0-9a-f-]{20,}$/.test(label)) throw new Error(`The computer shows as id ${label}`)
  await shot(section, 'token-usage-computers')
  await section.getByRole('combobox', { name: 'Group by' }).click()
  await page.getByRole('option', { name: 'Task', exact: true }).click()
  await table.getByText('Other members’ private Tasks').waitFor()
  await shot(section, 'token-usage-private-merged')

  // By Bot, the same private usage is the same one row, never folded into a Bot or "not in a Bot".
  const privateTotal = () =>
    table
      .getByRole('row')
      .filter({ hasText: 'Other members’ private Tasks' })
      .getByRole('cell')
      .nth(1)
      .innerText()
  const byConversation = await privateTotal()
  // Its first line only: the text sits beside the Group by menu, whose label differs.
  const footer = async () => (await section.getByText(/^About \$/).innerText()).split('\n')[0]
  const taskFooter = await footer()

  await section.getByRole('combobox', { name: 'Group by' }).click()
  await page.getByRole('option', { name: 'Bot and its Tasks' }).click()
  await table.getByRole('columnheader', { name: 'Bot and its Tasks' }).waitFor()
  await table.getByText('Not in a Bot').waitFor()
  const byBot = await privateTotal()

  if (byBot !== byConversation)
    throw new Error(`Private usage is ${byConversation} by Task but ${byBot} by Bot`)
  // The cost at list prices is the team's, not the grouping's.
  if ((await footer()) !== taskFooter)
    throw new Error(`The cost reads "${taskFooter}" by Task but "${await footer()}" by Bot`)
  await shot(section, 'token-usage-by-bot')
}

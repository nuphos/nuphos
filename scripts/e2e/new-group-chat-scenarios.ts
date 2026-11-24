// #3009: New Group Chat asks for a name and members first; nothing exists until Create.
// Its owner then renames it from the chat's header.
import { joinTeam } from './dashboard-scenarios.ts'
import { listed, rest, rowOf } from './leave-helpers.ts'
import { artifacts, until } from './processes.ts'

import type { Scenario } from './ui.ts'
import type { Page } from 'playwright-core'

const NAME = 'E2E launch room'
const RENAMED = 'E2E Q4 launch'

async function openDialog(page: Page) {
  await page.getByRole('tab', { name: 'Bots' }).click()
  await page.getByRole('button', { name: 'New', exact: true }).click()
  await page.getByRole('menuitem', { name: 'New Group Chat' }).click()
  const dialog = page.getByRole('dialog', { name: 'New Group Chat' })

  await dialog.waitFor()

  return dialog
}

export const newGroupChatScenarios: Scenario[] = [
  {
    name: 'New Group Chat creates nothing until Create, then the chat has its name and members',
    run: async (page, stack) => {
      const mate = await joinTeam(stack, 'group-mate')
      const chats = () => listed(stack, stack.token, 'mine', 'channel')
      const before = await chats()

      await page.reload()
      await page.evaluate(() => {
        document.documentElement.classList.remove('dark')
        document.documentElement.classList.add('light')
      })
      // Cancel leaves no empty chat behind.
      const cancelled = await openDialog(page)

      await page.screenshot({ path: `${artifacts}/new-group-chat-empty.png` })
      await cancelled.getByRole('button', { name: 'Cancel' }).click()
      await cancelled.waitFor({ state: 'detached' })
      if ((await chats()).length !== before.length)
        throw new Error('Cancel on New Group Chat created a chat')

      const dialog = await openDialog(page)

      await dialog.getByRole('textbox', { name: 'Group chat name' }).fill(NAME)
      await dialog.getByRole('textbox', { name: 'Search teammates' }).fill('group-mate')
      await dialog.locator('button[aria-pressed]').first().click()
      await page.screenshot({ path: `${artifacts}/new-group-chat-filled.png` })
      if ((await chats()).length !== before.length)
        throw new Error('New Group Chat created a chat before Create')
      await dialog.getByRole('button', { name: 'Create' }).click()
      await dialog.waitFor({ state: 'detached' })
      await rowOf(page, NAME).waitFor({ timeout: 30_000 })
      const made = (await chats()).filter((id) => !before.includes(id))

      if (made.length !== 1) throw new Error(`Create made ${String(made.length)} chats`)
      await until('the teammate to be in the new chat', async () =>
        (await listed(stack, mate.token, 'shared', 'channel')).includes(made[0] ?? ''),
      )
      const people = await rest(stack, stack.token)<{ participants: { id: string }[] }>(
        'GET',
        `/agent/conversations/${made[0] ?? ''}/participants?teamId=${stack.teamId}`,
      )

      if (!people.participants.some((person) => person.id === mate.id))
        throw new Error('The picked teammate is not a participant of the new chat')
      await page.screenshot({ path: `${artifacts}/new-group-chat-created.png` })

      // The owner renames it in place: the header's name opens the rename dialog.
      const title = page.getByRole('button', { name: `Rename chat: ${NAME}` })

      await title.hover()
      await page.getByText('Rename chat', { exact: true }).waitFor()
      await page.screenshot({ path: `${artifacts}/group-chat-rename-hover.png` })
      await title.click()
      const renaming = page.getByRole('dialog', { name: 'Rename chat' })

      await renaming.getByRole('textbox', { name: 'Name' }).fill(RENAMED)
      await settled(page)
      await page.screenshot({ path: `${artifacts}/group-chat-rename-dialog.png` })
      await renaming.getByRole('button', { name: 'Save' }).click()
      await renaming.waitFor({ state: 'detached' })
      await page.getByRole('button', { name: `Rename chat: ${RENAMED}` }).waitFor()
      await rowOf(page, RENAMED).waitFor({ timeout: 30_000 })
      await until('the teammate to see the new name', async () => {
        const shared = await rest(stack, mate.token)<{
          conversations?: { sessionId: string; title: string }[]
        }>('GET', `/agent/conversations?teamId=${stack.teamId}&scope=shared&kind=channel`)

        return shared.conversations?.find((chat) => chat.sessionId === made[0])?.title === RENAMED
      })
      await page.mouse.move(0, 0)
      await settled(page)
      await page.screenshot({ path: `${artifacts}/group-chat-renamed.png` })
    },
  },
]

/** Waits for the page's finite transitions (dialog fade, tooltip fade, blur) to finish before a screenshot. */
async function settled(page: Page) {
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (motion) =>
          motion.playState !== 'running' || motion.effect?.getTiming().iterations === Infinity,
      ),
  )
}

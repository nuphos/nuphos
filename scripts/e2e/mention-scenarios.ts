// The composer's @ menu opens complete: everything it offers was listed before the @.
import { writeFileSync } from 'node:fs'

import { artifacts } from './processes.ts'
import { newTask } from './ui.ts'

import type { Scenario } from './ui.ts'

type Watched = Window & { mentionMenu?: string[] }

/** The @ menu's sections, as one line. */
const menuText = () =>
  [...document.querySelectorAll('[role="listbox"] [role="group"]')]
    .map((group) => group.textContent)
    .join(' | ')

export const mentionScenarios: Scenario[] = [
  {
    // Reported as the menu filling in section by section, a read per keystroke.
    name: 'every @ shows the whole menu at once, and typing only narrows it',
    run: async (page) => {
      await newTask(page)
      await page.getByRole('textbox', { name: 'Message' }).click()
      // Every distinct menu the window shows, from before the @ on.
      await page.evaluate(`(() => {
        const read = ${menuText.toString()}
        const seen = (window.mentionMenu = [])
        new MutationObserver(() => {
          const text = read()
          if (text && seen.at(-1) !== text) seen.push(text)
        }).observe(document.body, { childList: true, subtree: true, characterData: true })
      })()`)
      await page.keyboard.type('@')
      await page.screenshot({ path: `${artifacts}/mention-menu-at.png` })
      // Long enough for any read the @ started to answer and show.
      await page.waitForTimeout(1_500)
      const opened = await page.evaluate(() => (window as Watched).mentionMenu ?? [])

      await page.keyboard.type('E2E', { delay: 150 })
      await page.waitForTimeout(1_000)
      await page.screenshot({ path: `${artifacts}/mention-menu-filtered.png` })
      const typed = await page.evaluate(() => (window as Watched).mentionMenu ?? [])

      writeFileSync(`${artifacts}/mention-menu-frames.json`, JSON.stringify(typed, null, 2))
      if (opened.length !== 1)
        throw new Error(
          `The @ menu filled in over ${String(opened.length)} steps: ${JSON.stringify(opened)}`,
        )
      // By section, not by row: which chats fill the five rows depends on the scenarios before.
      if (!/People/.test(opened[0]) || !/Bots and tasks/.test(opened[0]))
        throw new Error(`The @ menu opened without people and Bots: ${opened[0]}`)
      // One change at most per keystroke, and Bots and tasks still offered.
      if (typed.length > opened.length + 3 || !/Bots and tasks/.test(typed.at(-1) ?? ''))
        throw new Error(
          `Typing changed the menu more than it narrowed it: ${JSON.stringify(typed)}`,
        )
      await page.keyboard.press('Escape')
      await page.keyboard.press('ControlOrMeta+A')
      await page.keyboard.press('Backspace')
    },
  },
]

// Evidence for #2996: answering an Inbox question in words, by voice where the card offers it.
// The microphone is Chromium's fake device (a tone); OpenAI's transcription API is replaced by a
// local fake in stack.ts. The recording, the app's upload and the backend route are real.
import { artifacts, until } from './processes.ts'
import { newTask, send } from './ui.ts'

import type { Scenario } from './ui.ts'
import type { Page } from 'playwright-core'

const shot = (page: Page, name: string) =>
  page.screenshot({ path: `${artifacts}/voice-${name}.png` })

export const voiceAnswerScenarios: Scenario[] = [
  {
    name: 'dictate an Inbox answer with the microphone, read it in the field, then send it',
    run: async (page) => {
      await newTask(page)
      await send(page, 'Ask me E2E_ASK E2E_DELIVERY:voice')
      await page.getByText('ACK E2E_DELIVERY:voice').waitFor()
      await page.getByRole('tab', { name: 'Inbox' }).click()
      await page.getByRole('button', { name: 'Other…' }).first().click()
      const field = page.getByRole('textbox', { name: 'Your answer' })

      await field.waitFor()
      await page.waitForTimeout(500)
      await shot(page, '1-other-open')
      const mic = page.getByRole('button', { name: 'Voice input' })

      console.log(`microphone in the Inbox field: ${String(await mic.count())}`)
      if (await mic.count()) {
        await mic.first().click()
        await page.getByRole('group', { name: 'Recording voice input' }).waitFor()
        await page.waitForTimeout(2_500)
        await shot(page, '2-recording')
        await page.getByRole('button', { name: 'Stop and insert text' }).click()
        await until('the transcript to land in the field', async () =>
          (await field.inputValue()).includes('Use the staging marker'),
        )
        await shot(page, '3-transcript')
      } else {
        await field.fill('Use the staging marker, not production.')
        await shot(page, '3-typed')
      }
      await field.press('Enter')
      await page.getByRole('heading', { name: /^Answered/ }).first().waitFor()
      await page.waitForTimeout(500)
      await shot(page, '4-answered')
      await page.getByRole('tab', { name: 'Tasks' }).click()
    },
  },
]

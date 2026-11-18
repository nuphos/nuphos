// Evidence for #2996: answering an Inbox question by voice, in the recording bar.
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
    name: 'dictate an Inbox answer in the recording bar: insert it, then record more and send',
    run: async (page) => {
      await newTask(page)
      await send(page, 'Ask me E2E_ASK E2E_DELIVERY:voice')
      await page.getByText('ACK E2E_DELIVERY:voice').waitFor()
      await page.getByRole('tab', { name: 'Inbox' }).click()
      await page.getByRole('button', { name: 'Other…' }).first().click()
      const field = page.getByRole('textbox', { name: 'Your answer' })
      const mic = page.getByRole('button', { name: 'Voice input' })
      const bar = page.getByRole('group', { name: 'Recording voice input' })

      await field.waitFor()
      await page.waitForTimeout(500)
      await shot(page, '1-other-open')
      // First take: ■ puts the transcript into the field.
      await mic.click()
      await bar.waitFor()
      await page.waitForTimeout(2_500)
      await shot(page, '2-recording')
      await page.getByRole('button', { name: 'Stop and insert text' }).click()
      await page.getByRole('group', { name: 'Transcribing…' }).waitFor()
      await shot(page, '3-transcribing')
      await until('the transcript to land in the field', async () =>
        (await field.inputValue()).includes('Use the staging marker'),
      )
      await page.waitForTimeout(300)
      await shot(page, '4-transcript')
      // Second take: ↑ transcribes and sends.
      await mic.click()
      await bar.waitFor()
      await page.waitForTimeout(1_500)
      await shot(page, '5-recording-again')
      await page.getByRole('button', { name: 'Stop and send' }).click()
      await page.getByRole('heading', { name: /^Answered/ }).first().waitFor()
      await page.waitForTimeout(500)
      await shot(page, '6-sent')
      await page.getByRole('tab', { name: 'Tasks' }).click()
    },
  },
]

// Voice input for a team without a subscription (#4136): the backend refuses the
// recording, and the app says why and where to upgrade instead of "failed".
import { artifacts } from './processes.ts'
import { newTask } from './ui.ts'

import type { Scenario } from './ui.ts'

export const voiceScenarios: Scenario[] = [
  {
    name: 'voice input without a subscription offers Upgrade, then stops asking to record',
    // The backend's refusal is what this scenario checks; Billing then asks the stack's
    // stand-in billing service, which is only a URL.
    expected: /voice-transcriptions|\/e2e-billing\//,
    run: async (page) => {
      // The CI machine has no microphone: a tone stands in for one, and counts its opens.
      await page.evaluate(() => {
        const opens = window as unknown as { micOpens: number }

        opens.micOpens = 0
        navigator.mediaDevices.getUserMedia = async () => {
          opens.micOpens++
          const context = new AudioContext()
          const tone = context.createOscillator()
          const out = context.createMediaStreamDestination()

          tone.connect(out)
          tone.start()

          return out.stream
        }
      })
      const micOpens = () =>
        page.evaluate(() => (window as unknown as { micOpens: number }).micOpens)

      await newTask(page)
      await page.getByRole('button', { name: 'Voice input' }).last().click()
      await page.getByRole('group', { name: 'Recording voice input' }).waitFor()
      await page.waitForTimeout(1500)
      await page.getByRole('button', { name: 'Stop and insert text' }).click()
      await page.getByText('Voice input needs a subscription').first().waitFor()
      await page.getByText('Voice input is included with a Nuphos subscription.').first().waitFor()
      if ((await page.getByText('Voice input failed').count()) > 0)
        throw new Error('The refusal still reads as a failure')
      await page.screenshot({ path: `${artifacts}/voice-subscription-toast.png` })

      await page.getByRole('button', { name: 'Upgrade' }).first().click()
      await page.getByText("Your team's computer plan, billed monthly.").waitFor()
      await page.screenshot({ path: `${artifacts}/voice-subscription-billing.png` })
      await page.keyboard.press('Escape')
      await page
        .getByText("Your team's computer plan, billed monthly.")
        .waitFor({ state: 'hidden' })

      // Now the app knows: the next press says so before any recording starts.
      const notice = page.getByText('Voice input needs a subscription')

      while ((await notice.count()) > 0) {
        await page.getByRole('button', { name: 'Dismiss' }).first().click()
        await page.waitForTimeout(300)
      }
      await page.getByRole('button', { name: 'Voice input' }).last().click()
      await notice.first().waitFor()
      if ((await page.getByRole('group', { name: 'Recording voice input' }).count()) > 0)
        throw new Error('A second recording started for a team the app knows cannot transcribe')
      if ((await micOpens()) !== 1)
        throw new Error(`The microphone opened ${String(await micOpens())} times, not once`)
    },
  },
]

// A computer's own setup failing a turn, said as what to do there, never the raw error.
// #3401: an agent that cannot reach its model API is told what to check, not EPROTO.
import { artifacts } from './processes.ts'
import { newTask, pickAgent, send } from './ui.ts'

import type { Scenario } from './ui.ts'

const SENTENCE =
  "This computer couldn't reach the model provider's API. Check its network, proxy or VPN, then resend your message."
const REINSTALL =
  "The agent's CLI couldn't start on its computer, so its install may be broken. Reinstall it there, then resend your message."

export const providerUnreachableScenarios: Scenario[] = [
  {
    name: 'a turn that cannot reach the model API says to check the network, without the raw error',
    run: async (page) => {
      await newTask(page)
      await pickAgent(page, 'E2E fixture agent')
      // The fixture fails it as Claude Code does: -32603, Unable to connect to API (EPROTO).
      await send(page, 'Cannot reach the API E2E_API_UNREACHABLE E2E_DELIVERY:api-unreachable')
      await page.getByText(SENTENCE).first().waitFor()
      await page.screenshot({ path: `${artifacts}/api-unreachable.png` })
      const raw = await page.getByText(/Unable to connect to API|EPROTO/).count()

      if (raw > 0) throw new Error(`The chat shows the raw error ${raw} times`)
    },
  },
  {
    name: 'a Codex install missing its binary says to reinstall, without the raw spawn error',
    // The fixture fails these turns on purpose; the backend still logs the agent's error.
    expected: /Codex process has exited with code 1:.*spawn \/Users\/e2e\/[^"]*ENOENT/,
    run: async (page) => {
      await newTask(page)
      await pickAgent(page, 'E2E fixture agent')
      // The fixture fails it as codex-acp does when the computer's npm Codex lost its binary.
      await send(page, 'Start Codex E2E_CODEX_BROKEN E2E_DELIVERY:codex-broken')
      await page.getByText(REINSTALL).first().waitFor()
      // The agent's own failure: the row that offers Switch runtime, as a signed-out agent's does.
      await page.getByRole('button', { name: 'Switch runtime' }).last().waitFor()
      await page.screenshot({ path: `${artifacts}/codex-broken.png` })
      const raw = await page.getByText(/ENOENT|codex-darwin-arm64|process has exited/).count()

      if (raw > 0) throw new Error(`The chat shows the raw error ${raw} times`)
    },
  },
  {
    // A Bot's chat, where a Bot's first and later turns fail (Bot onboarding, 2026-11-19): the
    // line says what to do, not "couldn't reply." alone, and never the raw spawn error.
    name: 'a Bot whose Codex install is missing its binary says in its chat to install it again',
    expected: /Codex process has exited with code 1:.*spawn \/Users\/e2e\/[^"]*ENOENT/,
    run: async (page) => {
      await page.getByRole('tab', { name: /^Bots/ }).click()
      await page.getByRole('button', { name: 'New Bot', exact: true }).click()
      await page.getByRole('textbox', { name: 'Bot name' }).fill('E2E Broken Codex')
      await page.getByRole('button', { name: 'Create', exact: true }).click()
      await page.getByText('POSTED E2E_DELIVERY:missing', { exact: true }).waitFor()
      await send(page, 'Start Codex E2E_CODEX_BROKEN E2E_DELIVERY:bot-codex-broken')
      await page.getByText(`couldn’t reply: ${REINSTALL}`).first().waitFor()
      await page.screenshot({ path: `${artifacts}/bot-codex-broken.png` })
      const raw = await page.getByText(/ENOENT|codex-darwin-arm64|process has exited/).count()

      if (raw > 0) throw new Error(`The Bot chat shows the raw error ${raw} times`)
    },
  },
]

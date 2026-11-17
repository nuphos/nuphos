// A Bot choosing its own model. Runs in the Bot chat the scenarios before opened, once its setup is done.
import { agentEvents, agentLog } from './agent-log.ts'
import { until } from './processes.ts'
import { send } from './ui.ts'

import type { Scenario } from './ui.ts'

const PICK = 'fixture-small'

export const botModelScenarios: Scenario[] = [
  {
    // #2361: update_self takes a model; the reply that picks it keeps its settings.
    name: 'a Bot picks its own model, its reply keeps the old one, and its next turn runs on the new one',
    run: async (page, stack) => {
      const turn = (marker: string) =>
        agentLog(stack).find((entry) => entry.event === 'start' && entry.marker === marker)
      // The chat's post, not the sidebar row that previews it.
      const posted = (marker: string) =>
        page.locator('[data-post-id]').getByText(`POSTED ${marker}`, { exact: true }).waitFor()

      await send(page, `Use the small model from now on E2E_SELF_MODEL:${PICK} E2E_DELIVERY:pick`)
      await posted('E2E_DELIVERY:pick')
      await until('the picking turn to finish', async () =>
        agentEvents(stack).includes('finish E2E_DELIVERY:pick'),
      )
      const log = agentLog(stack)
      const picking = turn('E2E_DELIVERY:pick')
      const picked = log.find((entry) => entry.event === 'self-model')
      const finished = log.findIndex(
        (entry) => entry.event === 'finish' && entry.marker === 'E2E_DELIVERY:pick',
      )

      if (!picking || !picked) throw new Error('The Bot did not call update_self in its turn')
      if (!JSON.stringify(picked.result).includes('next_turn'))
        throw new Error(`update_self did not take the model: ${JSON.stringify(picked.result)}`)
      if (picking.model === PICK) throw new Error(`The Bot was already on ${PICK}`)
      // Nothing changed the session's model while the reply that picked it ran.
      const during = log
        .slice(log.indexOf(picking), finished)
        .filter((entry) => entry.sessionId === picking.sessionId && entry.event === 'setting')

      if (during.length > 0)
        throw new Error(`The reply in progress changed model: ${JSON.stringify(during)}`)

      await send(page, 'What now? E2E_DELIVERY:after-pick')
      await posted('E2E_DELIVERY:after-pick')
      const next = turn('E2E_DELIVERY:after-pick')

      if (next?.model !== PICK)
        throw new Error(`The next turn did not run on ${PICK}: ${JSON.stringify(next)}`)
    },
  },
]

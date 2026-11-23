// The end of an agent run is one lifecycle event, which also goes to product analytics. Each
// terminal frame used to add another, twice per run, with nothing run.finished lacks.
import { backendLog } from './backend-log.ts'

import type { Scenario } from './ui.ts'

const logged = (log: string[], event: string) =>
  log.filter((line) => line.includes(`"event":"${event}"`))

// After the turns above: it reads what the backend logged for all of them.
export const runEndTraceScenario: Scenario = {
  name: 'every agent run that ended logged its end once',
  run: () => {
    const log = backendLog()
    const extra = logged(log, 'agent.chat.run.terminal_frame_appended')

    if (logged(log, 'agent.chat.run.finished').length === 0)
      throw new Error('No agent run logged agent.chat.run.finished')
    if (extra.length > 0) throw new Error(`A terminal frame was logged on its own:\n${extra[0]}`)

    return Promise.resolve()
  },
}

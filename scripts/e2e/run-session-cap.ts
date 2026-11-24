// `bun scripts/e2e/run-session-cap.ts`: a real backend and OpenAB, where every conversation on one
// agent shares one connection. Conversations are started with nuphos_ask and archived one by one,
// past the 128 the gateway used to allow a connection over its lifetime, then the agent host
// restarts, the backend takes every one of them back up, and two more start. Each must start.
import { client, must } from './binding-access-scenarios.ts'
import { askOverMcp, mcp } from './mcp-scenarios.ts'
import { artifacts, stopAll } from './processes.ts'
import { startStack } from './stack.ts'

// CONVERSATIONS=128 fills the former cap exactly, so only the restart decides the last start.
const CONVERSATIONS = Number(process.env.CONVERSATIONS ?? 140)
let failed = false

try {
  console.log(`Artifacts: ${artifacts}`)
  const stack = await startStack()
  const { tool } = mcp(client(stack.apiUrl, stack.token))
  const ask = async (marker: string) => {
    const sessionId = await askOverMcp(tool, stack.teamId, marker)
    const archived = await tool<{ archived: boolean }>('nuphos_archive_session', {
      session_id: sessionId,
      archived: true,
    })

    must(archived.structuredContent?.archived === true, `${marker} to be archived`)
  }

  for (let i = 1; i <= CONVERSATIONS; i++) {
    await ask(`E2E_DELIVERY:cap-${String(i)}`)
    if (i % 20 === 0) console.log(`${String(i)} conversations started and archived`)
  }
  console.log(`PASS: ${String(CONVERSATIONS)} conversations started and archived on one agent`)

  await stack.restartAgentHost()
  await ask('E2E_DELIVERY:cap-after-restart-1')
  await ask('E2E_DELIVERY:cap-after-restart-2')
  console.log('PASS: new conversations start after the agent host restarts')
} catch (error) {
  failed = true
  console.error(error)
} finally {
  await stopAll()
}
process.exit(failed ? 1 : 0)

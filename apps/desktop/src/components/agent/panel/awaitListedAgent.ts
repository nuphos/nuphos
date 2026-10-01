import type { RuntimeInstance } from '../../../types/runtime.ts'

const POLL_MS = 500
const WAIT_MS = 20_000

/** Holds a first send on this computer's agent until the team catalog lists it, rather than failing it. */
export async function awaitListedAgent(
  runtimeId: string,
  list: () => Promise<RuntimeInstance[]>,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  waitMs = WAIT_MS,
): Promise<RuntimeInstance | null> {
  for (let waited = 0; waited <= waitMs; waited += POLL_MS) {
    const listed = await list().then(
      (instances) => instances.find((instance) => instance.id === runtimeId),
      () => undefined,
    )

    if (listed?.status === 'active') return listed
    await wait(POLL_MS)
  }

  return null
}

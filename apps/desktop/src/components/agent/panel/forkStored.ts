import { parseAtlasError } from '../../../api/errors.ts'

/** How long to wait before each new try while the server has no fork yet; tests shorten it. */
export const forkLookupWaits = { ms: [1_000, 2_000, 4_000, 8_000, 15_000, 30_000] }

/**
 * Runs `record` once the server has the fork an edit sent its first message in.
 * A fork with history has it once the import lands; a failed import rejects,
 * since then there is no fork. A fork with no history is stored by its first
 * turn, which the server starts after agentStart has returned, so `record` is
 * tried again while the server answers fork_not_found.
 */
export async function afterForkStored(
  imported: Promise<void> | undefined,
  record: () => Promise<unknown>,
) {
  await imported
  for (const wait of [...forkLookupWaits.ms, null]) {
    try {
      await record()

      return
    } catch (err) {
      if (wait === null || parseAtlasError(err).code !== 'fork_not_found') throw err
      await new Promise((resolve) => setTimeout(resolve, wait))
    }
  }
}

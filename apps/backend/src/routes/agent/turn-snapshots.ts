import { readRunChannels } from '@/lib/agent/run-store'
import { withRunChannels } from '@/lib/claude-code-preview/runtime-execution-snapshot'
import { desktopTracker } from '@/lib/claude-code-preview/session-desktops'
import { redisEnabled } from '@/lib/redis'

import type { AgentRun } from './types'
import type { DesktopOwner } from '@/lib/claude-code-preview/session-desktops'
import type { SessionExecutionState } from '@/lib/claude-code-preview/runtime-execution-snapshot'

/**
 * A running turn's own snapshots arrive synchronously, so what the backend adds
 * to them is what it last knew: the conversation's desktops, and the channels
 * the turn answers. Each is refreshed in the background on use, as a channel
 * may be steered in from another replica.
 */
export async function turnSnapshots(run: AgentRun, owner: DesktopOwner) {
  const desktops = await desktopTracker(owner)
  let refreshing: Promise<void> | undefined

  return {
    with<T extends SessionExecutionState>(snapshot: T): T {
      // Without a shared store every steer lands on this replica's run.
      if (redisEnabled())
        refreshing ??= readRunChannels(run.userId, run.streamId)
          .then((stored) => {
            // A turn's channels only grow; a read before its own write lands loses none.
            run.channelIds = [...new Set([...(run.channelIds ?? []), ...stored])]
          })
          .catch(() => undefined)
          .finally(() => {
            refreshing = undefined
          })

      return withRunChannels(desktops.with(snapshot), run)
    },
  }
}

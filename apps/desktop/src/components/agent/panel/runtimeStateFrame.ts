import { acceptRuntimeSnapshot } from '../../../lib/runtimeExecution.ts'

import type { PanelCtx } from './ctx'
import type { RuntimeExecution } from '../../../lib/runtimeExecution.ts'

export function handleRuntimeStateFrame(
  ctx: Pick<PanelCtx, 'setTabs' | 'flushTextBuffer'>,
  streamId: string,
  sse: Record<string, unknown>,
): boolean {
  const { setTabs } = ctx

  if (sse.type === 'runtime-state' && sse.snapshot && typeof sse.snapshot === 'object') {
    ctx.flushTextBuffer(streamId)
    const snapshot = sse.snapshot as RuntimeExecution
    const observedAt =
      performance.now() -
      Math.max(0, Date.now() - (typeof sse.emittedAt === 'number' ? sse.emittedAt : 0))

    setTabs((prev) =>
      prev.map((tab) =>
        tab.streamId === streamId
          ? {
              ...tab,
              claudeCodeRuntimeAttached: true,
              runtimeState: acceptRuntimeSnapshot(tab.runtimeState, { ...snapshot, observedAt }),
            }
          : tab,
      ),
    )

    return true
  }

  return false
}

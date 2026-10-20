import { publishRuntimeStates } from '../../../lib/agentRuntimeStates.ts'

import type { PanelCtx } from './ctx'
import type { RuntimeExecution } from '../../../lib/runtimeExecution.ts'

export function handleRuntimeStateFrame(
  ctx: Pick<PanelCtx, 'setTabs' | 'flushTextBuffer' | 'tabsRef'>,
  streamId: string,
  sse: Record<string, unknown>,
): boolean {
  if (sse.type === 'runtime-state' && sse.snapshot && typeof sse.snapshot === 'object') {
    ctx.flushTextBuffer(streamId)
    const sessionId = ctx.tabsRef.current.find((tab) => tab.streamId === streamId)?.sessionId

    if (sessionId) publishRuntimeStates([[sessionId, sse.snapshot as RuntimeExecution]])
    ctx.setTabs((prev) =>
      prev.map((tab) =>
        tab.streamId === streamId ? { ...tab, claudeCodeRuntimeAttached: true } : tab,
      ),
    )

    return true
  }

  return false
}

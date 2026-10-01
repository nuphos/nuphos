import { useEffect } from 'react'

import { track } from '../../../lib/analytics'
import { ownsAgentStream } from '../../../lib/ownedAgentStreams'
import { runtimeSnapshotFresh } from '../../../lib/runtimeExecution'

import { claimClientToolRequests, selectClientToolDispatch } from './clientToolRequests'

import type { PanelCtx } from './ctx'

type Acc = Pick<
  PanelCtx,
  'clientToolRunsRef' | 'executeClientToolsAndContinue' | 'setTabs' | 'tabs'
>

/**
 * Own client-tool execution from committed React state. The SSE end callback
 * only has to select the phase; this effect makes dispatch survive a deferred
 * updater or a lost one-shot post-commit callback.
 */
export function useCommittedClientToolDispatch(acc: Acc): void {
  const { clientToolRunsRef, executeClientToolsAndContinue, setTabs, tabs } = acc

  useEffect(() => {
    for (const tab of tabs) {
      if (!runtimeSnapshotFresh(tab.runtimeState)) continue
      const running = clientToolRunsRef.current.get(tab.id)

      if (running) {
        const pending = tab.runtimeState?.requests ?? []

        if (
          !running.cancelled &&
          running.requestIds?.every((id) => !pending.some((request) => request.waitId === id))
        ) {
          running.cancelled = true
          void window.api.agentAbortClientTools(tab.sessionId).catch(() => {})
        }
        continue
      }
      if (tab.attachedStreamId && tab.attachedStreamId === tab.streamId) continue
      const dispatch = selectClientToolDispatch(tab, ownsAgentStream)

      if (!dispatch) continue
      const { messages, tools } = dispatch

      claimClientToolRequests(tools.map((tool) => tool.toolCallId))
      // A request recovered after its stream closed re-enters the phase the
      // end-of-stream handoff would have set, so the phase watchdog sees it.
      if (messages !== tab.messages || !tab.streaming) {
        setTabs((prev) =>
          prev.map((t) =>
            t.id === tab.id
              ? {
                  ...t,
                  messages,
                  streaming: true,
                  streamId: null,
                  phase: null,
                  streamStartedAt: Date.now(),
                  error: null,
                }
              : t,
          ),
        )
      }
      track('agent_client_tool_phase_entered', {
        session_id: tab.sessionId,
        tool_names: tools.map((tool) => tool.toolName).join(','),
        tool_count: tools.length,
        dispatch_owner: 'committed_state',
        recovered_from_request: messages !== tab.messages,
      })
      void executeClientToolsAndContinue({
        tabId: tab.id,
        sessionId: tab.sessionId,
        title: tab.title,
        messages,
        tools,
        credentialAccess: tab.credentialAccess,
      })
    }
  }, [clientToolRunsRef, executeClientToolsAndContinue, setTabs, tabs])
}

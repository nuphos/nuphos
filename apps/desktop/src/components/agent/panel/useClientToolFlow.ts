import { useCallback } from 'react'

import { getActiveDiagramId } from '../../../architecture/activeDiagram'
import { buildAgentStopNotification } from '../../../lib/agentStopNotification'
import { toast } from '../../ui/toast'

import {
  executeClientToolWithDeadline,
  localToolFallbackOutput,
  applyClientToolOutput,
} from './clientTools'
import { newAgentStreamId } from './stall'
import { getAgentLocale } from './textUtils'
import { toUiMessages } from './toUiMessages'

import type { PanelCtx } from './ctx'
import type { Message, Tab } from './model'
import type { ToolPart } from './parts'
import type { AgentCredentialSelection } from '../../../api'

type Acc = Pick<
  PanelCtx,
  | 'clientToolRunsRef'
  | 'fireStopNotification'
  | 'kubeContextRef'
  | 'queueTranscriptSync'
  | 'setTabs'
  | 'tabsRef'
  | 'teamIdRef'
  | 'urlRef'
>

export function useClientToolFlow(acc: Acc) {
  const {
    clientToolRunsRef,
    fireStopNotification,
    kubeContextRef,
    queueTranscriptSync,
    setTabs,
    tabsRef,
    teamIdRef,
    urlRef,
  } = acc

  // Hand the client-tool results back to the model and start the next stream.
  // Shared by the normal path and the phase watchdog, which submits the same
  // shape with error-carrying tool outputs.
  const continueTurnAfterClientTools = useCallback(
    async (payload: {
      tabId: string
      sessionId: string
      title: string
      messages: Message[]
      credentialAccess: AgentCredentialSelection
    }) => {
      const nextMessages = payload.messages
      const newStreamId = newAgentStreamId()
      const streamStartedAt = Date.now()
      const currentTab = tabsRef.current.find((t) => t.id === payload.tabId)

      if (!currentTab) return
      const nextTab: Tab = {
        ...currentTab,
        sessionId: payload.sessionId,
        title: payload.title,
        messages: nextMessages,
        streaming: true,
        connected: false,
        phase: null,
        streamId: newStreamId,
        streamStartedAt,
        error: null,
        agentSetupRequired: null,
        bootQuiet: true,
        autoResumeAttempts: 0,
        credentialAccess: payload.credentialAccess,
      }

      setTabs((prev) => prev.map((t) => (t.id === payload.tabId ? nextTab : t)))
      queueTranscriptSync(nextTab, 250)

      try {
        await window.api.agentStart({
          streamId: newStreamId,
          sessionId: payload.sessionId,
          teamId: teamIdRef.current,
          messages: toUiMessages(nextMessages),
          baseIndex: nextTab.historyBaseIndex,
          locale: getAgentLocale(),
          url: urlRef.current,
          kubeContext: kubeContextRef.current ?? undefined,
          diagramId: getActiveDiagramId() ?? undefined,
          credentialAccess: payload.credentialAccess,
          resumeReason: 'client-tool',
        })
      } catch (err) {
        toast.apiError('Failed to continue the agent run', err)
        fireStopNotification(
          buildAgentStopNotification({
            outcome: {
              kind: 'failed',
              cause: 'The agent could not be continued after running a local tool.',
            },
            title: payload.title,
          }),
          payload.sessionId,
        )
        setTabs((prev) =>
          prev.map((t) => {
            if (t.streamId !== newStreamId) return t
            const failedTab: Tab = {
              ...t,
              streaming: false,
              streamId: null,
              phase: null,
              streamStartedAt: null,
              error: null,
            }

            queueTranscriptSync(failedTab, 250)

            return failedTab
          }),
        )
      }
    },
    [fireStopNotification, queueTranscriptSync],
  )

  const executeClientToolsAndContinue = useCallback(
    async (payload: {
      tabId: string
      sessionId: string
      title: string
      messages: Message[]
      tools: ToolPart[]
      credentialAccess: AgentCredentialSelection
    }) => {
      let nextMessages = payload.messages
      const runToken = {
        cancelled: false,
        requestIds: payload.tools.map((tool) => tool.toolCallId),
      }

      clientToolRunsRef.current.set(payload.tabId, runToken)

      try {
        for (const part of payload.tools) {
          if (runToken.cancelled) return
          let output: unknown

          try {
            output = await executeClientToolWithDeadline({
              sessionId: payload.sessionId,
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              input: part.input,
            })
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err)

            output = localToolFallbackOutput(part.toolName, message)
          }
          // Stop landed while the tool was running: stopActive already
          // finalized the tool parts and reset the tab — don't overwrite that
          // with the late output, and don't start a follow-up stream.
          if (runToken.cancelled) return

          nextMessages = applyClientToolOutput(nextMessages, part.toolCallId, output)
          setTabs((prev) =>
            prev.map((t) =>
              t.id === payload.tabId
                ? // Each finished tool is progress: restamp the phase clock so
                  // the stall watchdog measures silence, not total duration.
                  { ...t, messages: nextMessages, error: null, streamStartedAt: Date.now() }
                : t,
            ),
          )
        }

        if (runToken.cancelled) return

        await continueTurnAfterClientTools({
          tabId: payload.tabId,
          sessionId: payload.sessionId,
          title: payload.title,
          messages: nextMessages,
          credentialAccess: payload.credentialAccess,
        })
      } finally {
        if (clientToolRunsRef.current.get(payload.tabId) === runToken) {
          clientToolRunsRef.current.delete(payload.tabId)
        }
      }
    },
    [continueTurnAfterClientTools],
  )

  return { continueTurnAfterClientTools, executeClientToolsAndContinue }
}

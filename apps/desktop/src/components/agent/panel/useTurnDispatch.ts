import { useCallback } from 'react'

import { api } from '../../../api.ts'
import { useCurrentUser } from '../../../hooks/useCurrentUser.ts'
import { t } from '../../../i18n/index.ts'
import { runtimeAllows, runtimeStateLabel } from '../../../lib/runtimeExecution.ts'
import { toast } from '../../ui/toast.ts'

import { makeAttachmentTurn } from './attachments.ts'
import { awaitListedAgent } from './awaitListedAgent.ts'
import { runDispatchTurn } from './dispatchTurn.ts'
import { HOME_TAB_ID } from './model.ts'
import { runtimeMayAcceptLater } from './queuedAutoSend.ts'
import { routeSend } from './sendRouting.ts'
import { runStartChatWith } from './startChat.ts'
import { fileNameFromPath } from './textUtils.ts'
import { useQueueActions } from './useQueueActions.ts'
import { useSteering } from './useSteering.ts'

import type { PanelCtx } from './ctx'
import type { Message } from './model'
import type { TransferUploadPart } from './parts'
import type { AgentMessageMention } from '../../../api/agent-types'

type Acc = Pick<
  PanelCtx,
  | 'activeId'
  | 'credentialAccessRef'
  | 'credentialOptions'
  | 'defaultPermissionMode'
  | 'kubeContextRef'
  | 'lastCredentialSyncedRef'
  | 'newConversationRuntime'
  | 'newConversationSessionConfig'
  | 'newConversationCredentialAccess'
  | 'onOpenAgentSettings'
  | 'replyTarget'
  | 'sendableCredentialAccess'
  | 'setActiveId'
  | 'setBypassBySession'
  | 'setTabs'
  | 'stoppedRunIdsRef'
  | 'syncTranscriptNow'
  | 'tabsRef'
  | 'teamId'
  | 'uploadingTabsRef'
  | 'urlRef'
>

export function useTurnDispatch(acc: Acc) {
  const currentUser = useCurrentUser()
  const {
    activeId,
    credentialAccessRef,
    credentialOptions,
    defaultPermissionMode,
    kubeContextRef,
    lastCredentialSyncedRef,
    newConversationRuntime,
    newConversationSessionConfig,
    newConversationCredentialAccess,
    onOpenAgentSettings,
    replyTarget,
    sendableCredentialAccess,
    setActiveId,
    setBypassBySession,
    setTabs,
    stoppedRunIdsRef,
    syncTranscriptNow,
    tabsRef,
    teamId,
    uploadingTabsRef,
    urlRef,
  } = acc
  // Without the main chat's chip, a question id comes from a surface that only answers it.
  const answering = !replyTarget

  const startChatWith = useCallback(
    (
      prompt: string,
      initialMessage?: Message,
      // When the first message carries attachments, hold the agent
      // until the upload finalizes: the chat opens immediately with a loading
      // card, then `run` resolves the upload part and the stream starts.
      deferredUpload?: {
        messageId: string
        run: () => Promise<TransferUploadPart>
      },
    ): boolean => {
      const start = (runtime: typeof newConversationRuntime) =>
        runStartChatWith(
          {
            currentUser,
            setBypassBySession,
            defaultPermissionMode,
            newConversationRuntime: runtime,
            newConversationSessionConfig,
            newConversationCredentialAccess,
            credentialAccessRef,
            lastCredentialSyncedRef,
            setTabs,
            setActiveId,
            syncTranscriptNow,
            teamId,
            urlRef,
            kubeContextRef,
            uploadingTabsRef,
            onOpenAgentSettings,
          },
          prompt,
          initialMessage,
          deferredUpload,
        )

      if (!newConversationRuntime?.starting || !teamId) return start(newConversationRuntime)

      // A just-started local runtime is not in the team catalog yet: the send
      // is held until it is, and goes out then. If it never lists, the existing
      // toast says so.
      void awaitListedAgent(newConversationRuntime.id, () =>
        api.atlasListRuntimeInstances(teamId),
      ).then((listed) => {
        if (listed) start(listed)
        else
          toast.error(
            t('The local runtime is still starting'),
            t('Try again in a moment, or check User settings › This computer › Local runtime.'),
          )
      })

      // Held: the conversation this opens owns the draft once it can start.
      return true
    },
    [
      currentUser,
      setBypassBySession,
      defaultPermissionMode,
      newConversationRuntime,
      newConversationSessionConfig,
      newConversationCredentialAccess,
      credentialAccessRef,
      credentialOptions,
      lastCredentialSyncedRef,
      setTabs,
      setActiveId,
      syncTranscriptNow,
      teamId,
      urlRef,
      kubeContextRef,
      uploadingTabsRef,
      onOpenAgentSettings,
    ],
  )

  // Core "start a new turn in this specific tab" path. Shared by sendInActive
  // (the user typed and submitted while idle) and the queue-flush effect (a
  // follow-up parked during the previous turn is now ready to send). Reads the
  // tab fresh from the ref so it is safe to call against any tab, not just the
  // active one.
  //
  // Attachments: the user's message renders immediately with a
  // loading card; bytes stream Electron-main -> S3 in the background and the
  // turn only starts once the upload finalizes (the agent then pulls the files).
  const dispatchTurn = useCallback(
    (
      tabId: string,
      text: string,
      filePaths: string[],
      turnKind?: Message['turnKind'],
      questionId?: string,
      mentions?: AgentMessageMention[],
    ) =>
      runDispatchTurn(
        {
          currentUser,
          decisionReplyTo: questionId,
          teamId,
          tabsRef,
          uploadingTabsRef,
          setTabs,
          stoppedRunIdsRef,
          syncTranscriptNow,
          sendableCredentialAccess,
          credentialAccessRef,
          urlRef,
          kubeContextRef,
        },
        tabId,
        text,
        filePaths,
        turnKind,
        mentions,
      ),
    [
      currentUser,
      teamId,
      tabsRef,
      uploadingTabsRef,
      setTabs,
      stoppedRunIdsRef,
      syncTranscriptNow,
      sendableCredentialAccess,
      credentialAccessRef,
      urlRef,
      kubeContextRef,
    ],
  )

  // A steer that cannot land goes out as a message, to wait its turn on the server.
  const sendSteering = useSteering({
    tabsRef,
    setTabs,
    teamId,
    currentUser,
    fallback: dispatchTurn,
  })

  // Reports whether the send took the draft. Every refusal below happens before
  // a message or queued entry exists, so the composer keeps the draft.
  const sendInActive = useCallback(
    (
      text: string,
      filePaths: string[] = [],
      turnKind?: Message['turnKind'],
      questionId?: string,
      mentions?: AgentMessageMention[],
      mode?: 'queue',
    ): boolean => {
      const trimmed = text.trim()

      if (!trimmed && filePaths.length === 0) return false
      if (filePaths.length > 0 && !teamId) {
        toast.error(t('No team selected'), t('Select a team before attaching files.'))

        return false
      }
      if (activeId === HOME_TAB_ID) {
        const title = trimmed || filePaths.map(fileNameFromPath).join(', ')
        // First message: attachments use the deferred upload. The backend
        // session doesn't exist until startChatWith runs agentStart, so that
        // upload is team-scoped (see startChatWith).
        const { messageId, optimisticPart, buildUserMsg, runUpload } = makeAttachmentTurn(
          text,
          filePaths,
          teamId!,
          { turnKind, currentUser, mentions },
        )

        return startChatWith(
          title,
          buildUserMsg(filePaths.length > 0 ? optimisticPart() : null),
          filePaths.length > 0 ? { messageId, run: runUpload } : undefined,
        )
      }
      const tab = tabsRef.current.find((t) => t.id === activeId)

      if (!tab || tab.readOnly) return false
      const route = routeSend(tab.runtimeState, turnKind, questionId, answering, mode)

      // A refused steer falls back to the same server queue as an explicit queued send.
      if (route.steer) {
        // A steer belongs to the session it steers. With none registered yet
        // sendSteering would drop it in silence, so refuse it instead.
        if (!tab.sessionId) {
          toast.error(
            t("The runtime isn't ready yet"),
            t('Your message was not sent. Send it again.'),
          )

          return false
        }
        void sendSteering(activeId, trimmed, filePaths)

        return true
      }
      if (!runtimeAllows(tab.runtimeState, 'reply') && !runtimeMayAcceptLater(tab.runtimeState)) {
        toast.error(runtimeStateLabel(tab.runtimeState))

        return false
      }
      if (uploadingTabsRef.current.has(activeId)) {
        toast.error(t('Attachment upload is still in progress'))

        return false
      }
      // Past the checks above, dispatchTurn renders the message or queues it
      // before anything it awaits; a later failure shows in the conversation.
      void dispatchTurn(activeId, trimmed, filePaths, turnKind, route.decisionReplyTo, mentions)

      return true
    },
    [activeId, answering, startChatWith, dispatchTurn, sendSteering, teamId, currentUser],
  )

  const { steerQueued, removeQueued } = useQueueActions({ tabsRef, setTabs, teamId, sendSteering })

  return { startChatWith, dispatchTurn, sendInActive, steerQueued, removeQueued }
}

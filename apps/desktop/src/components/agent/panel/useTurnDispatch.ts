import { useCallback } from 'react'

import { api } from '../../../api'
import { useCurrentUser } from '../../../hooks/useCurrentUser'
import { runtimeAllows, runtimeStateLabel } from '../../../lib/runtimeExecution'
import { toast } from '../../ui/toast'

import { makeAttachmentTurn } from './attachments'
import { awaitListedAgent } from './awaitListedAgent'
import { runDispatchTurn } from './dispatchTurn'
import { HOME_TAB_ID } from './model'
import { runtimeMayAcceptLater } from './queuedAutoSend'
import { runStartChatWith } from './startChat'
import { fileNameFromPath } from './textUtils'
import { useQueueActions } from './useQueueActions'
import { useSteering } from './useSteering'

import type { PanelCtx } from './ctx'
import type { Message } from './model'
import type { TransferUploadPart } from './parts'

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

  const startChatWith = useCallback(
    (
      prompt: string,
      initialMessage?: Message,
      // When the first message carries attachments, hold the agent
      // until the upload finalizes: the chat opens immediately with a loading
      // card, then `run` resolves the upload part and the stream starts.
      deferredUpload?: {
        messageId: string
        run: (sessionId: string | undefined) => Promise<TransferUploadPart>
      },
    ) => {
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
          },
          prompt,
          initialMessage,
          deferredUpload,
        )

      if (!newConversationRuntime?.starting || !teamId) {
        start(newConversationRuntime)

        return
      }
      void awaitListedAgent(newConversationRuntime.id, () =>
        api.atlasListRuntimeInstances(teamId),
      ).then((listed) => {
        if (listed) start(listed)
        else
          toast.error(
            'The local runtime is still starting',
            'Try again in a moment, or check User settings › This computer › Local runtime.',
          )
      })
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
    (tabId: string, text: string, filePaths: string[], turnKind?: Message['turnKind']) =>
      runDispatchTurn(
        {
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
        },
        tabId,
        text,
        filePaths,
        turnKind,
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

  const sendInActive = useCallback(
    async (text: string, filePaths: string[] = [], turnKind?: Message['turnKind']) => {
      const trimmed = text.trim()

      if (!trimmed && filePaths.length === 0) return
      if (filePaths.length > 0 && !teamId) {
        toast.error('No team selected', 'Select a team before attaching files.')

        return
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
          { turnKind, currentUser },
        )

        startChatWith(
          title,
          buildUserMsg(filePaths.length > 0 ? optimisticPart() : null),
          filePaths.length > 0 ? { messageId, run: runUpload } : undefined,
        )

        return
      }
      const tab = tabsRef.current.find((t) => t.id === activeId)

      if (!tab) return
      if (tab.readOnly) return
      // The backend decides whose turn it is: a refused steer is sent as a
      // message and waits its turn in the server queue.
      if (
        runtimeAllows(tab.runtimeState, 'steer') &&
        !runtimeAllows(tab.runtimeState, 'reply') &&
        !turnKind
      ) {
        await sendSteering(activeId, trimmed, filePaths)

        return
      }
      if (!runtimeAllows(tab.runtimeState, 'reply') && !runtimeMayAcceptLater(tab.runtimeState)) {
        toast.error(runtimeStateLabel(tab.runtimeState))

        return
      }
      if (uploadingTabsRef.current.has(activeId)) {
        toast.error('Attachment upload is still in progress')

        return
      }
      void dispatchTurn(activeId, trimmed, filePaths, turnKind)
    },
    [activeId, startChatWith, dispatchTurn, sendSteering, teamId, currentUser],
  )

  const { steerQueued, removeQueued } = useQueueActions({ tabsRef, setTabs, teamId, sendSteering })

  return { startChatWith, dispatchTurn, sendInActive, steerQueued, removeQueued }
}

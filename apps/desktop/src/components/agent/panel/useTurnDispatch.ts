import { useCallback } from 'react'

import { api } from '../../../api'
import { useCurrentUser } from '../../../hooks/useCurrentUser'
import { runtimeAllows, runtimeStatusLabel } from '../../../lib/runtimeExecution'
import { toast } from '../../ui/toast'

import { partitionAttachments, readImageParts, makeAttachmentTurn } from './attachments'
import { awaitListedAgent } from './awaitListedAgent'
import { runDispatchTurn } from './dispatchTurn'
import { HOME_TAB_ID, emitFirstRunConvo } from './model'
import { nextAutoSend, queueAutoSend, runtimeMayAcceptLater } from './queuedAutoSend'
import { runStartChatWith } from './startChat'
import { fileNameFromPath } from './textUtils'
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
            'The local agent is still starting',
            'Try again in a moment, or check User settings › This computer › Local agent.',
          )
      })
    },
    [
      currentUser,
      setBypassBySession,
      defaultPermissionMode,
      newConversationRuntime,
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

  const sendSteering = useSteering({ tabsRef, setTabs, teamId, currentUser })

  const queueUntilSendable = useCallback(
    (tabId: string, text: string, filePaths: string[], turnKind?: Message['turnKind']) => {
      const draft = { id: crypto.randomUUID(), text, filePaths, turnKind }

      setTabs((prev) => prev.map((t) => (t.id === tabId ? queueAutoSend(t, draft) : t)))
    },
    [setTabs],
  )

  const sendInActive = useCallback(
    async (text: string, filePaths: string[] = [], turnKind?: Message['turnKind']) => {
      const trimmed = text.trim()

      if (!trimmed && filePaths.length === 0) return
      const { imagePaths, otherPaths } = partitionAttachments(filePaths)

      if (otherPaths.length > 0 && !teamId) {
        toast.error('No team selected', 'Select a team before attaching files.')

        return
      }
      if (activeId === HOME_TAB_ID) {
        const title = trimmed || filePaths.map(fileNameFromPath).join(', ')
        // First message: images go straight to the model as vision; only
        // non-image files use the deferred upload. The backend
        // session doesn't exist until startChatWith runs agentStart, so that
        // upload is team-scoped (see startChatWith).
        const imageParts = await readImageParts(imagePaths)
        const { messageId, optimisticPart, buildUserMsg, runUpload } = makeAttachmentTurn(
          text,
          imageParts,
          otherPaths,
          teamId!,
          { turnKind, currentUser },
        )

        emitFirstRunConvo('asked')
        startChatWith(
          title,
          buildUserMsg(otherPaths.length > 0 ? optimisticPart() : null),
          otherPaths.length > 0 ? { messageId, run: runUpload } : undefined,
        )

        return
      }
      const tab = tabsRef.current.find((t) => t.id === activeId)

      if (!tab) return
      if (tab.readOnly) return
      if (runtimeAllows(tab.runtimeState, 'steer') && !runtimeAllows(tab.runtimeState, 'reply')) {
        await sendSteering(activeId, trimmed, filePaths)

        return
      }
      const replying = runtimeAllows(tab.runtimeState, 'reply')

      const sendable = runtimeAllows(tab.runtimeState, 'send')

      if (!replying && !sendable && !runtimeMayAcceptLater(tab.runtimeState)) {
        toast.error(runtimeStatusLabel(tab.runtimeState))

        return
      }
      // An automatic turn must not trust a snapshot that may be seconds old,
      // and nothing may overtake a message that is already waiting.
      if (!replying && (!sendable || turnKind === 'plan-approval' || nextAutoSend(tab))) {
        queueUntilSendable(activeId, trimmed, filePaths, turnKind)

        return
      }
      if (uploadingTabsRef.current.has(activeId)) {
        toast.error('Attachment upload is still in progress')

        return
      }
      emitFirstRunConvo('asked')
      void dispatchTurn(activeId, trimmed, filePaths, turnKind)
    },
    [activeId, startChatWith, dispatchTurn, sendSteering, queueUntilSendable, teamId, currentUser],
  )

  const steerQueued = useCallback(
    async (tabId: string, queuedId: string) => {
      const tab = tabsRef.current.find((candidate) => candidate.id === tabId)
      const draft = tab?.queued?.find((candidate) => candidate.id === queuedId)

      if (!tab || !draft || draft.steering) return
      if (runtimeAllows(tab.runtimeState, 'steer')) {
        await sendSteering(tabId, draft.text, draft.filePaths, queuedId)

        return
      }
      if (!runtimeAllows(tab.runtimeState, 'send')) return
      await dispatchTurn(tabId, draft.text, draft.filePaths)
      setTabs((previous) =>
        previous.map((candidate) =>
          candidate.id === tabId
            ? { ...candidate, queued: candidate.queued?.filter((item) => item.id !== queuedId) }
            : candidate,
        ),
      )
    },
    [dispatchTurn, sendSteering, tabsRef, setTabs],
  )

  return { startChatWith, dispatchTurn, sendInActive, steerQueued }
}

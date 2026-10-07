import { getActiveDiagramId } from '../../../architecture/activeDiagram'
import { track, trackError } from '../../../lib/analytics'
import { toast } from '../../ui/toast'

import { partitionAttachments, readImageParts, makeAttachmentTurn } from './attachments'
import { supersedePendingApprovals, finalizeIncompleteTools } from './clientTools'
import { rememberDispatchedDraft } from './queuedAutoSend'
import { INTERRUPTED_TOOL_MESSAGE, newAgentStreamId } from './stall'
import { getAgentLocale } from './textUtils'
import { toUiMessages } from './toUiMessages'

import type { PanelCtx } from './ctx'
import type { Message } from './model'
import type { TransferUploadPart } from './parts'

export type DispatchTurnCtx = Pick<
  PanelCtx,
  | 'currentUser'
  | 'credentialAccessRef'
  | 'kubeContextRef'
  | 'sendableCredentialAccess'
  | 'setTabs'
  | 'stoppedRunIdsRef'
  | 'syncTranscriptNow'
  | 'tabsRef'
  | 'teamId'
  | 'uploadingTabsRef'
  | 'urlRef'
>

export async function runDispatchTurn(
  ctx: DispatchTurnCtx,
  tabId: string,
  text: string,
  filePaths: string[],
  turnKind?: Message['turnKind'],
) {
  const {
    currentUser,
    credentialAccessRef,
    kubeContextRef,
    sendableCredentialAccess,
    setTabs,
    stoppedRunIdsRef,
    syncTranscriptNow,
    tabsRef,
    teamId,
    uploadingTabsRef,
    urlRef,
  } = ctx

  const trimmed = text.trim()

  if (!trimmed && filePaths.length === 0) return
  // Images go to the model as vision; only non-image files need the upload
  // flow (and a team).
  const { imagePaths, otherPaths } = partitionAttachments(filePaths)

  if (otherPaths.length > 0 && !teamId) {
    toast.error('No team selected', 'Select a team before attaching files.')

    return
  }
  const tab = tabsRef.current.find((t) => t.id === tabId)

  if (!tab) return
  if (tab.readOnly) return
  stoppedRunIdsRef.current.delete(tab.sessionId)

  const imageParts = await readImageParts(imagePaths)
  const { messageId, optimisticPart, buildUserMsg, runUpload } = makeAttachmentTurn(
    text,
    imageParts,
    otherPaths,
    teamId!,
    { turnKind, currentUser },
  )
  const baseMessages =
    tab.runtimeState?.schemaVersion === 2
      ? tab.messages
      : supersedePendingApprovals(finalizeIncompleteTools(tab.messages, INTERRUPTED_TOOL_MESSAGE))

  let uploadPart: TransferUploadPart | null = null

  if (otherPaths.length > 0) {
    // Mark the tab busy so a second send queues instead of racing the upload.
    uploadingTabsRef.current.add(tabId)
    // Surface the message + loading card before the (potentially slow) upload.
    setTabs((prev) =>
      prev.map((t) =>
        t.id === tabId ? { ...t, messages: [...baseMessages, buildUserMsg(optimisticPart())] } : t,
      ),
    )
    try {
      uploadPart = await runUpload(tab.sessionId)
    } catch (err) {
      uploadingTabsRef.current.delete(tabId)
      // Patch the card to error against the latest tab state, then persist so
      // a reopened conversation doesn't show a stale uploading card.
      const current = tabsRef.current.find((t) => t.id === tabId)
      const patchedMessages = (current?.messages ?? []).map((m) =>
        m.id === messageId
          ? {
              ...m,
              parts: m.parts.map((p) =>
                p.type === 'transfer-upload'
                  ? {
                      ...p,
                      status: 'error' as const,
                      files: p.files.map((f) => ({ ...f, status: 'failed' })),
                    }
                  : p,
              ),
            }
          : m,
      )

      setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, messages: patchedMessages } : t)))
      if (current) syncTranscriptNow({ ...current, messages: patchedMessages })
      toast.apiError('Upload failed', err)

      return
    }
    uploadingTabsRef.current.delete(tabId)
  }

  track('agent_message_sent', {
    message_length: trimmed.length,
    file_count: filePaths.length,
    has_files: filePaths.length > 0,
    turn_index: tab.messages.length,
  })
  const userMsg = buildUserMsg(uploadPart)
  const streamId = newAgentStreamId()
  const streamStartedAt = Date.now()

  rememberDispatchedDraft(streamId, { id: messageId, text, filePaths, turnKind })
  // Patch the optimistic message by id against the latest tab state (it was
  // already rendered for uploads); append for the no-attachment case.
  const current = tabsRef.current.find((t) => t.id === tabId) ?? tab
  const nextMessages = current.messages.some((m) => m.id === messageId)
    ? current.messages.map((m) => (m.id === messageId ? userMsg : m))
    : [...baseMessages, userMsg]
  const credentialAccess = sendableCredentialAccess(
    credentialAccessRef.current.get(tab.sessionId) ?? tab.credentialAccess,
  )

  setTabs((prev) =>
    prev.map((t) =>
      t.id === tabId
        ? {
            ...t,
            messages: nextMessages,
            streaming: true,
            connected: false,
            phase: null,
            streamId,
            streamStartedAt,
            error: null,
            agentSetupRequired: null,
            bootQuiet: false,
            autoResumeAttempts: 0,
            credentialAccess,
            promptSuggestion: null,
          }
        : t,
    ),
  )
  syncTranscriptNow({
    ...tab,
    messages: nextMessages,
    streaming: true,
    connected: false,
    phase: null,
    streamId,
    streamStartedAt,
    error: null,
    agentSetupRequired: null,
    autoResumeAttempts: 0,
    credentialAccess,
  })
  void window.api
    .agentStart({
      streamId,
      sessionId: tab.sessionId,
      agentRuntime: tab.agentRuntime,
      runtimeId: tab.runtimeId,
      teamId,
      messages: toUiMessages(nextMessages),
      baseIndex: tab.historyBaseIndex,
      locale: getAgentLocale(),
      url: urlRef.current,
      kubeContext: kubeContextRef.current ?? undefined,
      diagramId: getActiveDiagramId() ?? undefined,
      credentialAccess,
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)

      trackError(
        {
          source: 'agent_stream',
          phase: 'agent_start_failed',
          message,
          streamId,
          sessionId: tab.sessionId,
        },
        err,
      )
      setTabs((prev) =>
        prev.map((t) =>
          t.streamId === streamId
            ? {
                ...t,
                streaming: false,
                streamId: null,
                phase: null,
                streamStartedAt: null,
                error: message,
              }
            : t,
        ),
      )
    })
}

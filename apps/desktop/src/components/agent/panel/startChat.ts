import { getActiveDiagramId } from '../../../architecture/activeDiagram.ts'
import { track, trackError } from '../../../lib/analytics.ts'
import { toast } from '../../ui/toast.ts'

import { credentialSelectionSignature } from './credentialAccess.ts'
import { newConversationCredentialAccessForRequest } from './credentialRequest.ts'
import { optimisticSenderMetadata } from './optimisticSender.ts'
import { markMessageSent } from './sentMessageMotion.ts'
import { retainBackgroundTabs } from './sessionContinuity.ts'
import { newAgentStreamId, uid } from './stall.ts'
import { getAgentLocale } from './textUtils.ts'
import { toUiMessages } from './toUiMessages.ts'

import type { PanelCtx } from './ctx'
import type { Message, Tab } from './model'
import type { TransferUploadPart } from './parts'

export type StartChatCtx = Pick<
  PanelCtx,
  | 'currentUser'
  | 'credentialAccessRef'
  | 'defaultPermissionMode'
  | 'kubeContextRef'
  | 'lastCredentialSyncedRef'
  | 'newConversationRuntime'
  | 'newConversationCredentialAccess'
  | 'setActiveId'
  | 'setBypassBySession'
  | 'setTabs'
  | 'syncTranscriptNow'
  | 'teamId'
  | 'uploadingTabsRef'
  | 'urlRef'
>

export function runStartChatWith(
  ctx: StartChatCtx,
  prompt: string,
  initialMessage?: Message,
  // When the first message carries attachments, hold the agent
  // until the upload finalizes: the chat opens immediately with a loading
  // card, then `run` resolves the upload part and the stream starts.
  deferredUpload?: {
    messageId: string
    run: (sessionId: string | undefined) => Promise<TransferUploadPart>
  },
) {
  const {
    currentUser,
    credentialAccessRef,
    defaultPermissionMode,
    kubeContextRef,
    lastCredentialSyncedRef,
    newConversationRuntime,
    newConversationCredentialAccess,
    setActiveId,
    setBypassBySession,
    setTabs,
    syncTranscriptNow,
    teamId,
    uploadingTabsRef,
    urlRef,
  } = ctx

  if (newConversationRuntime?.status !== 'active') {
    toast.error('Choose an available agent', 'Connect or enable an agent in Settings → Agent.')

    return
  }
  const id = uid()
  const sessionId = uid()

  // Preserve the selected mode immediately. Transcript sync can create the
  // conversation before /chat initializes its permissions, so the permissions
  // hook waits for the first turn to settle before reconciling with the server.
  setBypassBySession((prev) => ({
    ...prev,
    [sessionId]: defaultPermissionMode === 'bypass',
  }))
  track('agent_chat_started', {
    prompt_length: prompt.length,
    has_initial_message: Boolean(initialMessage),
    // Which mode the user chose to open this conversation in. Bypass is a
    // deliberate, standing hand-over of confirmation, so its share of new
    // conversations reads as trust depth per team.
    permission_mode: defaultPermissionMode,
  })
  const title = prompt.length > 32 ? `${prompt.slice(0, 32)}…` : prompt
  const createdAt = Date.now()
  const userMsg: Message = initialMessage ?? {
    id: uid(),
    role: 'user',
    parts: [{ type: 'text', text: prompt }],
    createdAt,
    metadata: optimisticSenderMetadata(currentUser, createdAt),
  }

  if (!initialMessage) markMessageSent(userMsg.id)
  const streamId = newAgentStreamId()
  const streamStartedAt = Date.now()
  const credentialAccess = newConversationCredentialAccess
  const credentialAccessForRequest = newConversationCredentialAccessForRequest(credentialAccess)
  const initial: Tab = {
    id,
    sessionId,
    agentRuntime: newConversationRuntime.provider,
    runtimeId: newConversationRuntime.id,
    runtimeLabel: newConversationRuntime.label,
    title,
    messages: [userMsg],
    // While the attachment uploads the turn isn't streaming yet — the loading
    // card conveys progress and the stream starts once the upload resolves.
    streaming: !deferredUpload,
    connected: false,
    phase: null,
    streamId: deferredUpload ? null : streamId,
    streamStartedAt: deferredUpload ? null : streamStartedAt,
    error: null,
    autoResumeAttempts: 0,
    credentialAccess,
    readOnly: false,
    slackThread: null,
  }

  credentialAccessRef.current.set(sessionId, initial.credentialAccess)
  lastCredentialSyncedRef.current.set(
    sessionId,
    credentialSelectionSignature(initial.credentialAccess),
  )
  setTabs((prev) => [...retainBackgroundTabs(prev, uploadingTabsRef.current), initial])
  setActiveId(id)
  syncTranscriptNow(initial)

  const launch = (messages: Message[], sId: string) => {
    void window.api
      .agentStart({
        streamId: sId,
        sessionId,
        teamId,
        messages: toUiMessages(messages),
        locale: getAgentLocale(),
        url: urlRef.current,
        kubeContext: kubeContextRef.current ?? undefined,
        diagramId: getActiveDiagramId() ?? undefined,
        credentialAccess: credentialAccessForRequest,
        // Only here: this call is what creates the conversation, and the
        // backend initializes it once on the first turn. Later turns must not
        // resend it, or changing the mode mid-conversation would be undone
        // by the next message.
        permissionMode: defaultPermissionMode,
        agentRuntime: newConversationRuntime.provider,
        runtimeId: newConversationRuntime.id,
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)

        trackError(
          {
            source: 'agent_stream',
            phase: 'agent_start_failed',
            message,
            streamId: sId,
            sessionId,
          },
          err,
        )
        setTabs((prev) =>
          prev.map((t) =>
            t.streamId === sId
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

  if (deferredUpload) {
    // The backend session doesn't exist until `agentStart` registers it, so a
    // first-message upload must be TEAM-scoped (not agent-session-scoped) or
    // verifyAgent rejects it. The agent can still pull it: loadGroup matches on
    // team + user, not session.
    uploadingTabsRef.current.add(id)
    deferredUpload
      .run(undefined)
      .then((uploadPart) => {
        uploadingTabsRef.current.delete(id)
        const patched: Message = {
          ...userMsg,
          parts: userMsg.parts.map((p) => (p.type === 'transfer-upload' ? uploadPart : p)),
        }
        const nextStreamId = uid()
        const nextStartedAt = Date.now()

        setTabs((prev) =>
          prev.map((t) =>
            t.id === id
              ? {
                  ...t,
                  messages: [patched],
                  streaming: true,
                  connected: false,
                  phase: null,
                  streamId: nextStreamId,
                  streamStartedAt: nextStartedAt,
                  error: null,
                }
              : t,
          ),
        )
        syncTranscriptNow({
          ...initial,
          messages: [patched],
          streaming: true,
          streamId: nextStreamId,
          streamStartedAt: nextStartedAt,
        })
        launch([patched], nextStreamId)
      })
      .catch((err: unknown) => {
        uploadingTabsRef.current.delete(id)
        const patched: Message = {
          ...userMsg,
          parts: userMsg.parts.map((p) =>
            p.type === 'transfer-upload'
              ? {
                  ...p,
                  status: 'error' as const,
                  files: p.files.map((f) => ({ ...f, status: 'failed' })),
                }
              : p,
          ),
        }

        setTabs((prev) =>
          prev.map((t) =>
            t.id === id
              ? {
                  ...t,
                  messages: [patched],
                  streaming: false,
                  streamId: null,
                  streamStartedAt: null,
                }
              : t,
          ),
        )
        // Persist the failed card so reopening the conversation doesn't show a
        // stale "uploading" state (the optimistic card was already synced).
        syncTranscriptNow({
          ...initial,
          messages: [patched],
          streaming: false,
          streamId: null,
          streamStartedAt: null,
        })
        toast.apiError('Upload failed', err)
      })

    return
  }

  launch([userMsg], streamId)
}

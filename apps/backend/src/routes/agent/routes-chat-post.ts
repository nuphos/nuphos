import { randomUUID } from 'node:crypto'

import { shouldInitializePermissionMode } from './chat-permission-mode'
import { launchAcceptedChatTurn } from './chat-post-run'
import { awaitAdoptedPreviewRun, resolvePreviewWaitFromChat } from './chat-preview-resume'
import { admitPreviewTurn } from './chat-preview-steering'
import { handleExistingRun, resumeFromRedisOrThrow } from './chat-resume'
import {
  buildSlackBoundTurnPlan,
  claimSlackBoundTurn,
  findSlackBoundThread,
} from './chat-slack-bound'
import { attachSteeringTurn } from './chat-steering-attach'
import { hydrateTranscriptPrefix, validateChatBody } from './chat-validate'
import { resolveAgentCredentialAccess } from './credential-resolve'
import { agent } from './router'
import { appendAgentRunPhase } from './run-frames'
import {
  agentRunKey,
  agentRuns,
  claimAgentRunForSession,
  createAgentRun,
  registerAgentRun,
} from './run-registry'
import { streamAgentRunResponse } from './run-stream'
import { admitRuntimeChat } from './runtime-chat-admission'
import {
  assertConversationSendable,
  readTeamIdCandidate,
  resolveReadableConversationForResume,
  resolveVerifiedTeamId,
  sanitizeKubeContextHeader,
} from './team-scope'
import { serializeTelemetryMessages } from './telemetry'
import { getFirstUserMessage } from './transcript'
import { appendAgentRunTurnStart } from './turn-start-frame'

import type { AgentChatBody, AgentRunTrace, InternalChatCtx } from './types'

import { isAutoModeApprovalEnabled as isAutoModeEnabled } from '@/lib/agent/auto-mode/approval'
import { initializeSessionBypass as initializeAutoModeSessionBypass } from '@/lib/agent/auto-mode/store'
import { startTraceSpan } from '@/lib/agent/braintrust'
import { regionLabel } from '@/lib/agent/model-provider'
import { resolveConversationChatRuntime } from '@/lib/claude-code-preview/agent-chat-runtime'
import { conversationExecutionState } from '@/lib/claude-code-preview/session-execution-state'
import { AppError } from '@/lib/errors'
import { logEvent } from '@/lib/observability'

agent.post('/chat', async (c) => {
  const userId = c.get('userId')
  const requestId = c.get('requestId') ?? randomUUID()
  const locale = c.req.header('X-Atlas-Locale') ?? 'en-US'
  const body = await c.req.json<AgentChatBody>()
  const { id } = body
  const teamId = await resolveVerifiedTeamId(c, readTeamIdCandidate(c, body.teamId))

  if (!id || !Array.isArray(body.messages)) {
    throw new AppError(400, 'invalid_request', 'Body must include { id, messages }')
  }
  validateChatBody(body)
  const localToolsEnabled = body.clientCapabilities?.localTools === true
  const conversationForResume = body.resume
    ? await resolveReadableConversationForResume(id, userId, teamId)
    : await assertConversationSendable(id, userId, teamId)
  const runOwnerUserId = conversationForResume?.userId ?? userId

  // Initialize once even if transcript sync already created the row.
  if (
    runOwnerUserId === userId &&
    shouldInitializePermissionMode(body, conversationForResume) &&
    isAutoModeEnabled()
  ) {
    await initializeAutoModeSessionBypass(id, userId, body.permissionMode === 'bypass')
  }
  const readOnlyResume = body.resume === true && runOwnerUserId !== userId
  // Resolve Slack binding alongside transcript hydration.
  const clientViewPromise = hydrateTranscriptPrefix(
    body,
    id,
    runOwnerUserId,
    conversationForResume,
    userId,
  )
  const slackThread =
    !body.resume && conversationForResume
      ? await findSlackBoundThread(id, conversationForResume.metadata?.source)
      : null
  const clientView = await clientViewPromise

  const kubeContext = sanitizeKubeContextHeader(c.req.header('X-Atlas-Kube-Context'))
  const requestedCredentialAccess =
    body.credentialAccess !== undefined && !readOnlyResume && runOwnerUserId === userId
      ? await resolveAgentCredentialAccess({
          teamId,
          userId,
          selection: body.credentialAccess,
          stored: conversationForResume?.credentialAccess,
          kubeContext,
        })
      : null
  const streamId = body.streamId?.trim() || randomUUID()
  const runKey = agentRunKey(runOwnerUserId, streamId)
  const existingRun = agentRuns.get(runKey)
  const resumeParams = {
    requestId,
    userId,
    runOwnerUserId,
    sessionId: id,
    teamId,
    streamId,
    body,
    readOnlyResume,
  }

  if (existingRun) {
    const attached = handleExistingRun(existingRun, resumeParams)

    if (attached) return attached
  }
  if (body.resume) return await resumeFromRedisOrThrow(resumeParams)
  const chatRuntime = await resolveConversationChatRuntime(teamId, conversationForResume, {
    userId,
    ...(body.agentRuntime ? { runtime: body.agentRuntime } : {}),
    ...(body.runtimeId ? { runtimeId: body.runtimeId } : {}),
  })
  const runtimeProvider = chatRuntime.runtime
  const runtimeModelId = chatRuntime.runtime
  let releaseAgentRunClaim: (() => void) | null = null

  // Runtime admission supersedes backend stream leases. Leases still route
  // replay/cancellation; they do not say whether an OpenAB session can accept work.
  const runtimeSnapshot = conversationForResume?.claudeCodePreview
    ? await conversationExecutionState(conversationForResume)
    : undefined
  const runtimeOwnsAdmission = runtimeSnapshot?.schemaVersion === 2

  if (!readOnlyResume) {
    const previewWait = await resolvePreviewWaitFromChat({
      userId,
      sessionId: id,
      streamId,
      body,
    })

    if (previewWait) {
      const adopted = await awaitAdoptedPreviewRun(runOwnerUserId, streamId)
      const attached = adopted ? handleExistingRun(adopted, resumeParams) : null

      return attached ?? (await resumeFromRedisOrThrow(resumeParams))
    }
    await admitRuntimeChat(runtimeSnapshot, {
      attached: conversationForResume?.claudeCodePreview ? conversationForResume : undefined,
      replying: Boolean(body.resumeReason),
      read: conversationExecutionState,
    })
    if (!runtimeOwnsAdmission) {
      // Park onto this conversation's running turn, or claim the session before
      // launching one.
      const admission = await admitPreviewTurn(
        {
          runOwnerUserId,
          userId,
          teamId,
          sessionId: id,
          messages: clientView,
        },
        { claim: claimAgentRunForSession },
      )

      if (admission?.mode === 'attach') {
        return await attachSteeringTurn(resumeParams, admission.streamId, conversationForResume)
      }
      if (admission?.mode === 'launch') releaseAgentRunClaim = admission.releaseClaim
    }
  }

  if (!releaseAgentRunClaim && slackThread && !runtimeOwnsAdmission) {
    releaseAgentRunClaim = await claimSlackBoundTurn(runOwnerUserId, id)
  }

  try {
    const slackPlan =
      slackThread || conversationForResume
        ? await buildSlackBoundTurnPlan({
            body,
            clientView,
            sessionId: id,
            runOwnerUserId,
            teamId,
            serverHistoryOnly: !body.continueAfterInterruption || runOwnerUserId !== userId,
          })
        : null
    const messages = slackPlan?.messages ?? clientView
    const firstMessage = getFirstUserMessage(messages)
    const isPotentialNewConversation = messages.length === 1 && messages[0]?.role === 'user'
    const conversationParent: string | undefined = undefined

    const chatSpan = startTraceSpan({
      name: 'turn',
      type: 'task',
      metadata: {
        route: '/agent/chat',
        method: 'POST',
        requestId,
        userId,
        sessionId: id,
        teamId,
        streamId,
        locale,
        provider: runtimeProvider,
        modelId: runtimeModelId,
        region: regionLabel(),
        isNewConversation: isPotentialNewConversation,
        conversationRootDeferred: true,
        messageCount: messages.length,
      },
      input: {
        messages: serializeTelemetryMessages(messages),
      },
    })

    const chatCtx: InternalChatCtx = {
      requestId,
      streamId,
      userId,
      nuphosToken: c.get('authToken'),
      locale,
      currentUrl:
        c.req.header('X-Atlas-Url') ?? c.req.header('referer') ?? c.req.header('origin') ?? null,
      localToolsEnabled,
      kubeContext,
      diagramId: c.req.header('X-Atlas-Diagram-Id')?.trim() || undefined,
      isInApp: true,
      agentOrigin: 'user',
    }

    logEvent('info', 'agent.chat.start', {
      request_id: requestId,
      user_id: userId,
      session_id: id,
      team_id: teamId,
      stream_id: streamId,
      provider: runtimeProvider,
      model_id: runtimeModelId,
      region: regionLabel(),
      locale,
      message_count: messages.length,
      is_new_conversation: isPotentialNewConversation,
      resume: Boolean(body.resume),
      continue_after_interruption: Boolean(body.continueAfterInterruption),
      local_tools_enabled: localToolsEnabled,
      client_version: c.req.header('X-Atlas-Client') ?? undefined,
    })

    const runTrace: AgentRunTrace = {
      requestId,
      userId,
      sessionId: id,
      teamId,
      streamId,
      route: '/agent/chat',
      method: 'POST',
      chatSpan,
    }
    const run = createAgentRun(runOwnerUserId, id, streamId, runTrace)

    registerAgentRun(run)
    appendAgentRunTurnStart(run, messages)
    appendAgentRunPhase(run, 'request-accepted')
    launchAcceptedChatTurn({
      run,
      chatCtx,
      chatSpan,
      conversationParent,
      body,
      teamId,
      messages,
      firstMessage,
      locale,
      credentialAccess: requestedCredentialAccess?.access,
      credentialAccessRequested: requestedCredentialAccess !== null,
      releaseClaim: releaseAgentRunClaim,
      slack: slackThread
        ? {
            thread: slackThread,
            runOwnerUserId,
            userName: c.get('userName'),
            mirror: slackPlan?.mirror ?? null,
          }
        : null,
      chatRuntime,
    })

    return streamAgentRunResponse(run, body.resumeFrom)
  } catch (err) {
    releaseAgentRunClaim?.()
    throw err
  }
})

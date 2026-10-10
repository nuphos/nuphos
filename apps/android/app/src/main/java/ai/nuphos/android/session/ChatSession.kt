package ai.nuphos.android.session

import android.util.Log
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import ai.nuphos.android.data.AttachmentTransfers
import ai.nuphos.android.data.AgentChatApi
import ai.nuphos.android.data.JsonValue
import ai.nuphos.android.data.NuphosApi
import ai.nuphos.android.data.RuntimeApi
import ai.nuphos.android.data.Http
import ai.nuphos.android.model.AgentConversationDetail
import ai.nuphos.android.data.SseClient
import ai.nuphos.android.model.ChatRow
import ai.nuphos.android.model.ChatMessage
import ai.nuphos.android.model.ChatPart
import ai.nuphos.android.model.ComposerSubmission
import ai.nuphos.android.model.CredentialSelection
import ai.nuphos.android.model.PermissionMode
import ai.nuphos.android.model.Plan
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.time.Instant
import java.util.UUID
import kotlin.coroutines.coroutineContext
import kotlin.math.min
import kotlin.math.pow

class ChatSession(
    private val token: String,
    val teamId: String,
    val sessionId: String = UUID.randomUUID().toString().lowercase(),
    title: String = "New chat",
    private val transfers: AttachmentTransfers = AttachmentTransfers(),
    val browsingOnly: Boolean = false,
    private val readDetail: suspend (String, String, String) -> AgentConversationDetail = NuphosApi::conversationDetail,
    private val aiAllowed: () -> Boolean = AiAccess.bind(token),
    val creationRuntimeBinding: ai.nuphos.android.data.RuntimeBinding? = null,
    private val steerRuntime: suspend (String, String, String, String) -> String = RuntimeApi::steer,
) {
    var runtimeDeviceLabel by mutableStateOf(creationRuntimeBinding?.displayLabel?.takeIf { it.isNotBlank() })
        private set
    private var serverMetadataObserved = false
    val outgoingCreationBinding get() = creationRuntimeBinding.takeUnless { serverMetadataObserved }
    var title by mutableStateOf(title)
        private set
    var messages by mutableStateOf(listOf<ChatMessage>())
        private set
    data class ReadTranscript(val generation: Long, val seq: Long, val messages: List<ChatMessage>)
    var readTranscript by mutableStateOf<ReadTranscript?>(null)
        private set
    private var recallRows by mutableStateOf(setOf<ChatRow.MemoryRecall>())
    fun canShowRecall(row: ChatRow.MemoryRecall) = hasAiAccess && loaded && loadError == null && row in recallRows
    private var readGeneration = 0L
    private var detailLoadGeneration = 0L
    val readAllowed get() = hasAiAccess && !browsingOnly && loaded && loadError == null
    private fun recordReadTranscript(detail: AgentConversationDetail) {
        recallRows = if (messages == detail.messages) ChatRow.rows(detail.messages)
            .filterIsInstance<ChatRow.MemoryRecall>().toSet() else emptySet()
        val seq = HistoryStatus.sequence(detail.activitySeq)
        if (detail.isOwner != true || browsingOnly || seq == null || ((detail.messagesFirstIndex ?: 0) != 0 && detail.activeRun != null) || messages != detail.messages) { readTranscript = null; return }
        if (readTranscript?.seq != seq || readTranscript?.messages != messages)
            readTranscript = ReadTranscript(++readGeneration, seq, messages)
    }
    var baseIndex by mutableStateOf(0)
        private set
    var isStreaming by mutableStateOf(false)
        private set
    var phaseLabel by mutableStateOf<String?>(null)
        private set
    var error by mutableStateOf<String?>(null)
        private set
    var queued by mutableStateOf(listOf<String>())
        private set
    var readOnly by mutableStateOf(browsingOnly)
        private set
    var loaded by mutableStateOf(false)
        private set
    var loadError by mutableStateOf<String?>(null)
        private set
    var stoppedByUser by mutableStateOf(false)
        private set
    var turnStartedAt by mutableStateOf<Instant?>(null)
        private set
    var followsBottom by mutableStateOf(true)
    var permissionMode by mutableStateOf(PermissionMode.Auto)
        private set
    var credentialAccess by mutableStateOf<CredentialSelection?>(null)
    var sendAfterLoad: String? = null

    var isArchived by mutableStateOf(false)
        private set
    var isOwner by mutableStateOf(true)
        private set
    var canCancelRun by mutableStateOf(false)
        private set
    var canRespondToRun by mutableStateOf(false)
        private set
    var agentRuntime by mutableStateOf<String?>(null)
        private set
    var runtimeObservation by mutableStateOf<RuntimeObservation?>(null)
        private set
    var cancelRequested by mutableStateOf(false)
        private set
    private var observationClock by mutableStateOf(RuntimeObservation.now())
    private var submissionPending by mutableStateOf(false)
    private var replySubmissionPending = false
    private var repliedWaitKey: String? = null
    private var steeringPending by mutableStateOf(false)
    private data class PendingSteering(val text: String, val assistantId: String?, val existingIds: Set<String>)
    private var steeringHold by mutableStateOf<PendingSteering?>(null)
    private val steeringUnconfirmed get() = steeringHold != null || error?.startsWith("Steering delivery is unconfirmed.") == true
    var rejectedSubmission by mutableStateOf<ComposerSubmission?>(null)
        private set
    private var pendingSubmission: ComposerSubmission? = null
    private var pendingUserMessage: ChatMessage? = null
    private var retryUserMessage: ChatMessage? = null
    private var retrySubmission: ComposerSubmission? = null
    private var submissionAccepted = false
    var runtimeRecoveryRequired by mutableStateOf(false)
        private set
    var steeringRetryRequired by mutableStateOf(false)
        private set
    private val streamCursors = mutableMapOf<String, Int>()
    private val streamAssistantIds = mutableMapOf<String, String>()
    private var serverOwnedTranscript = false
    private var transportGeneration = 0
    private var nativeAdmissionObserved by mutableStateOf(false)
    val isNative get() = agentRuntime != "nuphos" && (agentRuntime != null || nativeAdmissionObserved)
    private var consentDisposed = false
    private val hasAiAccess get() = !consentDisposed && aiAllowed()
    private val permissions get() = SessionPermissions(loaded, loadError, readOnly || !hasAiAccess, isOwner, canCancelRun, canRespondToRun)
    val canManage get() = permissions.manage
    val canReply get() = permissions.reply && (!isNative || runtimeObservation?.allows("reply", RuntimeObservation.now()) == true) && !submissionPending
    val canEnqueueSteering get() = !steeringUnconfirmed && permissions.reply && isNative && runtimeObservation?.allows("reply", RuntimeObservation.now()) != true && runtimeObservation?.allows("steer", RuntimeObservation.now()) == true
    val canSteer get() = canEnqueueSteering && !steeringPending
    val canSubmit get() = !runtimeRecoveryRequired && (!isNative || !steeringUnconfirmed) && permissions.writable && !uploadBusy && (!submissionPending || canEnqueueSteering) && (!isNative || canReply || canEnqueueSteering || runtimeObservation?.allows("send", RuntimeObservation.now()) == true)
    val canCancel get() = permissions.cancel && !cancelRequested && (if (isNative) runtimeObservation?.allows("cancel", RuntimeObservation.now()) == true else isStreaming)
    val runtimeLabel get() = if (isNative) {
        val observation = runtimeObservation
        if (observation == null) "Runtime status unavailable" else observation.status(observationClock)
    } else null

    val isNew: Boolean get() = messages.isEmpty() && loaded

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var streamJob: Job? = null
    private var currentStreamId: String? = null
    private var transcriptSyncJob: Job? = null
    private var lastSyncedSignature = 0
    private var autoResumeAttempts = 0
    private var transcriptFullResend = false
    private var transcriptRebasedTo: Int? = null
    private var lastStoppedStreamId: String? = null

    fun updatePermissionMode(mode: PermissionMode) {
        if (!canManage) return
        val previous = permissionMode
        permissionMode = mode
        if (isNew || previous == mode) return
        scope.launch {
            try {
                if (!hasAiAccess) return@launch
                AgentChatApi.setBypass(token, sessionId, mode == PermissionMode.Bypass)
            } catch (e: Exception) {
                permissionMode = previous
                error = e.message
            }
        }
    }

    fun presetPermissionMode(mode: PermissionMode) {
        permissionMode = mode
    }

    suspend fun load() {
        if (!hasAiAccess) return
        recallRows = emptySet()
        readTranscript = null
        readGeneration++
        val detailGeneration = ++detailLoadGeneration
        try {
            val observedAt = RuntimeObservation.now()
            val detail = readDetail(token, teamId, sessionId)
            if (!hasAiAccess || detailGeneration != detailLoadGeneration) return
            refreshMetadata(detail, observedAt)
            var msgs = detail.messages
            baseIndex = detail.messagesFirstIndex ?: 0
            isArchived = detail.archivedAt != null
            readOnly = browsingOnly || (detail.readOnly ?: false)
            if (browsingOnly) loadError = null
            detail.title?.takeIf { it.isNotEmpty() }?.let { title = it }
            detail.credentialAccess?.let {
                val selection = CredentialSelection(it)
                credentialAccess = if (selection.isEmpty) null else selection
            }
            if (!browsingOnly) scope.launch {
                if (!hasAiAccess) return@launch
                runCatching { AgentChatApi.bypass(token, sessionId) }.getOrNull()?.let {
                    if (!hasAiAccess) return@launch
                    permissionMode = if (it) PermissionMode.Bypass else PermissionMode.Auto
                }
            }
            val run = detail.activeRun
            if (run != null && !browsingOnly) {
                val lastUser = msgs.indexOfLast { it.role == ChatMessage.Role.User }
                if (!isNative && lastUser >= 0) msgs = msgs.take(lastUser + 1)
                messages = msgs
                loaded = true
                startTurn(TurnOptions(streamId = run.streamId, explicitResume = true, resumeFrom = 0))
            } else {
                messages = msgs
                loaded = true
            }
            loadError = null
            recordReadTranscript(detail)
            lastSyncedSignature = signature()
            val text = sendAfterLoad
            if (text != null) {
                sendAfterLoad = null
                if (!readOnly && !isStreaming) send(text)
            }
        } catch (e: Exception) {
            if (!hasAiAccess || detailGeneration != detailLoadGeneration) return
            loadError = e.message
            loaded = true
        }
    }

    var uploadDraft by mutableStateOf<ComposerSubmission?>(null)
        private set
    var uploadProgress by mutableStateOf<AttachmentTransfers.Progress?>(null)
        private set
    var uploadError by mutableStateOf<String?>(null)
        private set
    var uploadBusy by mutableStateOf(false)
        private set
    private var retainedTransfer: AttachmentTransfers.Pending? = null
    private var uploadJob: Job? = null
    private var uploadGeneration = 0
    private var preparedTransfer: AttachmentTransfers.Pending? = null

    fun send(text: String) = send(ComposerSubmission(text))
    fun send(submission: ComposerSubmission): Boolean {
        observationClock = RuntimeObservation.now()
        if (submission.attachments.isEmpty()) return sendPrepared(submission)
        if (!canSubmit || isStreaming || (isNative && (canReply || canEnqueueSteering))) {
            error = "Keep attachments for a new message after the current run."
            return false
        }
        if (uploadDraft != null) { error = "Retry or remove the retained attachment batch first."; return false }
        val pending = try { preparedTransfer?.takeIf { it.attachmentIds == submission.attachments.map { a -> a.id } } ?: transfers.retain(submission.attachments) }
            catch (e: Exception) { error = e.message; return false }
        uploadDraft = submission
        retainedTransfer = pending
        beginUpload()
        return true
    }
    fun retryUpload() {
        if (uploadBusy || uploadDraft == null || !canSubmit) return
        if (retainedTransfer == null) retainedTransfer = transfers.retain(uploadDraft!!.attachments)
        beginUpload()
    }
    fun cancelUpload() {
        uploadGeneration += 1
        retainedTransfer?.let { transfers.cancel(it) }
        uploadJob?.cancel()
        uploadJob = null
        retainedTransfer = null
        uploadBusy = false
        uploadError = "Upload cancelled. Your message and files are retained."
    }
    fun discardUpload() {
        cancelUpload()
        uploadDraft?.attachments?.forEach { it.releaseOwnedCopy() }
        uploadDraft = null
        uploadProgress = null
        uploadError = null
    }
    private fun releaseAcceptedAttachmentCopies() {
        if (!submissionAccepted) return
        pendingSubmission?.attachments?.forEach { it.releaseOwnedCopy() }
        preparedTransfer?.payloads?.forEach { it.source?.release() }
        preparedTransfer = null
    }
    private fun beginUpload() {
        if (!hasAiAccess) return
        val draft = uploadDraft ?: return
        val pending = retainedTransfer ?: return
        val generation = ++uploadGeneration
        uploadBusy = true
        uploadError = null
        uploadJob = scope.launch {
            try {
                val ready = transfers.prepare(token, teamId, pending, allowed = { hasAiAccess }) { if (generation == uploadGeneration) uploadProgress = it }
                if (generation != uploadGeneration || !hasAiAccess) return@launch
                uploadBusy = false
                observationClock = RuntimeObservation.now()
                if (!canSubmit || isStreaming || (isNative && (canReply || canEnqueueSteering))) {
                    uploadError = "Files are ready. Wait for the current run, then retry this message."
                    return@launch
                }
                if (sendPrepared(draft, ready.instruction)) {
                    preparedTransfer = pending
                    uploadDraft = null
                    uploadProgress = null
                    retainedTransfer = null
                }
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { uploadError = e.message ?: "Upload failed. Retry the retained message." }
            finally { if (generation == uploadGeneration) { uploadBusy = false; uploadJob = null } }
        }
    }

    private fun sendPrepared(submission: ComposerSubmission, transferInstruction: String? = null): Boolean {
        observationClock = RuntimeObservation.now()
        val trimmed = submission.text.trim()
        val attachments = submission.attachments
        if ((trimmed.isEmpty() && attachments.isEmpty()) || !canSubmit) return false
        if (isNative && canEnqueueSteering) {
            if (attachments.isNotEmpty()) { error = "Steering accepts text only. Keep attachments for the next message."; return false }
            queued = queued + trimmed
            submitSteering()
            return true
        }
        if (!isNative && isStreaming) {
            if (attachments.isNotEmpty()) { error = "Keep attachments until the current reply finishes."; return false }
            if (trimmed.isNotEmpty()) queued = queued + trimmed
            return true
        }
        val reply = isNative && canReply
        if (reply) lockRuntimeReply()
        submissionPending = true
        pendingSubmission = submission
        rejectedSubmission = null
        val parts = buildList {
            if (trimmed.isNotEmpty()) add(ChatPart.Text(text = trimmed, state = ChatPart.StreamState.Done))
            for (a in attachments) {
                a.dataUrl?.let { add(ChatPart.File(mediaType = "image/jpeg", filename = a.name, url = it)) }
            }
            transferInstruction?.let { add(ChatPart.Text(text = it, state = ChatPart.StreamState.Done)) }
        }
        val message = retryUserMessage?.takeIf { retrySubmission == submission } ?: ChatMessage(role = ChatMessage.Role.User, parts = parts)
        submissionAccepted = false
        scope.launch { dispatch(message, if (trimmed.isEmpty()) "Photo" else trimmed, reply) }
        return true
    }

    fun clearRejectedSubmission() { rejectedSubmission = null }

    fun removeQueued(index: Int) {
        if (!permissions.writable || (index == 0 && (steeringPending || steeringUnconfirmed))) return
        if (index in queued.indices) queued = queued.toMutableList().also { it.removeAt(index) }
        if (queued.isEmpty()) { steeringRetryRequired = false; if (!steeringUnconfirmed) error = null }
    }

    private suspend fun dispatch(message: ChatMessage, titleText: String, reply: Boolean = false) {
        if (!permissions.writable) { rejectedSubmission = pendingSubmission; pendingSubmission = null; submissionPending = false; return }
        val wasEmpty = messages.isEmpty()
        val lastAssistant = messages.indexOfLast { it.role == ChatMessage.Role.Assistant }
        if (lastAssistant >= 0) {
            val updated = messages.toMutableList()
            updated[lastAssistant] = updated[lastAssistant].supersedePendingApprovals().finalizeIncompleteTools()
            messages = updated
        }
        if (messages.none { it.id == message.id }) messages = messages + message
        pendingUserMessage = message
        if (wasEmpty) {
            title = if (titleText.length > 32) titleText.take(32) + "…" else titleText
        }
        error = null
        stoppedByUser = false
        followsBottom = true
        syncTranscriptNow()
        if (!hasAiAccess) return
        startTurn(TurnOptions(streamId = newId(), resumeReason = if (reply) "runtime-reply" else null, permissionMode = if (wasEmpty) permissionMode.raw else null))
    }

    enum class ApprovalDecision { Once, Session, Always, Deny }

    fun decide(toolCallId: String, decision: ApprovalDecision, alwaysRule: String = "") {
        observationClock = RuntimeObservation.now()
        val createsPolicy = decision == ApprovalDecision.Session || decision == ApprovalDecision.Always
        if (!permissions.writable || (createsPolicy && !canManage) || (isNative && !canReply) || submissionPending) return
        val found = findTool(toolCallId) ?: return
        val (mi, pi, part) = found
        if (part.state != ChatPart.Tool.State.ApprovalRequested) return
        submissionPending = true
        if (isNative) lockRuntimeReply(toolCallId)
        val updated = part.copy(
            state = ChatPart.Tool.State.ApprovalResponded,
            approval = part.approval?.copy(approved = decision != ApprovalDecision.Deny),
            startedAt = Instant.now().toEpochMilli().toDouble(),
        )
        replaceTool(mi, pi, updated)
        error = null
        scope.launch {
            try {
                if (!permissions.writable || (createsPolicy && !canManage)) {
                    submissionPending = false
                    replySubmissionPending = false
                    replaceTool(mi, pi, part)
                    return@launch
                }
                when (decision) {
                    ApprovalDecision.Session -> part.command?.let { AgentChatApi.approveForSession(token, sessionId, it) }
                    ApprovalDecision.Always -> AgentChatApi.createPolicyRule(token, alwaysRule)
                    else -> Unit
                }
                startTurn(TurnOptions(streamId = newId(), continueAfterInterruption = true, resumeReason = "approval-decision"))
            } catch (e: Exception) {
                submissionPending = false
                replySubmissionPending = false
                replaceTool(mi, pi, part)
                error = e.message
            }
        }
    }

    suspend fun confirmProposedRule(ruleId: String): Boolean =
        canManage && runCatching { AgentChatApi.activatePolicyRule(token, ruleId) }.isSuccess

    suspend fun dismissProposedRule(ruleId: String): Boolean =
        canManage && runCatching { AgentChatApi.deletePolicyRule(token, ruleId) }.isSuccess

    suspend fun plan(planId: String): Plan {
        check(hasAiAccess) { "AI consent is required." }
        return AgentChatApi.plan(token, teamId, planId)
    }

    suspend fun approvePlan(planId: String): Plan {
        check(permissions.writable) { "This conversation is read-only." }
        val updated = AgentChatApi.updatePlan(token, teamId, planId, "approved")
        if (updated.status == "approved") send("Approved plan #$planId — please proceed with plan #$planId.")
        return updated
    }

    suspend fun rejectPlan(planId: String): Plan {
        check(permissions.writable) { "This conversation is read-only." }
        val updated = AgentChatApi.updatePlan(token, teamId, planId, "rejected")
        send("Rejected the plan — discard it and stop.")
        return updated
    }

    fun requestPlanChanges(reason: String) {
        send("Requested changes to the plan. $reason")
    }

    suspend fun rate(messageId: String, rating: String?) {
        if (!permissions.writable) return
        runCatching { AgentChatApi.feedback(token, teamId, sessionId, messageId, rating) }
        if (!hasAiAccess) return
        messages = messages.map { if (it.id == messageId) it.copy(feedback = rating) else it }
    }

    fun stop() {
        observationClock = RuntimeObservation.now()
        if (!canCancel) return
        if (isNative) {
            cancelRequested = true
            scope.launch {
                try { if (!hasAiAccess) return@launch; RuntimeApi.cancel(token, teamId, sessionId) }
                catch (e: Exception) { cancelRequested = false; error = e.message }
            }
            return
        }
        stoppedByUser = true
        streamJob?.cancel()
        streamJob = null
        val i = messages.indexOfLast { it.role == ChatMessage.Role.Assistant }
        if (i >= 0) {
            val finalized = messages[i].finalizeIncompleteTools("Stopped by user.").copy(stoppedByUser = true)
            val r = UIStreamReducer(finalized).also { it.finishStreamingParts() }
            messages = messages.toMutableList().also { it[i] = r.message }
        }
        isStreaming = false
        phaseLabel = null
        queued = emptyList()
        currentStreamId?.let { streamId ->
            lastStoppedStreamId = streamId
            scope.launch { if (hasAiAccess) AgentChatApi.abort(token, streamId) }
        }
        scheduleTranscriptSync(250)
    }

    data class TurnOptions(
        val streamId: String,
        val explicitResume: Boolean = false,
        val resumeFrom: Int = 0,
        val continueAfterInterruption: Boolean = false,
        val resumeReason: String? = null,
        val permissionMode: String? = null,
    )

    private sealed class TurnResult {
        data class Completed(val sawTurnComplete: Boolean, val paused: Paused?) : TurnResult()
        data class Failed(val message: String, val definiteRejection: Boolean = false) : TurnResult()
        data object Aborted : TurnResult()
    }

    private data class Paused(val reason: String, val detail: JsonValue?) {
        val autoResumable: Boolean get() = reason == "model-silence" || reason == "tool-execution-timeout"
    }

    private fun startTurn(options: TurnOptions) {
        if (browsingOnly || !hasAiAccess) return
        streamJob?.cancel()
        transportGeneration += 1
        val generation = transportGeneration
        isStreaming = true
        error = null
        turnStartedAt = Instant.now()
        currentStreamId = options.streamId
        streamJob = scope.launch {
            var options = options
            while (isActive && hasAiAccess) {
                val result = runTurn(options, generation)
                if (!hasAiAccess) return@launch
                when (result) {
                    TurnResult.Aborted -> return@launch
                    is TurnResult.Failed -> {
                        finishTurn(result.message, result.definiteRejection)
                        return@launch
                    }
                    is TurnResult.Completed -> {
                        if (isNative) { releaseAcceptedAttachmentCopies(); submissionPending = false; replySubmissionPending = false; pendingSubmission = null; runtimeRecoveryRequired = false; isStreaming = false; phaseLabel = null; reloadFromServer(); return@launch }
                        if (!result.sawTurnComplete && (result.paused == null || result.paused.autoResumable) && autoResumeAttempts < 10) {
                            autoResumeAttempts += 1
                            finalizeOrphans()
                            options = TurnOptions(streamId = newId(), continueAfterInterruption = true)
                            currentStreamId = options.streamId
                            continue
                        }
                        if (!result.sawTurnComplete && result.paused != null) {
                            finishTurn(describeStall(result.paused))
                            return@launch
                        }
                        finishTurn(null)
                        return@launch
                    }
                }
            }
        }
    }

    private fun finishTurn(message: String?) = finishTurn(message, false)

    private fun finishTurn(message: String?, definiteRejection: Boolean) {
        submissionPending = false
        if (message != null && pendingSubmission != null) {
            if (definiteRejection && !submissionAccepted) {
                rejectedSubmission = pendingSubmission
                retrySubmission = pendingSubmission
                retryUserMessage = pendingUserMessage
                pendingSubmission = null
                runtimeRecoveryRequired = false
            } else {
                rejectedSubmission = null
                runtimeRecoveryRequired = true
            }
            isStreaming = false
            phaseLabel = null
            error = message
            scope.launch { reloadFromServer() }
            return
        }
        if (message == null) releaseAcceptedAttachmentCopies()
        if (isNative) {
            pendingSubmission = null
            if (message != null) runtimeRecoveryRequired = true
            isStreaming = false; phaseLabel = null; error = message
            scope.launch { reloadFromServer() }; return
        }
        finalizeOrphans()
        val i = messages.indexOfLast { it.role == ChatMessage.Role.Assistant }
        if (i >= 0) {
            val r = UIStreamReducer(messages[i]).also { it.finishStreamingParts() }
            messages = messages.toMutableList().also { it[i] = r.message }
        }
        isStreaming = false
        phaseLabel = null
        currentStreamId = null
        if (message != null) {
            error = message
            scheduleTranscriptSync(250)
        } else if (messages.lastOrNull()?.let { it.role == ChatMessage.Role.Assistant && !it.hasRenderableContent } == true) {
            error = "The agent returned an empty reply."
            scheduleTranscriptSync(250)
        }
        if (message == null && bounceClientOnlyTools()) return
        scope.launch {
            if (message == null) reloadFromServer()
            if (message == null && queued.isNotEmpty()) {
                val next = queued.first()
                queued = queued.drop(1)
                dispatch(ChatMessage.user(next), next)
            }
        }
    }

    private fun bounceClientOnlyTools(): Boolean {
        val i = messages.indexOfLast { it.role == ChatMessage.Role.Assistant }
        if (isNative || !permissions.writable || i < 0) return false
        var bounced = false
        val parts = messages[i].parts.toMutableList()
        for (pi in parts.indices) {
            val t = parts[pi] as? ChatPart.Tool ?: continue
            if (t.isClientOnlyTool && t.state == ChatPart.Tool.State.InputAvailable &&
                (t.approval == null || t.approval.approved == true)
            ) {
                parts[pi] = t.copy(
                    state = ChatPart.Tool.State.OutputAvailable,
                    output = JsonValue.obj("ok" to JsonValue.Bool(false), "error" to JsonValue.Str("Local tools are not available in the Nuphos Android app.")),
                    completedAt = Instant.now().toEpochMilli().toDouble(),
                )
                bounced = true
            }
        }
        if (!bounced) return false
        messages = messages.toMutableList().also { it[i] = messages[i].copy(parts = parts) }
        startTurn(TurnOptions(streamId = newId(), resumeReason = "client-tool"))
        return true
    }

    private fun refreshMetadata(detail: AgentConversationDetail, observedAt: Double) {
        isArchived = detail.archivedAt != null
        readOnly = browsingOnly || (detail.readOnly ?: false)
        isOwner = detail.isOwner ?: false
        canCancelRun = detail.canCancelRun ?: false
        canRespondToRun = detail.canRespondToRun ?: false
        serverMetadataObserved = true
        agentRuntime = detail.agentRuntime
        runtimeDeviceLabel = detail.runtimeLabel?.takeIf { it.isNotBlank() }
        detail.runtimeState?.let { receiveRuntime(it, observedAt) }
        detail.title?.takeIf { it.isNotEmpty() }?.let { title = it }
        if (isNative && !steeringUnconfirmed && !steeringRetryRequired && queued.isNotEmpty()) submitSteering()
    }

    private fun receiveRuntime(snapshot: JsonValue, observedAt: Double) {
        val next = RuntimeObservation(snapshot, observedAt)
        if (runtimeObservation?.accepts(next) != false) {
            runtimeObservation = next
            val now = RuntimeObservation.now()
            if (next.allows("reply", now)) {
                val waitKey = runtimeWaitKey(next)
                val priorWaits = repliedWaitKey?.split("|").orEmpty().toSet()
                val differentWait = waitKey != null && priorWaits.isNotEmpty() && waitKey.split("|").none { it in priorWaits }
                if (!replySubmissionPending || differentWait) {
                    submissionPending = false
                    replySubmissionPending = false
                }
            } else if (next.fresh(now) && snapshot["schemaVersion"]?.numberValue == 2.0 &&
                snapshot["actions"]?.get("reply")?.boolValue == false && replySubmissionPending
            ) {
                submissionPending = false
                replySubmissionPending = false
            }
            if (snapshot["actions"]?.get("cancel")?.boolValue == false) cancelRequested = false
        }
        observationClock = RuntimeObservation.now()
    }

    private fun runtimeWaitKey(observation: RuntimeObservation?): String? {
        val waits = observation?.snapshot?.get("requests")?.arrayValue?.mapNotNull { it["waitId"]?.stringValue }?.sorted().orEmpty()
        return waits.takeIf { it.isNotEmpty() }?.joinToString("|")
    }

    private fun lockRuntimeReply(toolCallId: String? = null) {
        replySubmissionPending = true
        val matched = runtimeObservation?.snapshot?.get("requests")?.arrayValue?.firstOrNull {
            toolCallId != null && (it["ref"]?.stringValue == toolCallId || it["waitId"]?.stringValue == toolCallId)
        }
        repliedWaitKey = matched?.get("waitId")?.stringValue ?: runtimeWaitKey(runtimeObservation)
    }

    private fun submitSteering() {
        if (!canSteer || steeringRetryRequired || queued.isEmpty()) return
        val text = queued.first()
        val assistantId = messages.lastOrNull { it.role == ChatMessage.Role.Assistant }?.id
        val generation = transportGeneration
        val pending = PendingSteering(text, assistantId, steeringReceiptIds())
        steeringPending = true
        scope.launch {
            try {
                if (!permissions.reply || runtimeObservation?.allows("steer", RuntimeObservation.now()) != true || steeringUnconfirmed) return@launch
                val id = steerRuntime(token, teamId, sessionId, text)
                if (!hasAiAccess) return@launch
                if (queued.firstOrNull() == text) queued = queued.drop(1)
                addSteering(id, text, assistantId)
            } catch (e: Exception) {
                if (!hasAiAccess) return@launch
                if (RuntimeApi.definitelyRejected(e)) {
                    steeringRetryRequired = true
                    error = e.message ?: "Steering was rejected. Retry when the runtime permits it."
                } else {
                    steeringHold = pending
                    error = "Steering delivery is unconfirmed. Check the conversation before retrying."
                    reconcileSteeringReceipts()
                }
            } finally {
                steeringPending = false
            }
            if (generation == transportGeneration && error == null) submitSteering()
        }
    }

    fun retryQueued(): Boolean {
        if (!steeringRetryRequired || !canSteer || queued.isEmpty()) return false
        steeringRetryRequired = false
        error = null
        submitSteering()
        return true
    }

    fun recoverRuntime(): Boolean {
        if (browsingOnly || !hasAiAccess) return false
        val streamId = currentStreamId ?: return false
        if (!runtimeRecoveryRequired || isStreaming || !loaded || loadError != null) return false
        startTurn(TurnOptions(streamId, explicitResume = true, resumeFrom = streamCursors[streamId] ?: 0))
        return true
    }

    private fun followOptions(active: String?): TurnOptions? {
        if (active == null || active == lastStoppedStreamId || (isStreaming && active == currentStreamId)) return null
        return TurnOptions(active, explicitResume = true, resumeFrom = if (isNative || runtimeRecoveryRequired) streamCursors[active] ?: 0 else 0)
    }

    private fun addSteering(id: String, text: String, assistantId: String?) {
        messages = RuntimeTranscript.steering(id, text, assistantId, messages)
        reconcileSteeringReceipts()
    }

    private fun steeringReceiptIds(): Set<String> = messages.flatMap { it.parts }.filterIsInstance<ChatPart.Data>()
        .filter { it.name == "steering" }.mapNotNull { it.data["id"]?.stringValue }.toSet()

    private fun reconcileSteeringReceipts() {
        val pending = steeringHold ?: return
        val confirmed = messages.firstOrNull { it.id == pending.assistantId }?.parts?.filterIsInstance<ChatPart.Data>()?.any {
            it.name == "steering" && it.data["text"]?.stringValue == pending.text &&
                it.data["id"]?.stringValue?.let { id -> id !in pending.existingIds } == true
        } == true
        if (!confirmed) return
        if (queued.firstOrNull() == pending.text) queued = queued.drop(1)
        steeringHold = null
        if (error?.startsWith("Steering delivery is unconfirmed.") == true) error = null
    }

    private fun adoptMessages(server: List<ChatMessage>, serverBase: Int) {
        if (server.isEmpty()) return
        val old = messages
        val oldBase = baseIndex
        messages = server.mapIndexed { index, message ->
            val matched = old.firstOrNull { it.id == message.id } ?: run {
                val localIndex = serverBase + index - oldBase
                val local = old.getOrNull(localIndex)
                val serverUser = server.take(index).lastOrNull { it.role == ChatMessage.Role.User }
                val localUser = old.take(maxOf(0, localIndex)).lastOrNull { it.role == ChatMessage.Role.User }
                local?.takeIf { message.role == ChatMessage.Role.Assistant && it.role == message.role && serverUser != null && serverUser.id == localUser?.id }
            }
            steeringHold?.takeIf { it.assistantId == matched?.id && matched?.role == ChatMessage.Role.Assistant }?.let { pending ->
                steeringHold = pending.copy(assistantId = message.id)
            }
            if (matched != null) streamAssistantIds.entries.filter { it.value == matched.id }.forEach { it.setValue(message.id) }
            val receipts = matched?.parts?.filter { it is ChatPart.Data && it.name == "steering" }.orEmpty()
            message.copy(parts = message.parts + receipts.filter { receipt ->
                receipt as ChatPart.Data
                message.parts.none { it is ChatPart.Data && it.name == "steering" && it.data["id"] == receipt.data["id"] }
            })
        }
        baseIndex = serverBase
        reconcileSteeringReceipts()
    }

    private fun reconcileAdmission(detail: AgentConversationDetail) {
        if (!runtimeRecoveryRequired) return
        val userId = pendingUserMessage?.id ?: return
        val index = detail.messages.indexOfFirst { it.id == userId && it.role == ChatMessage.Role.User }
        val canonicalReply = index >= 0 && detail.messages.drop(index + 1).takeWhile { it.role != ChatMessage.Role.User }.any { it.role == ChatMessage.Role.Assistant && it.hasRenderableContent }
        val idle = detail.activeRun == null && (!isNative || detail.runtimeState?.get("actions")?.get("send")?.boolValue == true)
        if (canonicalReply && idle) {
            submissionAccepted = true
            releaseAcceptedAttachmentCopies()
            pendingSubmission = null
            runtimeRecoveryRequired = false
        }
    }

    suspend fun reloadFromServer() {
        if (!hasAiAccess) return
        if (browsingOnly) {
            load()
            return
        }
        delay(400)
        if (!hasAiAccess || (isStreaming && !isNative)) return
        val generation = transportGeneration
        val observedAt = RuntimeObservation.now()
        val detail = runCatching { readDetail(token, teamId, sessionId) }.getOrNull()
        if (generation != transportGeneration || !hasAiAccess) return
        if (detail == null) { recallRows = emptySet(); return }
        refreshMetadata(detail, observedAt)
        reconcileAdmission(detail)
        if (isStreaming) { recallRows = emptySet(); readTranscript = null; return }
        val serverTotal = (detail.messagesFirstIndex ?: 0) + detail.messages.size
        if (isNative || serverTotal >= baseIndex + messages.size) adoptMessages(detail.messages, detail.messagesFirstIndex ?: 0)
        recordReadTranscript(detail)
        lastSyncedSignature = signature()
    }

    suspend fun pollWhileIdle() {
        if (browsingOnly || !hasAiAccess) return
        while (coroutineContext.isActive && hasAiAccess) {
            delay(3_000)
            if (!hasAiAccess) return
            observationClock = RuntimeObservation.now()
            if (!loaded || loadError != null || (!isNative && isStreaming)) continue
            val generation = transportGeneration
            val observedAt = RuntimeObservation.now()
            val detail = runCatching { readDetail(token, teamId, sessionId) }.getOrNull()
            if (generation != transportGeneration || !hasAiAccess) continue
            if (detail == null) { recallRows = emptySet(); continue }
            refreshMetadata(detail, observedAt)
            reconcileAdmission(detail)
            val run = detail.activeRun
            val follow = followOptions(run?.streamId)
            if (follow != null) {
                recallRows = emptySet()
                readTranscript = null
                if (isNative) adoptMessages(detail.messages, detail.messagesFirstIndex ?: 0)
                else {
                    val lastUser = detail.messages.indexOfLast { it.role == ChatMessage.Role.User }
                    messages = if (lastUser >= 0) detail.messages.take(lastUser + 1) else detail.messages
                    baseIndex = detail.messagesFirstIndex ?: 0
                }
                startTurn(follow)
                continue
            }
            if (!isStreaming && (isNative || (detail.messagesFirstIndex ?: 0) + detail.messages.size > baseIndex + messages.size)) {
                adoptMessages(detail.messages, detail.messagesFirstIndex ?: 0)
                recordReadTranscript(detail)
                lastSyncedSignature = signature()
            } else if (!isStreaming && messages == detail.messages) {
                recordReadTranscript(detail)
            } else {
                recallRows = emptySet()
                readTranscript = null
            }
        }
    }

    private fun resumeAssistantIndex(streamId: String, cursor: Int): Int? {
        if (!isNative || cursor <= 0) return null
        val id = streamAssistantIds[streamId] ?: return null
        return messages.indexOfFirst { it.id == id && it.role == ChatMessage.Role.Assistant }.takeIf { it >= 0 }
    }

    private suspend fun runTurn(options: TurnOptions, generation: Int): TurnResult {
        val cursor = RuntimeFrameCursor(options.resumeFrom)
        var resumeFrom = options.resumeFrom
        var reconnects = 0
        var freshRetries = 0
        var idleTimeouts = 0
        var gatewayRetries = 0
        var forceFresh = false
        var usedFreshFallback = false
        var accepted = false
        var sendFullTranscript = false
        var rebaseTo: Int? = null
        var toolExecutionMayHaveStarted = false
        var sawTurnComplete = false
        var paused: Paused? = null
        var lastErrorText: String? = null
        var assistantIndex: Int? = resumeAssistantIndex(options.streamId, options.resumeFrom)
        var reducer: UIStreamReducer? = assistantIndex?.let { UIStreamReducer(messages[it]) }

        while (coroutineContext.isActive && hasAiAccess) {
            val shouldResume = !forceFresh && (options.explicitResume || reconnects > 0 || resumeFrom > 0 || (isNative && accepted))
            forceFresh = false
            val window = transcriptWindow(full = sendFullTranscript, rebase = rebaseTo)
            val firstPost = resumeFrom == 0 && !accepted
            val body = AgentChatApi.ChatRequest(
                id = sessionId,
                teamId = teamId,
                messages = window.messages.map { it.forWire },
                baseIndex = window.baseIndex.takeIf { it > 0 },
                streamId = options.streamId,
                resume = shouldResume,
                resumeFrom = resumeFrom,
                continueAfterInterruption = if (options.continueAfterInterruption && firstPost) true else null,
                resumeReason = if (firstPost) options.resumeReason else null,
                permissionMode = options.permissionMode,
                credentialAccess = credentialAccess?.json,
                clientCapabilities = mapOf("localTools" to false),
                runtimeId = if (shouldResume == true) null else outgoingCreationBinding?.runtimeId,
                agentRuntime = if (shouldResume == true) null else outgoingCreationBinding?.agentRuntime,
            )
            var needsFreshRetry = false
            var terminal = false
            var streamError: Throwable? = null
            try {
                if (!hasAiAccess) return TurnResult.Aborted
                val request = AgentChatApi.chatRequest(token, body)
                SseClient.events(request)
                    .catch { e -> streamError = e }
                    .collect { event ->
                        if (generation != transportGeneration || !hasAiAccess) return@collect
                        if (event.data == "[DONE]") return@collect
                        val frame = JsonValue.parse(event.data) ?: return@collect
                        resumeFrom = cursor.decoded(frame)
                        streamCursors[options.streamId] = resumeFrom
                        if (pendingSubmission != null) submissionAccepted = true
                        val type = frame["type"]?.stringValue ?: return@collect
                        accepted = true
                        if (type == "error") {
                            val code = frame["errorCode"]?.stringValue
                            if (code == "stream_unresumable" && sawTurnComplete) return@collect
                            lastErrorText = frame["errorText"]?.stringValue ?: "The agent hit an error."
                            needsFreshRetry = true
                            return@collect
                        }
                        reconnects = 0
                        idleTimeouts = 0
                        if (type == "atlas-stream-done") {
                            if (!needsFreshRetry) terminal = true
                            throw Terminal()
                        }
                        if (type in setOf("tool-input-available", "tool-output-available", "tool-output-error", "tool-approval-request")) {
                            toolExecutionMayHaveStarted = true
                        }
                        if (type == "atlas-turn-complete") sawTurnComplete = true
                        if (type == "atlas-turn-paused") {
                            paused = Paused(frame["reason"]?.stringValue ?: "other", frame["detail"])
                        }
                        autoResumeAttempts = 0
                        handle(frame, type, assistantIndex, reducer).also {
                            assistantIndex = it.first
                            reducer = it.second
                            assistantIndex?.let { index -> messages.getOrNull(index)?.id?.let { id -> streamAssistantIds[options.streamId] = id } }
                        }
                    }
            } catch (_: Terminal) {
                // ended by atlas-stream-done
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                streamError = e
            }
            val err = streamError
            if (err is CancellationException) return TurnResult.Aborted
            if (err is SseClient.Failure.BadStatus) {
                if (pendingSubmission != null && !accepted && err.code >= 500) return TurnResult.Failed("Message delivery is unconfirmed. Resume the original connection.")
                val conflict = AgentChatApi.conflict(err.code, err.body)
                when {
                    !isNative && pendingSubmission == null && conflict is AgentChatApi.Conflict.StreamNotResumable && shouldResume && resumeFrom == 0 && !options.explicitResume && !usedFreshFallback -> {
                        usedFreshFallback = true
                        forceFresh = true
                        continue
                    }
                    conflict is AgentChatApi.Conflict.TranscriptOutOfSync && !sendFullTranscript -> {
                        if (conflict.storedMessageCount != null && rebaseTo == null) rebaseTo = conflict.storedMessageCount else sendFullTranscript = true
                        continue
                    }
                    conflict is AgentChatApi.Conflict.Other && reconnects == 0 && err.code in GATEWAY && gatewayRetries < 3 -> {
                        gatewayRetries += 1
                        delay(backoff(gatewayRetries, 0.7, 5.0).toLong())
                        if (!isNative && !options.explicitResume) {
                            forceFresh = true
                            resumeFrom = 0
                            cursor.reset()
                        }
                        continue
                    }
                    else -> return TurnResult.Failed(conflict.message ?: conflict.toString(), RuntimeApi.definitelyRejected(conflict) && !accepted && !shouldResume)
                }
            }
            if (err is SseClient.Failure.IdleTimeout) {
                if (pendingSubmission != null && !accepted && resumeFrom == 0) return TurnResult.Failed("Message delivery is unconfirmed. Resume the original connection.")
                idleTimeouts += 1
                if (idleTimeouts > 3) return TurnResult.Failed("The connection kept going quiet; please try again.")
                reconnects = 0
                continue
            }
            if (err != null && err !is Terminal) {
                reconnects += 1
                phaseLabel = "Reconnecting…"
                if (reconnects > 20) return TurnResult.Failed(err.message ?: "Lost the connection to Nuphos.")
                delay(backoff(reconnects, 0.5, 5.0).toLong())
                continue
            }
            if (!coroutineContext.isActive) return TurnResult.Aborted
            if (needsFreshRetry) {
                if (isNative || options.explicitResume || toolExecutionMayHaveStarted) {
                    return TurnResult.Failed(lastErrorText ?: "The agent hit an error.")
                }
                freshRetries += 1
                if (freshRetries > 3) return TurnResult.Failed(lastErrorText ?: "The agent hit an error.")
                assistantIndex?.let { i ->
                    if (i in messages.indices) messages = messages.toMutableList().also { it.removeAt(i) }
                }
                assistantIndex = null
                reducer = null
                forceFresh = true
                resumeFrom = 0
                cursor.reset()
                delay(backoff(freshRetries, 0.6, 4.0).toLong())
                continue
            }
            if (terminal || sawTurnComplete) return TurnResult.Completed(sawTurnComplete, paused)
            reconnects += 1
            phaseLabel = "Reconnecting…"
            if (reconnects > 20) return TurnResult.Failed("Lost the connection to Nuphos.")
            delay(backoff(reconnects, 0.5, 5.0).toLong())
        }
        return TurnResult.Aborted
    }

    private class Terminal : Exception()

    private fun handle(
        frame: JsonValue,
        type: String,
        assistantIndex: Int?,
        reducer: UIStreamReducer?,
    ): Pair<Int?, UIStreamReducer?> {
        if (pendingSubmission != null) submissionAccepted = true
        var idx = assistantIndex
        var red = reducer
        when (type) {
            "runtime-state" -> {
                if (agentRuntime != "nuphos" && frame["snapshot"] != null) nativeAdmissionObserved = true
                frame["snapshot"]?.let { receiveRuntime(it, RuntimeObservation.frameObservedAt(RuntimeObservation.now(), System.currentTimeMillis().toDouble(), frame["emittedAt"]?.numberValue)) }
                return idx to red
            }
            "atlas-transcript-snapshot" -> {
                val snapshot = decodeMessages(frame["messages"])
                adoptMessages(snapshot, 0)
                return null to null
            }
            "atlas-turn-start" -> {
                messages = RuntimeTranscript.userTurn(decodeMessages(frame["messages"]), messages)
                return null to null
            }
            "data-steering" -> {
                val data = frame["data"]
                val id = data?.get("id")?.stringValue
                if (id != null) addSteering(id, data["text"]?.stringValue.orEmpty(), idx?.let { messages.getOrNull(it)?.id })
                if (red != null && idx != null) messages.getOrNull(idx)?.let { red.message = it }
                return idx to red
            }
            "phase" -> {
                phaseLabel = phaseLabel(frame["phase"]?.stringValue)
                return idx to red
            }
            "atlas-turn-complete", "atlas-turn-paused" -> {
                if (type == "atlas-turn-complete") releaseAcceptedAttachmentCopies()
                submissionPending = false
                replySubmissionPending = false
                pendingSubmission = null
                runtimeRecoveryRequired = false
                phaseLabel = null
                return idx to red
            }
            "atlas-autonomous-turn-start" -> {
                val id = frame["messageId"]?.stringValue ?: return idx to red
                messages = RuntimeTranscript.autonomous(id, messages)
                idx = messages.indexOfFirst { it.id == id }
                red = UIStreamReducer(messages[idx])
                return idx to red
            }
            "authorization-decision" -> {
                val callId = frame["toolCallId"]?.stringValue ?: return idx to red
                val found = findTool(callId) ?: return idx to red
                replaceTool(found.first, found.second, found.third.copy(authorization = frame))
                return idx to red
            }
            "memory-ingest" -> {
                applyMemoryIngest(frame, idx)
                return idx to red
            }
            "memory-provenance" -> {
                val result = applyMemoryProvenance(frame, idx, red)
                return result
            }
        }
        if (type == "start") {
            val messageId = frame["messageId"]?.stringValue
            val existing = messages.indexOfFirst { it.id == messageId && it.role == ChatMessage.Role.Assistant }
            if (existing >= 0) { idx = existing; red = UIStreamReducer(messages[existing]) }
        }
        if (idx == null) {
            val m = ChatMessage(role = ChatMessage.Role.Assistant, parts = emptyList())
            messages = messages + m
            idx = messages.lastIndex
            red = UIStreamReducer(m)
        }
        val i = idx ?: return idx to red
        if (i !in messages.indices) return idx to red
        if (red == null) red = UIStreamReducer(messages[i])
        if (type == "start") phaseLabel = phaseLabel ?: "Thinking…"
        if (type in setOf("text-delta", "reasoning-delta", "tool-input-start")) phaseLabel = null
        if (type in setOf("tool-output-available", "tool-output-denied")) phaseLabel = null
        val outcome = red.apply(frame)
        val updated = red.message.copy(createdAt = messages[i].createdAt ?: Instant.now(), turnOrigin = messages[i].turnOrigin)
        messages = messages.toMutableList().also { it[i] = updated }
        if (outcome == UIStreamReducer.Outcome.Error) error = red.errorText
        return idx to red
    }

    private fun decodeMessages(value: JsonValue?): List<ChatMessage> = value?.arrayValue?.mapNotNull {
        runCatching { Http.json.decodeFromString(ChatMessage.serializer(), Http.json.encodeToString(JsonValue.serializer(), it)) }.getOrNull()
    }.orEmpty()

    private fun applyMemoryProvenance(frame: JsonValue, assistantIndex: Int?, reducer: UIStreamReducer?): Pair<Int?, UIStreamReducer?> {
        val recalled = (frame["recalledPersonalIds"]?.arrayValue?.size ?: 0) + (frame["recalledTeamIds"]?.arrayValue?.size ?: 0)
        val fetched = frame["fetchedIds"]?.arrayValue?.size ?: 0
        var idx = assistantIndex
        var red = reducer
        if (idx == null) {
            val m = ChatMessage(role = ChatMessage.Role.Assistant, parts = emptyList())
            messages = messages + m
            idx = messages.lastIndex
            red = UIStreamReducer(m)
        }
        val i = idx ?: return idx to red
        val key = "${frame["sessionId"]?.stringValue.orEmpty()}/${frame["turnKey"]?.stringValue.orEmpty()}"
        val parts = messages[i].parts.filter { part ->
            if (part is ChatPart.Other && part.value["type"]?.stringValue == "memory-provenance") {
                val k = "${part.value["sessionId"]?.stringValue.orEmpty()}/${part.value["turnKey"]?.stringValue.orEmpty()}"
                k != key
            } else true
        }.toMutableList()
        if (recalled + fetched > 0) parts.add(0, ChatPart.Other(frame))
        messages = messages.toMutableList().also { it[i] = messages[i].copy(parts = parts) }
        if (red != null) red.message = red.message.copy(parts = parts)
        return idx to red
    }

    private fun applyMemoryIngest(frame: JsonValue, assistantIndex: Int?) {
        val i = assistantIndex ?: messages.indexOfLast { it.role == ChatMessage.Role.Assistant }
        if (i < 0) return
        val eventId = frame["eventId"]?.stringValue ?: UUID.randomUUID().toString()
        val created = frame["memoriesCreated"]?.numberValue ?: 0.0
        val updatedCount = frame["memoriesUpdated"]?.numberValue ?: 0.0
        val ok = frame["status"]?.stringValue == "ok" && frame["jobStatus"]?.stringValue == "succeeded" && created + updatedCount > 0
        val parts = messages[i].parts.filterNot {
            it is ChatPart.Other && it.value["type"]?.stringValue == "memory-ingest" && it.value["eventId"]?.stringValue == eventId
        }.toMutableList()
        if (ok) parts += ChatPart.Other(frame)
        messages = messages.toMutableList().also { it[i] = messages[i].copy(parts = parts) }
    }

    private data class Window(val messages: List<ChatMessage>, val baseIndex: Int)

    private fun transcriptWindow(full: Boolean, rebase: Int?): Window {
        val base = rebase ?: baseIndex
        if (full) return Window(messages, base)
        val lastUser = messages.indexOfLast { it.role == ChatMessage.Role.User }
        if (lastUser <= 0) return Window(messages, base)
        return Window(messages.drop(lastUser), base + lastUser)
    }

    private fun signature(): Int {
        var h = sessionId.hashCode()
        h = 31 * h + title.hashCode()
        h = 31 * h + baseIndex
        for (m in messages) {
            h = 31 * h + m.id.hashCode()
            h = 31 * h + m.role.hashCode()
            h = 31 * h + m.wireParts.joinToString { it.json.compact }.hashCode()
        }
        return h
    }

    private fun scheduleTranscriptSync(afterMs: Long) {
        transcriptSyncJob?.cancel()
        transcriptSyncJob = scope.launch {
            delay(afterMs)
            syncTranscriptNow()
        }
    }

    suspend fun syncTranscriptNow() {
        if (!canManage || isNative || serverOwnedTranscript || messages.isEmpty()) return
        val sig = signature()
        if (sig == lastSyncedSignature) return
        val wire = messages.map { it.forWire }
        try {
            val skipped = AgentChatApi.putTranscript(token, teamId, sessionId, title, wire, if (transcriptFullResend) null else (transcriptRebasedTo ?: baseIndex))
            if (skipped in setOf("server_authoritative", "slack_bound")) serverOwnedTranscript = true
            lastSyncedSignature = sig
        } catch (e: AgentChatApi.Conflict.TranscriptOutOfSync) {
            if (e.storedMessageCount != null && transcriptRebasedTo == null && !transcriptFullResend) {
                transcriptRebasedTo = e.storedMessageCount
            } else {
                transcriptFullResend = true
            }
            if (!hasAiAccess) return
            runCatching {
                AgentChatApi.putTranscript(token, teamId, sessionId, title, wire, if (transcriptFullResend) null else transcriptRebasedTo)
            }.onSuccess { lastSyncedSignature = sig }
        } catch (e: Exception) {
            Log.d(TAG, "transcript sync failed: $e")
        }
    }

    private fun findTool(callId: String): Triple<Int, Int, ChatPart.Tool>? {
        for (mi in messages.indices.reversed()) {
            for (pi in messages[mi].parts.indices) {
                val t = messages[mi].parts[pi] as? ChatPart.Tool
                if (t?.toolCallId == callId) return Triple(mi, pi, t)
            }
        }
        return null
    }

    private fun replaceTool(mi: Int, pi: Int, part: ChatPart.Tool) {
        val parts = messages[mi].parts.toMutableList()
        parts[pi] = part
        messages = messages.toMutableList().also { it[mi] = messages[mi].copy(parts = parts) }
    }

    private fun finalizeOrphans() {
        val i = messages.indexOfLast { it.role == ChatMessage.Role.Assistant }
        if (i >= 0) messages = messages.toMutableList().also { it[i] = messages[i].finalizeIncompleteTools() }
    }

    /** Revoke local work and unsent copies without cancelling the server run. */
    fun disposeForConsent() {
        recallRows = emptySet()
        readTranscript = null
        readGeneration++
        detailLoadGeneration++
        consentDisposed = true
        transportGeneration += 1
        uploadGeneration += 1
        scope.cancel()
        retainedTransfer?.let { transfers.cancel(it) }
        val unsent = listOfNotNull(uploadDraft, rejectedSubmission, retrySubmission) +
            listOfNotNull(pendingSubmission.takeIf { !submissionAccepted })
        unsent.flatMap { it.attachments }.distinctBy { it.id }.forEach { it.releaseOwnedCopy() }
        if (!submissionAccepted) preparedTransfer?.payloads?.forEach { it.source?.release() }
        uploadDraft = null
        rejectedSubmission = null
        pendingSubmission = null
        pendingUserMessage = null
        retrySubmission = null
        retryUserMessage = null
        retainedTransfer = null
        preparedTransfer = null
        queued = emptyList()
        sendAfterLoad = null
        uploadBusy = false
        uploadProgress = null
        uploadError = null
        isStreaming = false
        phaseLabel = null
        submissionPending = false
        replySubmissionPending = false
        steeringPending = false
        steeringHold = null
        credentialAccess = null
    }

    /** Release this view's local jobs without cancelling the server run. */
    fun disposeBrowsing() {
        if (browsingOnly) {
            recallRows = emptySet()
            detailLoadGeneration++
            transportGeneration++
            scope.cancel()
        }
    }

    private fun newId() = UUID.randomUUID().toString().lowercase()

    private fun backoff(attempt: Int, base: Double, cap: Double): Double =
        min(cap, base * 2.0.pow(maxOf(0, attempt - 1).toDouble())) * 1000

    private fun describeStall(paused: Paused) = when (paused.reason) {
        "model-silence" -> "The model stopped responding. Send a message to continue."
        "tool-execution-timeout" -> "A tool ran for too long and was stopped."
        "output-budget" -> "The reply hit its length limit."
        "turn-deadline" -> "The reply hit its time limit."
        "content-filter" -> "The reply was blocked by a content filter."
        "shutdown" -> "The server restarted mid-reply. Send a message to continue."
        else -> "The reply was interrupted."
    }

    companion object {
        private const val TAG = "nuphos.chat"
        private val GATEWAY = setOf(502, 503, 504, 520, 521, 522, 523, 524)

        fun fresh(token: String, teamId: String, binding: ai.nuphos.android.data.RuntimeBinding? = null) = ChatSession(token, teamId, creationRuntimeBinding = binding).also { it.loaded = true }

        fun phaseLabel(phase: String?): String? = when (phase) {
            "request-accepted" -> "Starting…"
            "saving-turn" -> "Saving…"
            "building-context" -> "Building context…"
            "loading-credentials" -> "Loading credentials…"
            "preparing-tools" -> "Preparing tools…"
            "building-prompt" -> "Building prompt…"
            "recalling-memory" -> "Recalling memory…"
            "loading-compaction" -> "Loading history…"
            "preparing-model" -> "Preparing model…"
            "connecting-model" -> "Connecting…"
            "thinking" -> "Thinking…"
            else -> null
        }
    }
}

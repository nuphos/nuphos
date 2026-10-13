package ai.nuphos.android.session

import androidx.compose.runtime.MutableState
import ai.nuphos.android.data.JsonValue
import ai.nuphos.android.model.AgentConversationDetail
import ai.nuphos.android.model.ChatMessage
import ai.nuphos.android.model.ChatPart
import ai.nuphos.android.model.ComposerSubmission
import ai.nuphos.android.data.AgentChatApi
import java.time.Instant
import org.junit.Assert.*
import org.junit.Test
import org.junit.Before
import org.junit.After
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.CompletableDeferred

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class RuntimeSessionRegressionTest {
    @Before fun setup() { Dispatchers.setMain(UnconfinedTestDispatcher()); AiAccess.activate("fixture"); AiAccess.grant("fixture") }
    @After fun cleanup() { AiAccess.revoke(); Dispatchers.resetMain() }
    @Suppress("UNCHECKED_CAST")
    private fun state(session: ChatSession, name: String, value: Any?) {
        val field = ChatSession::class.java.getDeclaredField(name + "\$delegate").apply { isAccessible = true }
        (field.get(session) as MutableState<Any?>).value = value
    }
    private fun metadata(session: ChatSession, detail: AgentConversationDetail, time: Double = RuntimeObservation.now()) {
        ChatSession::class.java.getDeclaredMethod("refreshMetadata", AgentConversationDetail::class.java, Double::class.javaPrimitiveType).apply { isAccessible = true }.invoke(session, detail, time)
    }
    @Test fun directActionsExpireEvenWithoutPollTick() {
        val session = ChatSession.fresh("fixture", "team")
        val old = RuntimeObservation.now() - 20
        metadata(session, AgentConversationDetail(agentRuntime = "openab", isOwner = true, canRespondToRun = true,
            runtimeState = JsonValue.parse("""{"schemaVersion":2,"actions":{"reply":true,"send":true,"steer":true,"cancel":true}}""")), old)
        state(session, "observationClock", old)
        assertFalse(session.canReply)
        assertFalse(session.canSubmit)
        assertFalse(session.canCancel)
    }
    @Test fun failedSteeringCannotDrainOnNextSubmit() {
        val session = ChatSession.fresh("fixture", "team")
        metadata(session, AgentConversationDetail(agentRuntime = "openab", canRespondToRun = true,
            runtimeState = JsonValue.parse("""{"schemaVersion":2,"actions":{"reply":false,"send":false,"steer":true,"cancel":true}}""")))
        state(session, "queued", listOf("delivery uncertain"))
        state(session, "error", "Steering delivery is unconfirmed. Check the conversation before retrying.")
        assertFalse(session.canSteer)
        assertFalse(session.canSubmit)
    }
    @Test fun ambiguousSteeringRequiresNewReceiptOnOriginalAssistant() {
        val session = ChatSession.fresh("fixture", "team")
        val receipt = ChatPart.Data("steering", data = JsonValue.parse("""{"id":"old","text":"pending"}""")!!)
        state(session, "messages", listOf(ChatMessage(id = "a", role = ChatMessage.Role.Assistant, parts = listOf(receipt)), ChatMessage(id = "b", role = ChatMessage.Role.Assistant, parts = emptyList())))
        state(session, "queued", listOf("pending", "next"))
        state(session, "error", "Steering delivery is unconfirmed. Check the conversation before retrying.")
        val pendingType = Class.forName("ai.nuphos.android.session.ChatSession\$PendingSteering")
        val pending = pendingType.declaredConstructors.first().apply { isAccessible = true }.newInstance("pending", "a", setOf("old"))
        state(session, "steeringHold", pending)
        val add = ChatSession::class.java.getDeclaredMethod("addSteering", String::class.java, String::class.java, String::class.java).apply { isAccessible = true }
        add.invoke(session, "old", "pending", "a")
        assertEquals(listOf("pending", "next"), session.queued)
        add.invoke(session, "wrong-turn", "pending", "b")
        assertEquals(listOf("pending", "next"), session.queued)
        add.invoke(session, "new", "pending", "a")
        assertEquals(listOf("next"), session.queued)
        assertNull(session.error)
    }
    @Test fun definitiveNativeFrameChangesFreshSessionRoute() {
        val session = ChatSession.fresh("fixture", "team")
        val method = ChatSession::class.java.getDeclaredMethod("handle", JsonValue::class.java, String::class.java, Integer::class.java, UIStreamReducer::class.java).apply { isAccessible = true }
        method.invoke(session, JsonValue.parse("""{"type":"runtime-state","snapshot":{"schemaVersion":2,"actions":{"send":false}}}""")!!, "runtime-state", null, null)
        assertTrue(session.isNative)
        assertTrue(session.messages.isEmpty())
    }
    @Test fun steeringInFlightStillAcceptsAndRemovesUnsentTail() {
        val session = ChatSession.fresh("fixture", "team")
        metadata(session, AgentConversationDetail(agentRuntime = "openab", canRespondToRun = true,
            runtimeState = JsonValue.parse("""{"schemaVersion":2,"actions":{"reply":false,"send":false,"steer":true}}""")))
        state(session, "steeringPending", true)
        state(session, "queued", listOf("first", "second"))
        assertTrue(session.canSubmit)
        session.removeQueued(1)
        assertEquals(listOf("first"), session.queued)
        session.removeQueued(0)
        assertEquals(listOf("first"), session.queued)
    }
    @Test fun deferredSteeringAckDrainsTwoMessagesExactlyOnce() = runTest {
        Dispatchers.setMain(StandardTestDispatcher(testScheduler))
        val firstAck = CompletableDeferred<String>()
        val secondAck = CompletableDeferred<String>()
        val calls = mutableListOf<String>()
        val session = ChatSession("fixture", "team", steerRuntime = { _, _, _, text ->
            calls += text
            if (text == "first") firstAck.await() else secondAck.await()
        })
        state(session, "loaded", true)
        state(session, "messages", listOf(ChatMessage(id = "a", role = ChatMessage.Role.Assistant, parts = emptyList())))
        metadata(session, AgentConversationDetail(agentRuntime = "openab", canRespondToRun = true,
            runtimeState = JsonValue.parse("""{"schemaVersion":2,"actions":{"reply":false,"send":false,"steer":true}}""")))
        assertTrue(session.send("first"))
        runCurrent()
        assertTrue(session.send("second"))
        assertEquals(listOf("first", "second"), session.queued)
        assertEquals(listOf("first"), calls)
        firstAck.complete("receipt1")
        runCurrent()
        assertEquals(listOf("second"), session.queued)
        assertEquals(listOf("first", "second"), calls)
        secondAck.complete("receipt2")
        runCurrent()
        assertTrue(session.queued.isEmpty())
        assertEquals(listOf("first", "second"), calls)
    }
    @Test fun definiteSteeringRejectionRetainsRemovableUnsentText() {
        val session = ChatSession("fixture", "team", steerRuntime = { _, _, _, _ -> throw AgentChatApi.Conflict.Other("runtime_steering_unavailable", "Unavailable", 409) })
        state(session, "loaded", true)
        metadata(session, AgentConversationDetail(agentRuntime = "openab", canRespondToRun = true,
            runtimeState = JsonValue.parse("""{"schemaVersion":2,"actions":{"reply":false,"send":false,"steer":true}}""")))
        assertTrue(session.send("rejected"))
        assertEquals(listOf("rejected"), session.queued)
        session.removeQueued(0)
        assertTrue(session.queued.isEmpty())
    }
    @Test fun acceptedFrameFailureDoesNotRestoreFreshPrompt() {
        val session = ChatSession.fresh("fixture", "team")
        metadata(session, AgentConversationDetail(agentRuntime = "openab"))
        ChatSession::class.java.getDeclaredField("pendingSubmission").apply { isAccessible = true }.set(session, ComposerSubmission("already accepted"))
        val handle = ChatSession::class.java.getDeclaredMethod("handle", JsonValue::class.java, String::class.java, Integer::class.java, UIStreamReducer::class.java).apply { isAccessible = true }
        handle.invoke(session, JsonValue.parse("""{"type":"start","messageId":"accepted"}""")!!, "start", null, null)
        ChatSession::class.java.getDeclaredMethod("finishTurn", String::class.java).apply { isAccessible = true }.invoke(session, "connection lost")
        assertNull(session.rejectedSubmission)
    }
    @Test fun rejectedSteeringRetriesOnlyOnExplicitIntent() {
        var calls = 0
        val session = ChatSession("fixture", "team", steerRuntime = { _, _, _, _ ->
            calls += 1
            if (calls == 1) throw AgentChatApi.Conflict.Other("runtime_steering_unavailable", "Unavailable", 409)
            "ack"
        })
        state(session, "loaded", true)
        val detail = AgentConversationDetail(agentRuntime = "openab", canRespondToRun = true,
            runtimeState = JsonValue.parse("""{"schemaVersion":2,"actions":{"reply":false,"send":false,"steer":true}}"""))
        metadata(session, detail)
        assertTrue(session.send("first"))
        assertTrue(session.steeringRetryRequired)
        metadata(session, detail)
        assertEquals(1, calls)
        assertTrue(session.retryQueued())
        assertEquals(2, calls)
        assertFalse(session.steeringRetryRequired)
        assertTrue(session.queued.isEmpty())
    }
    @Suppress("UNCHECKED_CAST")
    @Test fun disconnectedFollowUsesOriginalStreamAndItsCursor() {
        val session = ChatSession.fresh("fixture", "team")
        metadata(session, AgentConversationDetail(agentRuntime = "openab"))
        ChatSession::class.java.getDeclaredField("currentStreamId").apply { isAccessible = true }.set(session, "same-stream")
        val cursors = ChatSession::class.java.getDeclaredField("streamCursors").apply { isAccessible = true }.get(session) as MutableMap<String, Int>
        cursors["same-stream"] = 19
        val follow = ChatSession::class.java.getDeclaredMethod("followOptions", String::class.java).apply { isAccessible = true }
        val options = follow.invoke(session, "same-stream") as ChatSession.TurnOptions
        assertEquals("same-stream", options.streamId)
        assertEquals(19, options.resumeFrom)
        assertTrue(options.explicitResume)
        assertEquals(0, (follow.invoke(session, "other-stream") as ChatSession.TurnOptions).resumeFrom)
        state(session, "isStreaming", true)
        assertNull(follow.invoke(session, "same-stream"))
    }
    @Test fun definitiveFreshAdmissionRejectionRetainsPayload() {
        val session = ChatSession.fresh("fixture", "team")
        val submission = ComposerSubmission("rejected before native metadata")
        ChatSession::class.java.getDeclaredField("pendingSubmission").apply { isAccessible = true }.set(session, submission)
        ChatSession::class.java.getDeclaredMethod("finishTurn", String::class.java, Boolean::class.javaPrimitiveType).apply { isAccessible = true }.invoke(session, "runtime_not_accepting_message", true)
        assertEquals(submission, session.rejectedSubmission)
        assertFalse(session.runtimeRecoveryRequired)
    }
    @Suppress("UNCHECKED_CAST")
    @Test fun resumedOutputUsesItsOriginalAssistantInsteadOfNewerTurn() {
        val session = ChatSession.fresh("fixture", "team")
        metadata(session, AgentConversationDetail(agentRuntime = "openab"))
        state(session, "messages", listOf(ChatMessage(id = "original", role = ChatMessage.Role.Assistant, parts = emptyList()), ChatMessage(id = "newer", role = ChatMessage.Role.Assistant, parts = emptyList())))
        val ids = ChatSession::class.java.getDeclaredField("streamAssistantIds").apply { isAccessible = true }.get(session) as MutableMap<String, String>
        ids["original-stream"] = "original"
        val method = ChatSession::class.java.getDeclaredMethod("resumeAssistantIndex", String::class.java, Int::class.javaPrimitiveType).apply { isAccessible = true }
        assertEquals(0, method.invoke(session, "original-stream", 10))
        assertNull(method.invoke(session, "other-stream", 10))
        assertNull(method.invoke(session, "original-stream", 0))
    }
    @Test fun canonicalUserAloneDoesNotProveAdmissionButItsFinishedReplyDoes() {
        val session = ChatSession.fresh("fixture", "team")
        metadata(session, AgentConversationDetail(agentRuntime = "openab"))
        val user = ChatMessage.user("original").copy(id = "logical-user")
        val reply = ChatMessage.user("finished").copy(id = "reply", role = ChatMessage.Role.Assistant)
        ChatSession::class.java.getDeclaredField("pendingUserMessage").apply { isAccessible = true }.set(session, user)
        state(session, "runtimeRecoveryRequired", true)
        val reconcile = ChatSession::class.java.getDeclaredMethod("reconcileAdmission", AgentConversationDetail::class.java).apply { isAccessible = true }
        val snapshot = JsonValue.parse("""{"schemaVersion":2,"actions":{"send":true}}""")!!
        reconcile.invoke(session, AgentConversationDetail(messages = listOf(user), runtimeState = snapshot))
        assertTrue(session.runtimeRecoveryRequired)
        reconcile.invoke(session, AgentConversationDetail(messages = listOf(user.copy(id = "another"), reply), runtimeState = snapshot))
        assertTrue(session.runtimeRecoveryRequired)
        reconcile.invoke(session, AgentConversationDetail(messages = listOf(user, reply), runtimeState = snapshot))
        assertFalse(session.runtimeRecoveryRequired)
    }
    private fun waitingTool() = ChatPart.Tool(
        toolCallId = "call", toolName = "run", isDynamic = false,
        state = ChatPart.Tool.State.ApprovalRequested,
        input = JsonValue.parse("""{"command":"echo fixture"}"""),
        approval = ChatPart.Tool.Approval("openab:wait"),
    )

    private fun waitingSnapshot(revision: Int = 1) = JsonValue.parse("""{
        "schemaVersion":2,"epoch":"fixture","revision":$revision,
        "actions":{"reply":true,"send":false,"steer":false,"cancel":true},
        "requests":[{"waitId":"wait","kind":"agent-permission","ref":"call"}]
    }""")!!

    private fun runtimeFrame(session: ChatSession, snapshot: JsonValue) {
        val frame = JsonValue.obj("type" to JsonValue.Str("runtime-state"), "snapshot" to snapshot,
            "emittedAt" to JsonValue.Number(System.currentTimeMillis().toDouble()))
        ChatSession::class.java.getDeclaredMethod("handle", JsonValue::class.java, String::class.java, Integer::class.java, UIStreamReducer::class.java)
            .apply { isAccessible = true }.invoke(session, frame, "runtime-state", null, null)
    }

    @Test fun nativeToolWaitReleasesAdmissionButKeepsOriginalDeliveryAndLocksDuplicateReply() {
        Dispatchers.setMain(StandardTestDispatcher())
        val session = ChatSession.fresh("fixture", "team")
        metadata(session, AgentConversationDetail(agentRuntime = "openab", canRespondToRun = true))
        state(session, "submissionPending", true)
        val submission = ComposerSubmission("original")
        val pending = ChatSession::class.java.getDeclaredField("pendingSubmission").apply { isAccessible = true }
        pending.set(session, submission)
        state(session, "messages", listOf(ChatMessage(id = "assistant", role = ChatMessage.Role.Assistant, parts = listOf(waitingTool()))))
        runtimeFrame(session, waitingSnapshot())
        assertTrue(session.canReply)
        assertEquals(submission, pending.get(session))
        session.decide("call", ChatSession.ApprovalDecision.Once)
        val responded = session.messages.single().parts.single() as ChatPart.Tool
        assertEquals(ChatPart.Tool.State.ApprovalResponded, responded.state)
        assertFalse(session.canReply)
        runtimeFrame(session, waitingSnapshot())
        assertFalse(session.canReply)
        session.decide("call", ChatSession.ApprovalDecision.Deny)
        assertEquals(responded, session.messages.single().parts.single())
        val additionalWait = JsonValue.Obj(waitingSnapshot(2).objectValue!! + ("requests" to JsonValue.Arr(listOf(
            JsonValue.obj("waitId" to JsonValue.Str("wait"), "ref" to JsonValue.Str("call")),
            JsonValue.obj("waitId" to JsonValue.Str("new-wait")),
        ))))
        runtimeFrame(session, additionalWait)
        assertFalse(session.canReply)
        runtimeFrame(session, JsonValue.parse(waitingSnapshot(3).compact.replace("\"wait\"", "\"new-wait\""))!!)
        assertTrue(session.canReply)
        session.decide("call", ChatSession.ApprovalDecision.Deny)
        assertEquals(responded, session.messages.single().parts.single())
        assertTrue(session.canReply)
    }

    @Test fun plainNativeReplyCannotSubmitTwiceFromTheSameWaitReplay() {
        Dispatchers.setMain(StandardTestDispatcher())
        val session = ChatSession.fresh("fixture", "team")
        metadata(session, AgentConversationDetail(agentRuntime = "openab", canRespondToRun = true, runtimeState = waitingSnapshot()))
        assertTrue(session.send("reply"))
        assertFalse(session.canReply)
        runtimeFrame(session, waitingSnapshot())
        assertFalse(session.canReply)
        assertFalse(session.send("duplicate"))
    }

    @Test fun nonOwnerCannotCreateSessionOrAlwaysApprovalPolicies() {
        Dispatchers.setMain(StandardTestDispatcher())
        for (decision in listOf(ChatSession.ApprovalDecision.Session, ChatSession.ApprovalDecision.Always)) {
            val session = ChatSession.fresh("fixture", "team")
            metadata(session, AgentConversationDetail(agentRuntime = "openab", isOwner = false, canRespondToRun = true, runtimeState = waitingSnapshot()))
            state(session, "messages", listOf(ChatMessage(id = "assistant", role = ChatMessage.Role.Assistant, parts = listOf(waitingTool()))))
            assertTrue(session.canReply)
            session.decide("call", decision, "fixture rule")
            assertEquals(ChatPart.Tool.State.ApprovalRequested, (session.messages.single().parts.single() as ChatPart.Tool).state)
            assertTrue(session.canReply)
        }
    }

    @Test fun nativeSteeringCanEnqueueWhileOriginalSubmissionRemainsPending() {
        Dispatchers.setMain(StandardTestDispatcher())
        var controlCalls = 0
        val session = ChatSession("fixture", "team", steerRuntime = { _, _, _, _ -> controlCalls += 1; "ack" })
        state(session, "loaded", true)
        state(session, "isStreaming", true)
        state(session, "submissionPending", true)
        val original = ComposerSubmission("original delivery")
        val pending = ChatSession::class.java.getDeclaredField("pendingSubmission").apply { isAccessible = true }
        pending.set(session, original)
        metadata(session, AgentConversationDetail(agentRuntime = "openab", canRespondToRun = true,
            runtimeState = JsonValue.parse("""{"schemaVersion":2,"actions":{"reply":false,"send":false,"steer":true}}""")))
        assertTrue(session.canSteer)
        assertTrue(session.canSubmit)
        assertTrue(session.send("steer first"))
        assertTrue(session.send("steer second"))
        assertEquals(listOf("steer first", "steer second"), session.queued)
        assertEquals(original, pending.get(session))
        assertEquals(0, controlCalls)
        metadata(session, AgentConversationDetail(agentRuntime = "openab", canRespondToRun = true,
            runtimeState = JsonValue.parse("""{"schemaVersion":2,"actions":{"reply":false,"send":true,"steer":false}}""")))
        assertFalse(session.canSubmit)
        assertFalse(session.send("duplicate fresh message"))
        assertEquals(original, pending.get(session))
    }

    @Test fun pendingNativeReplyCannotRerouteDuplicateTextIntoSteering() {
        Dispatchers.setMain(StandardTestDispatcher())
        var controlCalls = 0
        val session = ChatSession("fixture", "team", steerRuntime = { _, _, _, _ -> controlCalls += 1; "ack" })
        state(session, "loaded", true)
        metadata(session, AgentConversationDetail(agentRuntime = "openab", canRespondToRun = true,
            runtimeState = JsonValue.parse("""{"schemaVersion":2,"actions":{"reply":true,"send":false,"steer":true}}""")))
        assertTrue(session.canReply)
        assertTrue(session.send("first reply"))
        assertFalse(session.canReply)
        assertFalse(session.canEnqueueSteering)
        assertFalse(session.canSubmit)
        assertFalse(session.send("duplicate reply"))
        assertTrue(session.queued.isEmpty())
        assertEquals(0, controlCalls)
    }

    @Test fun metadataRefreshUpdatesArchive() {
        val session = ChatSession.fresh("fixture", "team")
        metadata(session, AgentConversationDetail(archivedAt = Instant.EPOCH))
        assertTrue(session.isArchived)
        metadata(session, AgentConversationDetail())
        assertFalse(session.isArchived)
    }
    @Test fun startAfterSnapshotReusesCanonicalAssistant() {
        val session = ChatSession.fresh("fixture", "team")
        val canonical = ChatMessage(id = "assistant", role = ChatMessage.Role.Assistant, parts = emptyList())
        state(session, "messages", listOf(canonical))
        val method = ChatSession::class.java.getDeclaredMethod("handle", JsonValue::class.java, String::class.java, Integer::class.java, UIStreamReducer::class.java).apply { isAccessible = true }
        method.invoke(session, JsonValue.parse("""{"type":"start","messageId":"assistant"}""")!!, "start", null, null)
        assertEquals(listOf("assistant"), session.messages.map { it.id })
    }
}

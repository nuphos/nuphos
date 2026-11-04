package ai.nuphos.android.session

import ai.nuphos.android.data.JsonValue
import org.junit.Assert.*
import org.junit.Test

class RuntimeObservationTest {
    private fun observation(time: Double = 10.0, revision: Int = 2, epoch: String = "a", version: Int = 2) =
        RuntimeObservation(JsonValue.parse("""{"state":"active","schemaVersion":$version,"epoch":"$epoch","revision":$revision,"actions":{"send":true,"cancel":false,"steer":true}}""")!!, time)

    @Test fun aChatShowsTypingOnlyForATurnThatAnswersIt() {
        fun state(json: String) = JsonValue.parse(json)!!
        val answering = state("""{"state":"active","schemaVersion":2,"phase":"working","channelIds":["chat-a"]}""")
        assertTrue(RuntimeObservation.typingIn(answering, "chat-a"))
        assertFalse(RuntimeObservation.typingIn(answering, "chat-b"))
        // A turn about the agent's own chat names no channel.
        assertFalse(RuntimeObservation.typingIn(state("""{"state":"active","channelIds":[]}"""), "chat-a"))
        // A backend that names no chats: no dots rather than false ones.
        assertFalse(RuntimeObservation.typingIn(state("""{"state":"active","phase":"working"}"""), "chat-a"))
        assertFalse(RuntimeObservation.typingIn(state("""{"state":"idle","channelIds":["chat-a"]}"""), "chat-a"))
        assertFalse(RuntimeObservation.typingIn(state("""{"state":"active","phase":"resume_disconnected","channelIds":["chat-a"]}"""), "chat-a"))
        assertFalse(RuntimeObservation.typingIn(null, "chat-a"))
    }
    @Test fun actionsRequireFreshV2AndExactFlag() {
        val value = observation()
        assertTrue(value.allows("send", 21.999))
        assertFalse(value.allows("send", 22.0))
        assertFalse(value.allows("send", 9.0))
        assertFalse(value.allows("reply", 11.0))
        assertFalse(value.allows("cancel", 11.0))
        assertFalse(observation(version = 1).allows("send", 11.0))
    }
    @Test fun revisionsAndEpochRejectDelayedObservations() {
        val value = observation()
        assertFalse(value.accepts(observation(11.0, 1)))
        assertFalse(value.accepts(observation(9.0, 2)))
        assertFalse(value.accepts(observation(9.0, 99, "old")))
        assertTrue(value.accepts(observation(11.0, 0, "new")))
        assertTrue(value.accepts(observation(9.0, 3)))
    }
    @Test fun dormantWrapperAndReplayTimestamp() {
        val dormant = RuntimeObservation(JsonValue.parse("""{"state":"dormant","schemaVersion":2,"actions":{"send":true}}""")!!, 1.0)
        assertTrue(dormant.allows("send", 2.0))
        assertEquals(5.0, RuntimeObservation.frameObservedAt(10.0, 10000.0, 5000.0), 0.0)
        assertFalse(RuntimeObservation(observation().snapshot, RuntimeObservation.frameObservedAt(10.0, 10000.0, null)).fresh(10.0))
    }
    @Test fun cursorIncludesErrorsAndUnknownFrames() {
        val cursor = RuntimeFrameCursor(7)
        assertEquals(8, cursor.decoded(JsonValue.parse("""{"type":"error"}""")!!))
        assertEquals(9, cursor.decoded(JsonValue.parse("""{"type":"runtime-state"}""")!!))
        assertEquals(10, cursor.decoded(JsonValue.obj()))
    }
    @Test fun permissionsSeparateOwnerActorAndWritableMember() {
        val member = SessionPermissions(true, null, false, false, false, false)
        assertTrue(member.writable)
        assertFalse(member.manage)
        assertFalse(member.cancel)
        assertFalse(member.reply)
        assertTrue(member.copy(isOwner = true).manage)
        assertTrue(member.copy(canCancelRun = true).cancel)
        assertTrue(member.copy(canRespondToRun = true).reply)
        assertFalse(member.copy(readOnly = true, isOwner = true).manage)
        assertFalse(member.copy(loaded = false).writable)
        assertFalse(member.copy(loadError = "failed").writable)
    }
}

package ai.nuphos.android

import ai.nuphos.android.data.*
import ai.nuphos.android.model.TeamMember
import ai.nuphos.android.session.SharingState
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

class SessionSharingTest {
    private val owner = SessionAccess.Participant("owner", "Owner", "", true, "owner")
    private val viewer = SessionAccess.Participant("viewer", "Viewer", "", false, "view")
    private val initial = SessionAccess(GeneralAccess.View, listOf(owner, viewer))
    private val member = TeamMember("new", "New teammate", "new@example.invalid")
    /** Like the backend: an invitee without the computer is refused with 409 until the invite grants it. */
    private class Fake(var state: SessionAccess, val withComputer: MutableSet<String> = mutableSetOf()) : SharingTransport {
        var writes = 0
        var fail = false
        var hold: CompletableDeferred<Unit>? = null
        val grants = mutableListOf<Boolean>()
        override suspend fun read() = state
        override suspend fun members() = emptyList<TeamMember>()
        private suspend fun write(next: SessionAccess): SessionAccess { writes++; hold?.await(); if (fail) error("Synthetic denial (403)"); state = next; return next }
        override suspend fun general(value: GeneralAccess) = write(state.copy(generalAccess = value))
        override suspend fun invite(userId: String, grantComputerUse: Boolean): SessionAccess {
            grants += grantComputerUse
            // The real parser, so the state matches what the transport throws.
            if (userId !in withComputer && !grantComputerUse) throw AgentChatApi.conflict(409, """{"error":{"code":"computer_use_required","message":"Adding this person to the task also gives them use of Mac. Continue?"}}""")
            withComputer += userId
            val joined = state.participants.filterNot { it.id == userId } + SessionAccess.Participant(userId, "New", "", false, "reply")
            return write(state.copy(participants = joined))
        }
        override suspend fun remove(userId: String) = write(state.copy(participants = state.participants.filterNot { it.id == userId }))
    }
    @Test fun aParticipantRepliesOnlyWithTheComputer() {
        assertFalse(viewer.canReply)
        assertEquals("Can view", viewer.roleTitle)
        assertTrue(viewer.copy(role = "reply").canReply)
    }
    @Test fun ownerGateAndFailurePreserveAuthoritativeState() = runTest {
        val fake = Fake(initial, mutableSetOf(member.id))
        var owns = false
        val state = SharingState(fake) { owns }
        state.load()
        assertFalse(state.general(GeneralAccess.Invited))
        assertFalse(state.invite(member))
        owns = true; state.load()
        assertFalse(state.remove(owner))
        assertEquals(0, fake.writes)
        fake.fail = true
        assertFalse(state.general(GeneralAccess.Invited))
        assertEquals(initial, state.access)
        assertNull(state.pending)
        assertTrue(state.error!!.contains("403"))
        fake.fail = false
        assertTrue(state.general(GeneralAccess.Invited))
        assertTrue(state.invite(member))
        assertEquals(member, state.added)
        state.undo()
        assertNull(state.added)
        assertFalse(state.access!!.participants.any { it.id == member.id })
    }
    @Test fun firstInviteWithoutTheComputerAsksThenGrantsOnConfirm() = runTest {
        val fake = Fake(initial)
        val state = SharingState(fake) { true }; state.load()
        assertFalse(state.invite(member))
        assertEquals(member.id, state.needsComputer?.id)
        assertNull(state.error)
        assertEquals(listOf(false), fake.grants)
        assertTrue(state.confirmComputer())
        assertEquals(listOf(false, true), fake.grants)
        assertNull(state.needsComputer)
        assertEquals(member, state.added)
        assertTrue(state.access!!.participants.any { it.id == member.id })
    }
    @Test fun lettingAViewerReplyAsksTooAndLeavesNoReceipt() = runTest {
        val fake = Fake(initial)
        val state = SharingState(fake) { true }; state.load()
        assertFalse(state.letReply(viewer))
        assertEquals(viewer.id, state.needsComputer?.id)
        state.cancelComputer()
        assertNull(state.needsComputer)
        assertFalse(state.letReply(viewer))
        assertTrue(state.confirmComputer())
        assertTrue(state.access!!.participants.first { it.id == viewer.id }.canReply)
        assertNull(state.added)
    }
    @Test fun duplicateWritesAreBlockedWhilePendingAndPermissionIsRechecked() = runTest {
        val fake = Fake(initial)
        var owns = true
        val state = SharingState(fake) { owns }; state.load()
        fake.hold = CompletableDeferred()
        val first = launch { state.general(GeneralAccess.Invited) }
        testScheduler.runCurrent()
        assertEquals("access", state.pending)
        assertFalse(state.general(GeneralAccess.View))
        assertEquals(1, fake.writes)
        fake.hold!!.complete(Unit); first.join()
        owns = false
        assertFalse(state.remove(viewer))
        assertEquals(1, fake.writes)
    }
    @Test fun transportAlwaysSaysWhetherToGrantTheComputer() = runTest {
        data class Call(val method: String, val path: String, val query: List<Pair<String,String>>, val body: JsonValue?)
        val calls = mutableListOf<Call>()
        val api = SessionSharingApi("synthetic-token", "team", "session") { method, path, _, query, body ->
            calls += Call(method,path,query,body)
            """{"generalAccess":"view","participants":[{"id":"owner","name":"Owner","email":"","isOwner":true,"role":"owner"}]}"""
        }
        assertEquals(GeneralAccess.View, api.read().generalAccess)
        api.general(GeneralAccess.Invited); api.invite("new", false); api.invite("new", true); api.remove("a/b")
        assertEquals(listOf("GET", "PATCH", "POST", "POST", "DELETE"), calls.map { it.method })
        assertTrue(calls.all { it.query == listOf("teamId" to "team") })
        assertEquals("agent/conversations/session/participants/a%2Fb", calls[4].path)
        assertEquals("none", calls[1].body!!["generalAccess"]?.stringValue)
        assertEquals(JsonValue.Bool(false), calls[2].body!!["grantComputerUse"])
        assertEquals(JsonValue.Bool(true), calls[3].body!!["grantComputerUse"])
        assertNull(calls[2].body!!["role"])
        assertEquals(listOf(JsonValue.Str("new")), calls[2].body!!["userIds"]?.arrayValue)
    }
}

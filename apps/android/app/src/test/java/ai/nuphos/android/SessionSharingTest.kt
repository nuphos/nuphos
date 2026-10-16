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
    private val initial = SessionAccess(GeneralAccess.Reply, listOf(owner, viewer))
    private val member = TeamMember("new", "New teammate", "new@example.invalid")
    private class Fake(var state: SessionAccess) : SharingTransport {
        var writes = 0
        var fail = false
        var hold: CompletableDeferred<Unit>? = null
        override suspend fun read() = state
        override suspend fun members() = emptyList<TeamMember>()
        override val localRuntime = true
        private suspend fun write(next: SessionAccess): SessionAccess { writes++; hold?.await(); if (fail) error("Synthetic denial (403)"); state = next; return next }
        override suspend fun general(value: GeneralAccess) = write(state.copy(generalAccess = value))
        override suspend fun role(userId: String, role: ShareRole) = write(state.copy(participants = state.participants.map { if (it.id == userId) it.copy(role = role.raw) else it }))
        override suspend fun invite(userId: String, role: ShareRole) = write(state.copy(participants = state.participants + SessionAccess.Participant(userId, "New", "", false, role.raw)))
        override suspend fun remove(userId: String) = write(state.copy(participants = state.participants.filterNot { it.id == userId }))
    }
    @Test fun broaderGrantWinsWithoutChangingIndividualRole() {
        assertEquals(ShareRole.Reply, viewer.effectiveRole(GeneralAccess.Reply))
        assertEquals(ShareRole.View, viewer.effectiveRole(GeneralAccess.Invited))
        assertEquals(ShareRole.Manage, viewer.copy(role = "manage").effectiveRole(GeneralAccess.Reply))
    }
    @Test fun ownerGateFloorAndFailurePreserveAuthoritativeState() = runTest {
        val fake = Fake(initial)
        var owns = false
        val state = SharingState(fake) { owns }
        state.load()
        assertFalse(state.general(GeneralAccess.View))
        assertFalse(state.invite(member, ShareRole.Reply))
        owns = true; state.load()
        assertFalse(state.role(viewer, ShareRole.View))
        assertFalse(state.remove(owner))
        assertEquals(0, fake.writes)
        fake.fail = true
        assertFalse(state.general(GeneralAccess.Invited))
        assertEquals(initial, state.access)
        assertNull(state.pending)
        assertTrue(state.error!!.contains("403"))
        fake.fail = false
        assertTrue(state.general(GeneralAccess.Invited))
        assertTrue(state.role(viewer, ShareRole.Manage))
        assertEquals(ShareRole.Manage, state.access!!.participants.last().effectiveRole(GeneralAccess.Invited))
        assertTrue(state.invite(member, ShareRole.Reply))
        assertEquals(member, state.added)
        state.undo()
        assertNull(state.added)
        assertFalse(state.access!!.participants.any { it.id == member.id })
    }
    @Test fun duplicateWritesAreBlockedWhilePendingAndPermissionIsRechecked() = runTest {
        val fake = Fake(initial)
        var owns = true
        val state = SharingState(fake) { owns }; state.load()
        fake.hold = CompletableDeferred()
        val first = launch { state.general(GeneralAccess.View) }
        testScheduler.runCurrent()
        assertEquals("access", state.pending)
        assertFalse(state.general(GeneralAccess.Invited))
        assertEquals(1, fake.writes)
        fake.hold!!.complete(Unit); first.join()
        owns = false
        assertFalse(state.remove(viewer))
        assertEquals(1, fake.writes)
    }
    @Test fun transportUsesExistingScopedRoutesAndFullServerResponse() = runTest {
        data class Call(val method: String, val path: String, val query: List<Pair<String,String>>, val body: JsonValue?)
        val calls = mutableListOf<Call>()
        val api = SessionSharingApi("synthetic-token", "team", "session", null) { method, path, _, query, body ->
            calls += Call(method,path,query,body)
            """{"generalAccess":"view","participants":[{"id":"owner","name":"Owner","email":"","isOwner":true,"role":"owner"}]}"""
        }
        assertEquals(GeneralAccess.View, api.read().generalAccess)
        api.general(GeneralAccess.Reply); api.invite("new", ShareRole.Manage); api.role("a/b", ShareRole.View); api.remove("new")
        assertEquals(listOf("GET", "PATCH", "POST", "PATCH", "DELETE"), calls.map { it.method })
        assertTrue(calls.all { it.query == listOf("teamId" to "team") })
        assertEquals("agent/conversations/session/participants/a%2Fb", calls[3].path)
        assertEquals("reply", calls[1].body!!["generalAccess"]?.stringValue)
        assertEquals("manage", calls[2].body!!["role"]?.stringValue)
        assertEquals(listOf(JsonValue.Str("new")), calls[2].body!!["userIds"]?.arrayValue)
    }
    @Test fun offlineLocalAddressNeedsWarningWithoutCatalogRequest() = runTest {
        var requests = 0
        fun api(id: String?) = SessionSharingApi("synthetic", "team", "session", id) { _, _, _, _, _ ->
            requests++; error("No catalog request is allowed")
        }
        assertTrue(api("local_owner_device_codex").localRuntime)
        assertTrue(api("local_owner_device").localRuntime)
        assertFalse(api("managed-agent").localRuntime)
        assertFalse(api(null).localRuntime)
        assertEquals(0, requests)
    }

}

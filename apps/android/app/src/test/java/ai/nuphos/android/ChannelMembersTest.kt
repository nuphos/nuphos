package ai.nuphos.android

import ai.nuphos.android.data.*
import ai.nuphos.android.model.TeamMember
import ai.nuphos.android.session.ChannelMembers
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

/** A group chat's Members (#5313) against the server's rules, kept in memory. */
class ChannelMembersTest {
    private fun person(id: String, owner: Boolean = false) = SessionAccess.Participant(id, id.replaceFirstChar { it.uppercase() }, "", owner, if (owner) "owner" else "reply")
    private val jordan = person("jordan", owner = true)
    private val riley = person("riley")
    private val sam = person("sam")
    private val taylor = TeamMember("taylor", "Taylor", "taylor@example.invalid")

    private class Fake(var people: List<SessionAccess.Participant>) : ChannelMembers.Transport {
        val calls = mutableListOf<String>()
        var failures = 0
        private fun call(name: String) {
            calls += name
            if (failures > 0) { failures--; error("Synthetic failure (500)") }
        }
        private fun access() = SessionAccess(GeneralAccess.Invited, people)
        override suspend fun read() = access()
        override suspend fun members() = listOf(TeamMember("taylor", "Taylor", "taylor@example.invalid"))
        override suspend fun general(value: GeneralAccess) = error("Not used")
        override suspend fun invite(userId: String, grantComputerUse: Boolean): SessionAccess {
            call("invite $userId $grantComputerUse")
            if (!grantComputerUse) throw AgentChatApi.conflict(409, """{"error":{"code":"computer_use_required","message":"Also give use of this computer?"}}""")
            people = people + SessionAccess.Participant(userId, "Taylor", "", false, "reply")
            return access()
        }
        // Like the backend: an owner leaving hands the chat to the next person in order.
        override suspend fun remove(userId: String): SessionAccess {
            call("remove $userId")
            val gone = people.first { it.id == userId }
            people = (people - gone).let { rest -> if (gone.isOwner && rest.isNotEmpty()) listOf(rest[0].copy(isOwner = true, role = "owner")) + rest.drop(1) else rest }
            return access()
        }
        override suspend fun addBot(botId: String) = call("addBot $botId")
        override suspend fun removeBot(botId: String) = call("removeBot $botId")
    }

    @Test fun theOwnerAddsABot() = runTest {
        val fake = Fake(listOf(jordan, riley))
        val members = ChannelMembers(fake, "jordan").apply { load() }
        assertTrue(members.isOwner)
        members.addBot("bot-support")
        assertEquals(listOf("addBot bot-support"), fake.calls)
        assertNull(members.failure)
    }

    @Test fun theOwnerAddsAPersonAfterTheComputerQuestion() = runTest {
        val fake = Fake(listOf(jordan, riley))
        val members = ChannelMembers(fake, "jordan").apply { load() }
        assertEquals(listOf(taylor), members.sharing.invitable(""))
        members.addPerson(taylor)
        // Asked, not failed.
        assertNull(members.failure)
        assertNotNull(members.sharing.needsComputer)
        members.confirmComputer()
        assertEquals(listOf("invite taylor false", "invite taylor true"), fake.calls)
        assertEquals(listOf("jordan", "riley", "taylor"), members.people.map { it.id })
        assertTrue(members.sharing.invitable("").isEmpty())
    }

    @Test fun aMemberLeaves() = runTest {
        val fake = Fake(listOf(jordan, riley, sam))
        val members = ChannelMembers(fake, "sam").apply { load() }
        assertFalse(members.isOwner)
        assertNull(members.heir)
        assertFalse(members.last)
        members.leave()
        assertTrue(members.left)
        assertEquals(listOf("remove sam"), fake.calls)
    }

    @Test fun theOwnerLeavesAndTheNextPersonOwnsIt() = runTest {
        val fake = Fake(listOf(jordan, riley, sam))
        val members = ChannelMembers(fake, "jordan").apply { load() }
        assertEquals("riley", members.heir?.id)
        members.leave()
        assertTrue(members.left)
        assertTrue(fake.people.first().let { it.id == "riley" && it.isOwner })
    }

    @Test fun theLastPersonLeaves() = runTest {
        val fake = Fake(listOf(jordan))
        val members = ChannelMembers(fake, "jordan").apply { load() }
        assertTrue(members.last)
        assertNull(members.heir)
        members.leave()
        assertTrue(members.left)
        assertTrue(fake.people.isEmpty())
    }

    @Test fun aFailureSaysWhatAndRetries() = runTest {
        val fake = Fake(listOf(jordan, riley)).apply { failures = 1 }
        val members = ChannelMembers(fake, "jordan").apply { load() }
        members.leave()
        assertFalse(members.left)
        val failure = requireNotNull(members.failure)
        assertEquals(R.string.chats_members_leave_failed, failure.message)
        failure.retry()
        assertTrue(members.left)
        assertNull(members.failure)
        assertEquals(listOf("remove jordan", "remove jordan"), fake.calls)
    }
}

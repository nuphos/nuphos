package ai.nuphos.android.session

import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

class ConversationLinksTest {
    private val team = "69e989027ab63e8d6a0ffcb6"
    private val url = "https://nuphos.ai/teams/$team/agent/8dbdbda6-5c6a-4676-a8f9-dbead7d02741"

    @Test fun exactConversationPathAndOptionalTrailingSlash() {
        val target = ConversationLink.parse(url)!!
        assertEquals(team, target.teamId)
        assertEquals(target, ConversationLink.parse("$url/"))
        assertEquals(url, target.url)
    }

    @Test fun rejectUntrustedAndAmbiguousUrls() {
        listOf(
            url.replace("https:", "http:"), url.replace("https:", "nuphos:"),
            url.replace("nuphos.ai", "nuphos.ai.evil.example"),
            url.replace("nuphos.ai", "www.nuphos.ai"),
            url.replace("nuphos.ai", "user@nuphos.ai"),
            url.replace("nuphos.ai", "nuphos.ai:443"),
            url.replace("/teams/", "/%74eams/"),
            url.replace(team, "../other"), url.replace("/agent/", "/agents/"),
            "$url/extra", "$url//", "$url?token=secret", "$url?", "$url#fragment",
            url.replace("/agent/", "/agent/%2f"), "$url%00", "$url\\extra",
            "https://nuphos.ai/teams/$team/agent/", "not a URL",
        ).forEach { assertNull(it, ConversationLink.parse(it)) }
    }

    @Test fun pendingSurvivesLoginAndRecreationAndIsConsumedOnce() {
        val pending = PendingConversationLink()
        pending.offer(ConversationLink.parse(url)!!)
        val saved = pending.value.value!!.destination.url
        val restored = PendingConversationLink().also { it.restore(saved) }
        val request = restored.value.value!!
        assertEquals(pending.value.value!!.destination, request.destination)
        assertTrue(restored.complete(request))
        assertFalse(restored.complete(request))
        assertNull(restored.value.value)
    }

    @Test fun lateCompletionCannotConsumeNewTapAndRestoreCannotReplaceIt() {
        val pending = PendingConversationLink()
        val first = ConversationLink.parse(url)!!
        pending.offer(first)
        val old = pending.value.value!!
        val next = first.copy(conversationId = "new-session")
        pending.offer(next)
        pending.restore(url)
        assertFalse(pending.complete(old))
        assertEquals(next, pending.value.value!!.destination)
    }

    @Test fun currentAccountMustHaveMembershipBeforeAnyConversationRead() = runTest {
        var reads = 0
        val resolver = ConversationLinkAccess(memberships = { listOf("other-team") },
            teamId = { it }, conversation = { reads++ })
        assertNull(resolver.resolve(ConversationLink.parse(url)!!))
        assertEquals(0, reads)
    }

    @Test fun authorizedOtherWorkspaceAndConversationAreReadBeforeResolution() = runTest {
        val destination = ConversationLink.parse(url)!!
        var read: ConversationLink? = null
        val resolver = ConversationLinkAccess(memberships = { listOf("other-team", team) },
            teamId = { it }, conversation = { read = it })
        assertEquals(team, resolver.resolve(destination)!!.second)
        assertEquals(destination, read)
    }

    @Test fun inaccessibleOrDeletedConversationNeverResolves() = runTest {
        for (code in listOf(403, 404, 401, 500)) {
            val resolver = ConversationLinkAccess(memberships = { listOf(team) },
                teamId = { it }, conversation = { throw IllegalStateException("HTTP $code") })
            try {
                resolver.resolve(ConversationLink.parse(url)!!)
                fail("Failed authorization must not resolve")
            } catch (expected: IllegalStateException) { assertEquals("HTTP $code", expected.message) }
        }
    }

    @Test fun identityOrWorkspaceChangeFencesMembershipAndConversationResponses() = runTest {
        val destination = ConversationLink.parse(url)!!
        for (changeDuringMembership in listOf(true, false)) {
            var current = true
            var detailReads = 0
            val resolver = ConversationLinkAccess(
                memberships = { if (changeDuringMembership) current = false; listOf(team) },
                teamId = { it },
                conversation = { detailReads++; current = false },
            )
            assertNull(resolver.resolve(destination) { current })
            assertEquals(if (changeDuringMembership) 0 else 1, detailReads)
        }
    }
}

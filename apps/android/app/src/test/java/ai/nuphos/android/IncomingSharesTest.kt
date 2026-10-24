package ai.nuphos.android

import ai.nuphos.android.session.IncomingShareMailbox as IncomingShares

import ai.nuphos.android.data.AttachmentRetention
import ai.nuphos.android.model.ComposerAttachment
import ai.nuphos.android.session.ComposerDrafts
import org.junit.Assert.*
import org.junit.Test
import java.nio.file.Files

class IncomingSharesTest {
    private fun key(account: String = "account", team: String = "team") =
        ComposerDrafts.Key(account, team, ComposerDrafts.Destination.NewChat)

    @Test fun initialSignInCanClaimShareButChangingIdentityCannotInheritIt() {
        val shares = IncomingShares()
        val id = shares.begin(null)!!
        shares.identityReset() // beginning the first sign-in must retain an unowned share
        shares.loaded(id, "https://example.com", emptyList())
        assertFalse(shares.choose(id, key()))
        shares.bindAccount("account")
        assertTrue(shares.choose(id, key()))
        shares.bindAccount("other")
        assertNull(shares.state.value)
    }
    @Test fun deliveryMustMatchAccountTeamAndDestinationAndCanOnlyBeConsumedOnce() {
        val shares = IncomingShares()
        val id = shares.begin("account")!!
        assertFalse(shares.choose(id, key())) // still loading
        shares.loaded(id, "draft", emptyList())
        assertFalse(shares.choose(id, key("other")))
        assertTrue(shares.choose(id, key()))
        assertFalse(shares.consumed(id, key(team = "other")))
        assertTrue(shares.consumed(id, key()))
        assertFalse(shares.consumed(id, key()))
    }
    @Test fun cancellationReleasesCopiesAndStaleReadCannotReplaceANewShare() {
        val dir = Files.createTempDirectory("incoming-share-test").toFile()
        try {
            val shares = IncomingShares()
            val first = shares.begin("account")!!
            val file = AttachmentRetention(dir).retain(emptyList(), listOf(
                AttachmentRetention.Input("fixture.txt", "text/plain", 3) { "abc".byteInputStream() }
            )).single()
            val source = (file.kind as ComposerAttachment.Kind.RetainedFile).source
            shares.cancel()
            val second = shares.begin("account")!!
            assertFalse(shares.loaded(first, "stale", listOf(file)))
            assertFalse(source.exists)
            shares.loaded(second, "current", emptyList())
            assertEquals("current", shares.state.value?.text)
            assertNull(shares.begin("account")) // do not silently overwrite another pending share
        } finally { dir.deleteRecursively() }
    }
    @Test fun deliveredAttachmentsSurviveDestinationRecreationAndAreIsolatedByWorkspace() {
        val shares = IncomingShares()
        val id = shares.begin("account")!!
        val attachment = ComposerAttachment(name = "fixture.txt", kind = ComposerAttachment.Kind.File("abc".toByteArray(), "text/plain"))
        shares.loaded(id, "", listOf(attachment))
        shares.choose(id, key())
        shares.consumed(id, key())
        assertEquals(listOf(attachment), shares.attachments(key().copy()))
        assertTrue(shares.attachments(key(team = "another")).isEmpty())
        shares.identityReset()
        assertTrue(shares.attachments(key()).isEmpty())
    }
    @Test fun successfulDeliveryTransfersFileOwnershipInsteadOfDeletingIt() {
        val dir = Files.createTempDirectory("incoming-share-owner").toFile()
        try {
            val shares = IncomingShares()
            val id = shares.begin("account")!!
            val file = AttachmentRetention(dir).retain(emptyList(), listOf(
                AttachmentRetention.Input("fixture.txt", "text/plain", 3) { "abc".byteInputStream() }
            )).single()
            val source = (file.kind as ComposerAttachment.Kind.RetainedFile).source
            shares.loaded(id, "", listOf(file))
            shares.choose(id, key())
            shares.consumed(id, key())
            shares.cancel()
            assertTrue(source.exists)
            file.releaseOwnedCopy()
            assertFalse(source.exists)
        } finally { dir.deleteRecursively() }
    }
}

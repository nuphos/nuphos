package ai.nuphos.android

import ai.nuphos.android.session.IncomingShareMailbox as IncomingShares

import ai.nuphos.android.data.*
import ai.nuphos.android.model.ComposerAttachment
import ai.nuphos.android.session.*
import java.io.File
import java.io.RandomAccessFile
import java.nio.file.Files
import org.junit.After
import org.junit.Assert.*
import org.junit.Test

class ShareDraftStoreTest {
    private val root = Files.createTempDirectory("share-journal-test").toFile()
    private var clock = 1_700_000_000_000L
    private fun store() = ShareDraftStore(root) { clock }
    private fun key(account: String = "A", team: String = "T", session: String? = null) =
        ComposerDrafts.Key(account, team, session?.let { ComposerDrafts.Destination.Chat(it) } ?: ComposerDrafts.Destination.NewChat)
    private fun file(name: String = "fixture.txt") = ComposerAttachment(name = name, kind = ComposerAttachment.Kind.File("synthetic bytes".toByteArray(), "text/plain"))
    private fun mailbox() = IncomingShares(store()) { clock }
    @After fun cleanup() { root.deleteRecursively() }

    @Test fun pendingSurvivesFreshObjectsWithOnlyPrivateCopiesAndRequiresDestinationAgain() {
        val shares = mailbox()
        val files = shares.prepare(listOf(file(), ComposerAttachment(name = "image.jpg", kind = ComposerAttachment.Kind.Image(byteArrayOf(1, 2, 3)))))
        val id = shares.begin("A")!!
        shares.loaded(id, "URL https://example.com", files)
        shares.choose(id, key())
        val restored = mailbox()
        assertNull(restored.state.value!!.destination)
        assertEquals("URL https://example.com", restored.state.value!!.text)
        assertEquals(2, restored.state.value!!.attachments.size)
        assertTrue(restored.state.value!!.attachments[1].isImage)
        val source = (restored.state.value!!.attachments[0].kind as ComposerAttachment.Kind.RetainedFile).source
        assertEquals("synthetic bytes", source.open().bufferedReader().readText())
        assertTrue(File(root, "state.json").readText().let { !it.contains("content://") && !it.contains("synthetic bytes") })
    }
    @Test fun mergeIsAnAtomicOnceOnlyTextAndAttachmentTransactionAcrossRestart() {
        val shares = mailbox()
        shares.bindAccount("A")
        val id = shares.begin("A")!!
        val files = shares.prepare(listOf(file()))
        shares.loaded(id, "shared", files)
        shares.choose(id, key())
        assertTrue(shares.consumed(id, key(), "existing\n\nshared", files))
        // Simulate death before the older text preferences receive the merged value.
        val restored = mailbox()
        assertTrue(restored.attachments(key()).isEmpty()) // not exposed before identity verification
        restored.bindAccount("A")
        assertNull(restored.state.value)
        assertEquals("existing\n\nshared", restored.text(key()))
        assertEquals(1, restored.attachments(key()).size)
        assertFalse(restored.consumed(id, key(), "duplicate", files))
        restored.writeText(key(), "edited after import")
        val again = mailbox().also { it.bindAccount("A") }
        assertEquals("edited after import", again.text(key()))
        assertTrue(again.attachments(key("B")).isEmpty())
        assertTrue(again.attachments(key(team = "other")).isEmpty())
        assertTrue(again.attachments(key(session = "other")).isEmpty())
    }
    @Test fun cancelAndAccountReplacementCannotRestoreOldPrivateContent() {
        val shares = mailbox()
        val id = shares.begin("A")!!
        val files = shares.prepare(listOf(file()))
        shares.loaded(id, "private", files)
        shares.cancel()
        assertNull(mailbox().state.value)
        assertEquals(0, store().assets.listFiles().orEmpty().size)
        val next = shares.begin("A")!!
        shares.loaded(next, "private", shares.prepare(listOf(file())))
        val other = mailbox()
        other.bindAccount("B")
        assertNull(other.state.value)
        assertTrue(store().load().drafts.isEmpty())
        assertEquals(0, store().assets.listFiles().orEmpty().size)
    }
    @Test fun removalPermissionLossAndSendTombstoneNeverResurrectAnOldDraft() {
        val shares = mailbox().also { it.bindAccount("A") }
        val id = shares.begin("A")!!
        val files = shares.prepare(listOf(file()))
        shares.loaded(id, "shared", files); shares.choose(id, key()); shares.consumed(id, key(), "text", files)
        shares.sent(key())
        assertTrue((files[0].kind as ComposerAttachment.Kind.RetainedFile).source.exists) // local submission owns it
        val restored = mailbox().also { it.bindAccount("A") }
        assertEquals("", restored.text(key())) // overrides stale pre-send preferences
        assertTrue(restored.attachments(key()).isEmpty())
        assertEquals(0, store().assets.listFiles().orEmpty().size) // abandoned handoff is not replayed
    }
    @Test fun deniedDestinationAndRemovedWorkspaceDeleteCopiesButOtherTeamsRemain() {
        val shares = mailbox().also { it.bindAccount("A") }
        for (team in listOf("one", "two")) {
            val id = shares.begin("A")!!
            val files = shares.prepare(listOf(file()))
            shares.loaded(id, "shared", files); shares.choose(id, key(team = team)); shares.consumed(id, key(team = team), "text", files)
        }
        shares.pruneTeams(setOf("two"))
        assertTrue(shares.attachments(key(team = "one")).isEmpty())
        assertEquals(1, shares.attachments(key(team = "two")).size)
        shares.drop(key(team = "two"))
        assertEquals("", shares.text(key(team = "two")))
        assertEquals(0, store().assets.listFiles().orEmpty().size)
    }
    @Test fun expiryAndOrphanCleanupNeverFollowOutsidePaths() {
        val shares = mailbox()
        val id = shares.begin("A")!!
        shares.loaded(id, "expired", shares.prepare(listOf(file())))
        File(store().assets, "partial-copy").writeText("orphan")
        clock += ShareDraftStore.RETENTION_MS + 1
        assertNull(mailbox().state.value)
        assertEquals(0, store().assets.listFiles().orEmpty().size)
    }
    @Test fun missingChangedAndUnsupportedMetadataFailClosed() {
        for (corruption in listOf("missing", "changed", "version", "path")) {
            root.deleteRecursively(); root.mkdirs()
            val shares = mailbox()
            val id = shares.begin("A")!!
            shares.loaded(id, "private", shares.prepare(listOf(file())))
            val asset = store().assets.listFiles()!!.single()
            when (corruption) {
                "missing" -> asset.delete()
                "changed" -> asset.appendText("changed")
                "version" -> File(root, "state.json").writeText(File(root, "state.json").readText().replace("\"version\":1", "\"version\":999"))
                "path" -> File(root, "state.json").writeText(File(root, "state.json").readText().replace(asset.name, "../../outside"))
            }
            assertNull("$corruption rejected", mailbox().state.value)
            assertEquals(0, store().assets.listFiles().orEmpty().size)
        }
    }
    @Test fun interruptedMetadataPublicationKeepsPriorDraftAndCleansUnpublishedCopiesOnNextStart() {
        val shares = mailbox().also { it.bindAccount("A") }
        val id = shares.begin("A")!!
        val files = shares.prepare(listOf(file()))
        shares.loaded(id, "safe", files); shares.choose(id, key()); shares.consumed(id, key(), "safe", files)
        File(root, "state.next").mkdir(); File(root, "state.next/block").writeText("simulate unavailable metadata write")
        assertThrows(Exception::class.java) { shares.writeText(key(), "uncommitted") }
        File(root, "state.next").deleteRecursively()
        val restored = mailbox().also { it.bindAccount("A") }
        assertEquals("safe", restored.text(key()))
        assertEquals(1, restored.attachments(key()).size)
    }
    @Test fun concurrentImportCopiesAreNotDeletedByAnUnrelatedTextCommit() {
        val shares = mailbox().also { it.bindAccount("A") }
        val id = shares.begin("A")!!; val files = shares.prepare(listOf(file()))
        shares.loaded(id, "one", files); shares.choose(id, key()); shares.consumed(id, key(), "one", files)
        val preparing = shares.prepare(listOf(file("new.txt")))
        shares.writeText(key(), "typing while import copies")
        assertTrue((preparing.single().kind as ComposerAttachment.Kind.RetainedFile).source.exists)
        preparing.forEach { it.releaseOwnedCopy() }
    }
    @Test fun quotaCountTextAndSymlinksAreValidatedWithoutReadingWholeFiles() {
        val disk = store()
        val files = disk.retain((1..6).map { file("$it.txt") }) {}
        val blobs = disk.describe(files)
        blobs.forEach { RandomAccessFile(File(disk.assets, it.file), "rw").use { f -> f.setLength(AttachmentTransfers.MAX_FILE_BYTES) } }
        val full = blobs.map { it.copy(size = AttachmentTransfers.MAX_FILE_BYTES) }
        assertThrows(IllegalArgumentException::class.java) {
            disk.commit(ShareDraftStore.Snapshot(pending = ShareDraftStore.Pending(1, "A", "", full, clock)))
        }
        assertThrows(IllegalArgumentException::class.java) {
            disk.commit(ShareDraftStore.Snapshot(pending = ShareDraftStore.Pending(1, "A", "x".repeat(100_001), emptyList(), clock)))
        }
        assertThrows(IllegalArgumentException::class.java) {
            disk.commit(ShareDraftStore.Snapshot(pending = ShareDraftStore.Pending(1, "A", "", List(21) { full.first() }, clock)))
        }
    }
    @Test fun orphanCleanupDoesNotFollowAnAssetsSymlink() {
        val outside = Files.createTempDirectory("outside-share-store").toFile()
        try {
            val keep = File(outside, "keep.txt").also { it.writeText("not our file") }
            Files.createSymbolicLink(File(root, "assets").toPath(), outside.toPath())
            assertNull(mailbox().state.value)
            assertEquals("not our file", keep.readText())
        } finally { outside.deleteRecursively() }
    }

    @Test fun fileBackedImagesKeepTheExistingExplicitSendWireFormat() {
        val image = ComposerAttachment(name = "image.jpg", kind = ComposerAttachment.Kind.Image(byteArrayOf(1, 2, 3)))
        val copy = store().retain(listOf(image)) {}.single()
        assertTrue(copy.isImage)
        assertEquals(image.dataUrl, copy.dataUrl)
    }
    @Test fun unpublishedAndInFlightPayloadsCountAgainstPhysicalQuota() {
        val disk = store()
        val files = disk.retain((1..5).map { file("$it.txt") }) {}
        disk.describe(files).forEach { RandomAccessFile(File(disk.assets, it.file), "rw").use { f -> f.setLength(AttachmentTransfers.MAX_FILE_BYTES) } }
        assertEquals(AttachmentTransfers.MAX_TOTAL_BYTES, disk.usedBytes())
        assertThrows(IllegalArgumentException::class.java) { disk.retain(listOf(file("over-quota.txt"))) {} }
        assertEquals(5, disk.assets.listFiles()!!.size)
    }

    @Test fun expiryClearsLegacyTextBeforeRetiringTheJournalRecord() {
        var legacy = "old preference text"
        fun disk() = ShareDraftStore(root, discardLegacyText = { keys ->
            assertTrue(keys.contains(key())); legacy = ""; true
        }) { clock }
        val shares = IncomingShares(disk()) { clock }.also { it.bindAccount("A") }
        val id = shares.begin("A")!!; val files = shares.prepare(listOf(file()))
        shares.loaded(id, "shared", files); shares.choose(id, key()); shares.consumed(id, key(), "merged", files)
        clock += ShareDraftStore.RETENTION_MS + 1
        val restored = IncomingShares(disk()) { clock }.also { it.bindAccount("A") }
        assertNull(restored.text(key()))
        assertEquals("", legacy)
        assertTrue(restored.attachments(key()).isEmpty())
    }
    @Test fun failedLegacyCleanupKeepsAnEmptyTombstoneAndRetriesOnNextStart() {
        var canClear = false
        var legacy = "older text"
        fun disk() = ShareDraftStore(root, discardLegacyText = {
            if (canClear) { legacy = ""; true } else false
        }) { clock }
        val shares = IncomingShares(disk()) { clock }.also { it.bindAccount("A") }
        val id = shares.begin("A")!!; val files = shares.prepare(listOf(file()))
        shares.loaded(id, "shared", files); shares.choose(id, key()); shares.consumed(id, key(), "merged", files)
        clock += ShareDraftStore.RETENTION_MS + 1
        val blocked = IncomingShares(disk()) { clock }.also { it.bindAccount("A") }
        assertEquals("", blocked.text(key()))
        assertTrue(blocked.attachments(key()).isEmpty())
        assertEquals("older text", legacy)
        canClear = true
        val cleared = IncomingShares(disk()) { clock }.also { it.bindAccount("A") }
        assertNull(cleared.text(key()))
        assertEquals("", legacy)
    }
    @Test fun cancellationDuringACopyRemovesItsPartiallyWrittenPayload() {
        var checks = 0
        assertThrows(java.util.concurrent.CancellationException::class.java) {
            store().retain(listOf(ComposerAttachment(name = "large.txt", kind = ComposerAttachment.Kind.File(ByteArray(20_000), "text/plain")))) {
                if (++checks == 3) throw java.util.concurrent.CancellationException("synthetic cancellation after first chunk")
            }
        }
        assertEquals(3, checks)
        assertTrue(store().assets.listFiles().orEmpty().isEmpty())
    }

    @Test fun tombstoneSurvivesAnUnrelatedCancellationThatCannotPublishMetadata() {
        var canClear = false
        val legacy = mutableMapOf(key() to "already submitted", key(team = "ordinary") to "ordinary draft")
        fun disk() = ShareDraftStore(root, discardLegacyText = { keys ->
            if (canClear) { keys.forEach { legacy.remove(it) }; true } else false
        }) { clock }
        val shares = IncomingShares(disk()) { clock }.also { it.bindAccount("A") }
        val id = shares.begin("A")!!
        shares.loaded(id, "shared", emptyList()); shares.choose(id, key()); shares.consumed(id, key(), "merged")
        shares.sent(key())
        val pending = shares.begin("A")!!; shares.loaded(pending, "unrelated", emptyList())
        File(root, "state.next").mkdir(); File(root, "state.next/block").writeText("disk failure")
        shares.cancel()
        assertFalse(File(root, "state.json").exists())
        File(root, "state.next").deleteRecursively()
        val restored = IncomingShares(disk()) { clock }.also { it.bindAccount("A") }
        assertEquals("", restored.text(key()) ?: legacy[key()])
        assertEquals("ordinary draft", restored.text(key(team = "ordinary")) ?: legacy[key(team = "ordinary")])
        assertEquals("already submitted", legacy[key()])
        canClear = true
        val cleared = IncomingShares(disk()) { clock }.also { it.bindAccount("A") }
        assertNull(cleared.text(key()) ?: legacy[key()])
        assertEquals("ordinary draft", legacy[key(team = "ordinary")])
    }
    @Test fun deliveredDraftCorruptionCannotFallBackToLegacyTextOrEraseOrdinaryDrafts() {
        for (corruption in listOf("missing payload", "changed payload", "invalid metadata", "missing metadata")) {
            root.deleteRecursively(); root.mkdirs()
            val legacy = mapOf(key() to "stale shared text", key(team = "ordinary") to "ordinary")
            fun disk() = ShareDraftStore(root, discardLegacyText = { false }) { clock }
            val shares = IncomingShares(disk()) { clock }.also { it.bindAccount("A") }
            val id = shares.begin("A")!!; val files = shares.prepare(listOf(file()))
            shares.loaded(id, "shared", files); shares.choose(id, key()); shares.consumed(id, key(), "merged", files)
            when (corruption) {
                "missing payload" -> disk().assets.listFiles()!!.single().delete()
                "changed payload" -> disk().assets.listFiles()!!.single().appendText("changed")
                "invalid metadata" -> File(root, "state.json").writeText("{invalid")
                "missing metadata" -> File(root, "state.json").delete()
            }
            val restored = IncomingShares(disk()) { clock }.also { it.bindAccount("A") }
            assertEquals(corruption, "", restored.text(key()) ?: legacy[key()])
            assertTrue(restored.attachments(key()).isEmpty())
            assertEquals("ordinary", restored.text(key(team = "ordinary")) ?: legacy[key(team = "ordinary")])
            restored.writeText(key(), "new manual edit")
            assertEquals("new manual edit", IncomingShares(disk()) { clock }.also { it.bindAccount("A") }.text(key()))
        }
    }
    @Test fun failedFirstDeliveryDoesNotSuppressAnUnrelatedPreexistingComposerDraft() {
        val disk = ShareDraftStore(root, discardLegacyText = { false }) { clock }
        val shares = IncomingShares(disk) { clock }.also { it.bindAccount("A") }
        val id = shares.begin("A")!!; shares.loaded(id, "pending", emptyList()); shares.choose(id, key())
        File(root, "state.next").mkdir(); File(root, "state.next/block").writeText("publication fails after guard")
        assertThrows(Exception::class.java) { shares.consumed(id, key(), "ordinary plus pending") }
        assertNull(shares.text(key())) // an uncommitted guard must not hide the live ordinary draft
        File(root, "state.next").deleteRecursively()
        // An unrelated successful commit must not accidentally make that prepared guard authoritative.
        shares.cancel()
        val restored = IncomingShares(ShareDraftStore(root, discardLegacyText = { false }) { clock }) { clock }.also { it.bindAccount("A") }
        assertNull(restored.state.value)
        assertEquals("ordinary", restored.text(key()) ?: "ordinary")
        assertTrue(File(root, "authorities").listFiles().orEmpty().isEmpty())
    }
    @Test fun malformedAuthorityFailsClosedWithoutDeletingAnyLegacyPreference() {
        File(root, "authorities").mkdirs()
        File(root, "authorities/unknown.json").writeText("{bad}")
        var eraseCalls = 0
        val disk = ShareDraftStore(root, discardLegacyText = { eraseCalls++; true }) { clock }
        val restored = IncomingShares(disk) { clock }.also { it.bindAccount("A") }
        assertEquals("", restored.text(key()) ?: "must stay hidden")
        assertEquals(0, eraseCalls)
        assertTrue(File(root, "authorities/unknown.json").exists())
    }

    @Test fun preparedAuthorityOnRestartPreservesTheOrdinaryDraftAndPendingShare() {
        var erased = false
        fun disk() = ShareDraftStore(root, discardLegacyText = { erased = true; true }) { clock }
        val shares = IncomingShares(disk()) { clock }.also { it.bindAccount("A") }
        val id = shares.begin("A")!!; shares.loaded(id, "pending", emptyList()); shares.choose(id, key())
        File(root, "state.next").mkdir(); File(root, "state.next/block").writeText("publication fails")
        assertThrows(Exception::class.java) { shares.consumed(id, key(), "ordinary plus pending") }
        File(root, "state.next").deleteRecursively()
        val restored = IncomingShares(disk()) { clock }.also { it.bindAccount("A") }
        assertEquals("pending", restored.state.value!!.text)
        assertNull(restored.text(key()))
        assertFalse("An uncommitted import must never erase ordinary preferences", erased)
    }

    @Test fun publicationAfterJournalDeletionEstablishesABaselineBeforePreparingAnAuthority() {
        fun disk() = ShareDraftStore(root, discardLegacyText = { false }) { clock }
        val shares = IncomingShares(disk()) { clock }.also { it.bindAccount("A") }
        var id = shares.begin("A")!!; shares.loaded(id, "first", emptyList())
        File(root, "state.next").mkdir(); File(root, "state.next/block").writeText("delete fallback")
        shares.cancel(); File(root, "state.next").deleteRecursively()
        assertFalse(File(root, "state.json").exists())
        id = shares.begin("A")!!; shares.loaded(id, "second", emptyList()); shares.choose(id, key())
        File(root, "state.next").mkdir(); File(root, "state.next/block").writeText("uncommitted import")
        assertThrows(Exception::class.java) { shares.consumed(id, key(), "ordinary plus second") }
        File(root, "state.next").deleteRecursively()
        val restored = IncomingShares(disk()) { clock }.also { it.bindAccount("A") }
        assertEquals("second", restored.state.value!!.text)
        assertNull(restored.text(key()))
    }

    @Test fun failedPreparedMarkerRetirementCannotUnlinkTheProofOfAnUncommittedImport() {
        val shares = IncomingShares(ShareDraftStore(root, discardLegacyText = { false }) { clock }) { clock }.also { it.bindAccount("A") }
        val id = shares.begin("A")!!; shares.loaded(id, "pending", emptyList()); shares.choose(id, key())
        val baseline = File(root, "state.json").readText()
        File(root, "state.next").mkdir(); File(root, "state.next/block").writeText("unavailable replacement")
        assertThrows(Exception::class.java) { shares.consumed(id, key(), "uncommitted") }
        File(root, "state.next").deleteRecursively()
        val marker = File(root, "authorities").listFiles()!!.single()
        assertTrue(marker.delete()); assertTrue(marker.mkdir()); File(marker, "block").writeText("cannot unlink marker")
        assertThrows(Exception::class.java) { shares.cancel() }
        assertEquals(baseline, File(root, "state.json").readText())
        assertEquals("pending", shares.state.value!!.text)
    }

}

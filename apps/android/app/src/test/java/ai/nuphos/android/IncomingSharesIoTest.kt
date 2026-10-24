package ai.nuphos.android

import ai.nuphos.android.data.*
import ai.nuphos.android.session.*
import java.nio.file.Files
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test

class IncomingSharesIoTest {
    private fun assertThread(name: String) = assertEquals(name, Thread.currentThread().name.substringBefore(" @coroutine#"))
    private fun key(account: String = "A", team: String = "T") = ComposerDrafts.Key(account, team, ComposerDrafts.Destination.NewChat)
    private fun seed(disk: ShareDraftStore) {
        val core = IncomingShareMailbox(disk)
        core.bindAccount("A")
        val id = core.begin("A")!!
        core.loaded(id, "shared", emptyList()); core.choose(id, key()); core.consumed(id, key(), "existing shared draft")
    }
    @Test(timeout = 20_000) fun delayedTypingWriteDoesNotBlockUiAndCannotOutliveCancelAndIdentityReset() = runBlocking {
        val root = Files.createTempDirectory("share-io-order").toFile()
        val io = Executors.newSingleThreadExecutor { Thread(it, "share-storage") }.asCoroutineDispatcher()
        val ui = Executors.newSingleThreadExecutor { Thread(it, "share-ui") }.asCoroutineDispatcher()
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val armed = AtomicBoolean(false)
        var shares: IncomingShares? = null
        try {
            val writer = ShareDraftWriter { target, bytes ->
                assertThread("share-storage")
                if (target.name == "state.json" && armed.compareAndSet(true, false)) {
                    entered.countDown()
                    check(release.await(10, TimeUnit.SECONDS))
                }
                AtomicShareDraftWriter.replace(target, bytes)
            }
            val seeded = ShareDraftStore(root)
            seed(seeded)
            val disk = ShareDraftStore(root, fileWriter = writer)
            val box = IncomingShares(disk, ioDispatcher = io, uiDispatcher = ui)
            shares = box
            box.bindAccount("A")
            val pending = box.begin("A")!!; box.loaded(pending, "pending B", emptyList())
            armed.set(true)
            withContext(ui) { box.writeText(key(), "first delayed edit") }
            assertTrue("Storage write did not start", entered.await(5, TimeUnit.SECONDS))
            // The actual writer is blocked. Main must still run, reflect the latest edit, and accept lifecycle actions.
            withTimeout(2_000) { withContext(ui) {
                repeat(1_000) { box.writeText(key(), "latest edit $it") }
                assertEquals("latest edit 999", box.text(key()))
                box.cancel()
                box.identityReset()
                box.writeText(key(), "late old-account input")
                assertEquals("", box.text(key()))
            } }
            release.countDown()
            box.awaitIdle()
            box.bindAccount("B")
            assertNull(box.state.value)
            assertTrue(box.attachments(key()).isEmpty())
            assertTrue(ShareDraftStore(root).load().drafts.isEmpty())
            assertNull(ShareDraftStore(root).load().pending)
        } finally {
            release.countDown(); shares?.close(); io.close(); ui.close(); root.deleteRecursively()
        }
    }
    @Test(timeout = 20_000) fun editsAreConflatedWithoutCrossingTheConsumptionOrSendBarrier() = runBlocking {
        val root = Files.createTempDirectory("share-io-barrier").toFile()
        val io = Executors.newSingleThreadExecutor { Thread(it, "share-storage") }.asCoroutineDispatcher()
        val ui = Executors.newSingleThreadExecutor { Thread(it, "share-ui") }.asCoroutineDispatcher()
        val writes = java.util.concurrent.atomic.AtomicInteger()
        var shares: IncomingShares? = null
        try {
            seed(ShareDraftStore(root))
            val box = IncomingShares(ShareDraftStore(root, fileWriter = ShareDraftWriter { file, bytes ->
                assertThread("share-storage")
                if (file.name == "state.json") writes.incrementAndGet()
                AtomicShareDraftWriter.replace(file, bytes)
            }), ioDispatcher = io, uiDispatcher = ui)
            shares = box; box.bindAccount("A")
            withContext(ui) { repeat(200) { box.writeText(key(), "edit $it") } }
            box.checkWritable(key())
            assertEquals("edit 199", ShareDraftStore(root).load().drafts.single().text)
            box.sent(key())
            box.awaitIdle()
            assertEquals("", box.text(key()))
            assertEquals("", ShareDraftStore(root).load().drafts.single().text)
            assertTrue("All disk publication must use the storage dispatcher", writes.get() > 0)
            withContext(ui) { box.writeText(key(), "deliberate new draft") }
            box.awaitIdle()
            assertEquals("deliberate new draft", ShareDraftStore(root).load().drafts.single().text)
        } finally { shares?.close(); io.close(); ui.close(); root.deleteRecursively() }
    }
    @Test(timeout = 20_000) fun asynchronousStartupErasureAlsoRetiresAnEarlierInMemoryPreferenceRestore() = runBlocking {
        val root = Files.createTempDirectory("share-io-startup").toFile()
        val io = Executors.newSingleThreadExecutor { Thread(it, "share-storage") }.asCoroutineDispatcher()
        val ui = Executors.newSingleThreadExecutor { Thread(it, "share-ui") }.asCoroutineDispatcher()
        val legacy = mutableMapOf(key() to "stale already-restored text", key(team = "ordinary") to "ordinary draft")
        val memory = legacy.toMutableMap()
        var shares: IncomingShares? = null
        try {
            seed(ShareDraftStore(root))
            java.io.File(root, "state.json").writeText("{corrupt")
            val box = IncomingShares(ShareDraftStore(root, discardLegacyText = { keys ->
                assertThread("share-storage")
                keys.forEach(legacy::remove); true
            }), ioDispatcher = io, uiDispatcher = ui, onLegacyErased = { keys ->
                assertThread("share-ui")
                keys.forEach(memory::remove)
            })
            shares = box
            box.bindAccount("A")
            assertNull(box.text(key()) ?: memory[key()])
            assertEquals("ordinary draft", box.text(key(team = "ordinary")) ?: memory[key(team = "ordinary")])
            assertEquals("ordinary draft", legacy[key(team = "ordinary")])
        } finally { shares?.close(); io.close(); ui.close(); root.deleteRecursively() }
    }
    @Test(timeout = 20_000) fun cleanupUsesFileIdentityAndNeverDeletesAcceptedSessionFiles() = runBlocking {
        val root = Files.createTempDirectory("share-io-file-owner").toFile()
        val io = Executors.newSingleThreadExecutor { Thread(it, "share-storage") }.asCoroutineDispatcher()
        val ui = Executors.newSingleThreadExecutor { Thread(it, "share-ui") }.asCoroutineDispatcher()
        var shares: IncomingShares? = null
        try {
            val disk = ShareDraftStore(java.io.File(root, "journal"))
            val box = IncomingShares(disk, ioDispatcher = io, uiDispatcher = ui)
            shares = box; box.bindAccount("A")
            fun ordinary(name: String): ai.nuphos.android.model.ComposerAttachment {
                val source = OwnedAttachmentFile.copy(java.io.File(root, "picker"), "synthetic".byteInputStream(), 100) {}
                return ai.nuphos.android.model.ComposerAttachment(id = name, name = name,
                    kind = ai.nuphos.android.model.ComposerAttachment.Kind.RetainedFile(source, "text/plain"))
            }
            val before = ordinary("same-id")
            val staged = withContext(io) { box.prepare(listOf(before)) }
            val id = box.begin("A")!!; box.loaded(id, "shared", emptyList()); box.choose(id, key())
            assertTrue(box.consumed(id, key(), "merged", staged))
            box.releaseLater(listOf(before)); box.awaitIdle()
            assertFalse((before.kind as ai.nuphos.android.model.ComposerAttachment.Kind.RetainedFile).source.exists)
            val saved = staged.single().kind as ai.nuphos.android.model.ComposerAttachment.Kind.RetainedFile
            assertTrue(saved.source.exists)
            box.sent(key(), staged)
            box.releaseLater(staged); box.awaitIdle()
            assertTrue("Accepted submission owns this copy even though the journal is empty", saved.source.exists)
            val untouched = ordinary("ordinary-without-shared-record")
            box.handoff(listOf(untouched)); box.releaseLater(listOf(untouched)); box.awaitIdle()
            val ordinarySource = (untouched.kind as ai.nuphos.android.model.ComposerAttachment.Kind.RetainedFile).source
            assertTrue("Ordinary accepted attachments also belong to the session", ordinarySource.exists)
            saved.source.release(); ordinarySource.release() // synthetic local submission completes, without any HTTP
        } finally { shares?.close(); io.close(); ui.close(); root.deleteRecursively() }
    }

    @Test(timeout = 20_000) fun identityCleanupFailureIsNotAcknowledgedByALaterBarrier() = runBlocking {
        val root = Files.createTempDirectory("share-io-reset-failure").toFile()
        val io = Executors.newSingleThreadExecutor { Thread(it, "share-storage") }.asCoroutineDispatcher()
        val ui = Executors.newSingleThreadExecutor { Thread(it, "share-ui") }.asCoroutineDispatcher()
        val fail = AtomicBoolean(false)
        var shares: IncomingShares? = null
        try {
            seed(ShareDraftStore(root))
            val box = IncomingShares(ShareDraftStore(root, fileWriter = ShareDraftWriter { target, bytes ->
                if (fail.get() && target.name == "state.json") {
                    target.delete(); target.mkdir(); java.io.File(target, "block").writeText("unavailable deletion")
                    throw java.io.IOException("synthetic publication failure")
                }
                AtomicShareDraftWriter.replace(target, bytes)
            }), ioDispatcher = io, uiDispatcher = ui)
            shares = box; box.bindAccount("A")
            fail.set(true)
            withContext(ui) { box.identityReset(); assertEquals("", box.text(key())) }
            assertNotNull("A fire-and-forget reset failure must reach the logout barrier", runCatching { box.awaitIdle() }.exceptionOrNull())
            assertFalse(box.isBound("A"))
            withContext(io) { java.io.File(root, "state.json").deleteRecursively() }
            fail.set(false); box.bindAccount("B"); box.awaitIdle()
            assertTrue(box.isBound("B"))
            assertTrue(ShareDraftStore(root).load().drafts.isEmpty())
            assertNull(box.state.value)
        } finally { shares?.close(); io.close(); ui.close(); root.deleteRecursively() }
    }

    @Test(timeout = 20_000) fun staleAccountMembershipAndPendingCancelCannotMutateTheNewIdentity() = runBlocking {
        val root = Files.createTempDirectory("share-io-stale-owner").toFile()
        val io = Executors.newSingleThreadExecutor { Thread(it, "share-storage") }.asCoroutineDispatcher()
        val ui = Executors.newSingleThreadExecutor { Thread(it, "share-ui") }.asCoroutineDispatcher()
        var shares: IncomingShares? = null
        try {
            val box = IncomingShares(ShareDraftStore(root), ioDispatcher = io, uiDispatcher = ui)
            shares = box; box.bindAccount("A")
            val old = box.begin("A")!!; box.loaded(old, "old pending", emptyList())
            box.identityReset(); box.bindAccount("B")
            val imported = box.begin("B")!!; box.loaded(imported, "B share", emptyList())
            box.choose(imported, key("B")); assertTrue(box.consumed(imported, key("B"), "B private draft"))
            val current = box.begin("B")!!; box.loaded(current, "B pending", emptyList())
            box.cancel(old)
            box.pruneTeams("A", emptySet())
            box.awaitIdle()
            assertEquals(current, box.state.value!!.id)
            assertEquals("B private draft", box.text(key("B")))
        } finally { shares?.close(); io.close(); ui.close(); root.deleteRecursively() }
    }

    @Test(timeout = 20_000) fun membershipsArrivingBeforeAccountBindStillPruneTheirOwnRestoredDrafts() = runBlocking {
        val root = Files.createTempDirectory("share-io-early-membership").toFile()
        val io = Executors.newSingleThreadExecutor { Thread(it, "share-storage") }.asCoroutineDispatcher()
        val ui = Executors.newSingleThreadExecutor { Thread(it, "share-ui") }.asCoroutineDispatcher()
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        var shares: IncomingShares? = null
        try {
            seed(ShareDraftStore(root))
            val box = IncomingShares(ShareDraftStore(root), ioDispatcher = io, uiDispatcher = ui, beforeLoad = {
                entered.countDown(); check(release.await(10, TimeUnit.SECONDS))
            })
            shares = box
            assertTrue(entered.await(5, TimeUnit.SECONDS))
            val membership = async(start = CoroutineStart.UNDISPATCHED) { box.pruneTeams("A", emptySet()) }
            val binding = async(start = CoroutineStart.UNDISPATCHED) { box.bindAccount("A") }
            release.countDown(); membership.await(); binding.await()
            assertEquals("", box.text(key()))
            assertTrue(ShareDraftStore(root).load().drafts.single().blobs.isEmpty())
        } finally { release.countDown(); shares?.close(); io.close(); ui.close(); root.deleteRecursively() }
    }

}

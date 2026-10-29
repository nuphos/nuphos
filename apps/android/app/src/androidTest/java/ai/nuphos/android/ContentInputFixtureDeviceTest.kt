package ai.nuphos.android

import android.content.ClipData
import android.content.ClipboardManager
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputContentInfo
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry
import androidx.test.runner.lifecycle.Stage
import android.net.Uri
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableStateOf
import ai.nuphos.android.session.ComposerDrafts
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.model.ComposerAttachment
import ai.nuphos.android.model.ComposerSubmission
import ai.nuphos.android.session.AgentStore
import ai.nuphos.android.ui.LocalAgentStore
import ai.nuphos.android.ui.chat.ChatComposer
import ai.nuphos.android.ui.theme.NuphosTheme
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ContentInputFixtureDeviceTest {
    @get:Rule val compose = createComposeRule()
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val lease = mutableStateOf<ComposerDrafts.Lease?>(null)
    private var sent: ComposerSubmission? = null
    private var inputDescription = "Ask Nuphos anything"

    private fun render(streaming: Boolean = false) {
        assumeTrue("Requires isolated content fixture package", context.packageName == "ai.nuphos.android.contentinput1337")
        inputDescription = if (streaming) "Queue a message" else "Ask Nuphos anything"
        lease.value?.key?.accountId?.let { account ->
            kotlinx.coroutines.runBlocking { (context.applicationContext as NuphosApplication).incomingShares.bindAccount(account) }
        }
        compose.setContent {
            val appContext = LocalContext.current
            val store = remember {
                AgentStore("synthetic-no-credentials", appContext).also { store ->
                    lease.value?.key?.teamId?.let { team ->
                        @Suppress("UNCHECKED_CAST")
                        val selected = AgentStore::class.java.getDeclaredField("selectedTeam\$delegate")
                            .also { it.isAccessible = true }.get(store) as androidx.compose.runtime.MutableState<ai.nuphos.android.model.Team?>
                        selected.value = ai.nuphos.android.model.Team(team, "Synthetic workspace")
                    }
                }
            }
            NuphosTheme { CompositionLocalProvider(LocalAgentStore provides store) {
                ChatComposer(isStreaming = streaming, draft = lease.value, onSend = { sent = it; true })
            } }
        }
    }
    private fun paste(clip: ClipData) {
        compose.onNodeWithContentDescription(inputDescription).performClick()
        compose.runOnIdle { context.getSystemService(ClipboardManager::class.java).setPrimaryClip(clip) }
        compose.onNodeWithContentDescription(inputDescription).performKeyInput {
            keyDown(Key.CtrlLeft); pressKey(Key.V); keyUp(Key.CtrlLeft)
        }
        compose.waitForIdle()
    }
    private fun uri(name: String) = Uri.parse("content://ai.nuphos.content-input-fixture/$name")
    private fun clip(name: String) = ClipData.newUri(context.contentResolver, "Synthetic", uri(name))

    @Test fun plainTextPasteRemainsTextAtSelection() {
        render()
        paste(ClipData.newPlainText("Synthetic", "ordinary text"))
        compose.onNodeWithContentDescription("Send").performClick()
        assertEquals("ordinary text", sent?.text)
        assertTrue(sent!!.attachments.isEmpty())
    }
    @Test fun pastedDocumentUsesOwnedCopyAndExactBytes() {
        render()
        paste(clip("fixture.txt"))
        compose.waitUntil(10_000) { compose.onAllNodesWithText("Reading files…").fetchSemanticsNodes().isEmpty() }
        compose.onNodeWithContentDescription("Send").performClick()
        val attachment = sent!!.attachments.single()
        try {
            assertEquals("fixture.txt", attachment.name)
            val file = attachment.kind as ComposerAttachment.Kind.RetainedFile
            assertArrayEquals("Synthetic attachment bytes".toByteArray(), file.source.open().use { it.readBytes() })
        } finally { attachment.releaseOwnedCopy() }
    }
    @Test fun photoPickerVideoKeepsOriginalMimeAndBytesWithoutBitmapDecode() {
        assumeTrue("Requires isolated content fixture package", context.packageName == "ai.nuphos.android.contentinput1337")
        val input = ai.nuphos.android.ui.chat.selectionInput(context, uri("clip.mp4"), images = true)
        assertEquals("video/mp4", input.mime)
        assertFalse(input.isImage)
        val directory = java.io.File(context.cacheDir, "video-retention-" + java.util.UUID.randomUUID())
        val attachment = ai.nuphos.android.data.AttachmentRetention(directory).retain(emptyList(), listOf(input),
            prepareImage = { _, _ -> error("Video must not be decoded as a bitmap") }).single()
        try {
            val retained = attachment.kind as ComposerAttachment.Kind.RetainedFile
            assertEquals("video/mp4", retained.mime)
            assertArrayEquals("Synthetic attachment bytes".toByteArray(), retained.source.open().use { it.readBytes() })
        } finally { attachment.releaseOwnedCopy(); directory.deleteRecursively() }
    }

    @Test fun photoPickerResultCanSubmitRetainedVideo() {
        render()
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val pickerIntent = androidx.activity.result.contract.ActivityResultContracts.PickMultipleVisualMedia(20).createIntent(
            context, androidx.activity.result.PickVisualMediaRequest(androidx.activity.result.contract.ActivityResultContracts.PickVisualMedia.ImageAndVideo))
        val monitor = instrumentation.addMonitor(android.content.IntentFilter(requireNotNull(pickerIntent.action)).apply {
            pickerIntent.type?.let { addDataType(it) }
            pickerIntent.categories.orEmpty().forEach { addCategory(it) }
        }, android.app.Instrumentation.ActivityResult(android.app.Activity.RESULT_OK,
            android.content.Intent().setData(uri("clip.mp4"))), true)
        try {
            compose.onNodeWithContentDescription(inputDescription).performClick()
            compose.onNodeWithContentDescription("Photos").performClick()
            compose.waitUntil(10_000) { compose.onAllNodesWithContentDescription("Remove").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithContentDescription("Send").performClick()
            compose.waitUntil(10_000) { sent != null }
            val attachment = sent!!.attachments.single()
            try {
                val file = attachment.kind as ComposerAttachment.Kind.RetainedFile
                assertEquals("video/mp4", file.mime)
                assertArrayEquals("Synthetic attachment bytes".toByteArray(), file.source.open().use { it.readBytes() })
                assertEquals(1, monitor.hits)
            } finally { attachment.releaseOwnedCopy() }
        } finally { instrumentation.removeMonitor(monitor) }
    }

    @Test fun pastedPngUsesExistingImageConversion() {
        render()
        paste(clip("image.png"))
        compose.waitUntil(10_000) { compose.onAllNodesWithText("Reading files…").fetchSemanticsNodes().isEmpty() }
        compose.onNodeWithContentDescription("Send").performClick()
        val attachment = sent!!.attachments.single()
        assertEquals("image.jpg", attachment.name)
        assertTrue((attachment.kind as ComposerAttachment.Kind.Image).jpeg.isNotEmpty())
    }
    @Test fun rejectedReadKeepsDraftAndDoesNotEnableAttachmentSend() {
        render()
        paste(clip("denied.txt"))
        compose.waitUntil(10_000) { compose.onAllNodesWithText("Synthetic read denied").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithContentDescription("Send").assertIsNotEnabled()
        paste(ClipData.newPlainText("Synthetic", "retry text"))
        compose.onNodeWithContentDescription("Send").performClick()
        assertEquals("retry text", sent?.text)
        assertTrue(sent!!.attachments.isEmpty())
    }
    @Test fun mixedTextAndDocumentPasteCanQueueWhileStreaming() {
        render(streaming = true)
        val mixed = clip("fixture.txt").apply { addItem(ClipData.Item("queued text")) }
        paste(mixed)
        compose.waitUntil(10_000) { compose.onAllNodesWithText("Reading files…").fetchSemanticsNodes().isEmpty() }
        compose.onNodeWithContentDescription("Queue message").performClick()
        try {
            assertEquals("queued text", sent?.text)
            assertEquals("fixture.txt", sent!!.attachments.single().name)
        } finally { sent?.attachments?.forEach { it.releaseOwnedCopy() } }
    }
    @Test fun imeCommitContentReachesTheSameAttachmentPipeline() {
        render()
        compose.onNodeWithContentDescription(inputDescription).performClick()
        compose.runOnIdle {
            val activity = ActivityLifecycleMonitorRegistry.getInstance()
                .getActivitiesInStage(Stage.RESUMED).single()
            val connection = requireNotNull(activity.window.decorView.findFocus())
                .onCreateInputConnection(EditorInfo()) ?: error("No active input connection")
            val info = InputContentInfo(uri("fixture.txt"), android.content.ClipDescription("Synthetic", arrayOf("text/plain")), null)
            assertTrue(connection.commitContent(info, 0, null))
        }
        compose.waitUntil(10_000) { compose.onAllNodesWithText("Reading files…").fetchSemanticsNodes().isEmpty() }
        compose.onNodeWithContentDescription("Send").performClick()
        try { assertEquals("fixture.txt", sent!!.attachments.single().name) }
        finally { sent?.attachments?.forEach { it.releaseOwnedCopy() } }
    }
    @Test fun invalidImageAndOversizeMetadataReportErrorsWithoutAttachments() {
        render()
        paste(clip("invalid.png"))
        compose.waitUntil(10_000) { compose.onAllNodesWithText("This image cannot be read.").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithContentDescription("Send").assertIsNotEnabled()
        paste(clip("oversize.txt"))
        compose.waitUntil(10_000) { compose.onAllNodesWithText("The selected file is empty or exceeds the file size limit.").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithContentDescription("Send").assertIsNotEnabled()
    }

    @Test fun switchingDraftDuringDelayedReadCancelsItsOwnedCopy() {
        val drafts = ComposerDrafts()
        val first = drafts.bind("fixture", "team", ComposerDrafts.Destination.Chat("first"))!!
        val second = drafts.bind("fixture", "team", ComposerDrafts.Destination.Chat("second"))!!
        first.write("first draft"); second.write("second draft")
        lease.value = first
        render()
        paste(clip("delay.txt"))
        compose.onNodeWithText("Reading files…").assertExists()
        compose.runOnIdle { lease.value = second }
        android.os.SystemClock.sleep(1600)
        compose.waitForIdle()
        compose.onNodeWithContentDescription("Remove").assertDoesNotExist()
        compose.onNodeWithContentDescription("Send").performClick()
        compose.waitUntil(10_000) { sent != null }
        assertEquals("second draft", sent?.text)
        assertTrue(sent!!.attachments.isEmpty())
        assertEquals("first draft", first.text)
        assertEquals("", second.text)
        assertTrue(java.io.File(context.filesDir, "chat-attachments").listFiles().orEmpty().isEmpty())
    }

    @Test fun tooManyClipboardFilesFailAtomically() {
        render()
        val many = clip("fixture.txt").apply { repeat(20) { addItem(ClipData.Item(uri("fixture.txt"))) } }
        paste(many)
        compose.onNodeWithText("Select at most 20 files.").assertExists()
        compose.onNodeWithContentDescription("Remove").assertDoesNotExist()
        compose.onNodeWithContentDescription("Send").assertIsNotEnabled()
    }
    @Test fun emptyClipboardFileCannotBeSubmitted() {
        render()
        paste(clip("empty.txt"))
        compose.waitUntil(10_000) { compose.onAllNodesWithText("The selected file is empty.").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithContentDescription("Remove").assertDoesNotExist()
        compose.onNodeWithContentDescription("Send").assertIsNotEnabled()
    }

}

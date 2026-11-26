package ai.nuphos.android

import android.graphics.Bitmap
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.data.AttachmentTransfers
import ai.nuphos.android.data.TransferDownloadGroup
import ai.nuphos.android.model.AgentConversationDetail
import ai.nuphos.android.model.ChannelAgent
import ai.nuphos.android.model.ChannelPost
import ai.nuphos.android.model.ComposerAttachment
import ai.nuphos.android.model.ComposerSubmission
import ai.nuphos.android.session.ChannelSession
import ai.nuphos.android.ui.chats.ChannelTranscript
import ai.nuphos.android.ui.theme.NuphosTheme
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** A Bot's chat sends a photo to a store that never finishes taking it: the post shows how far it got. Synthetic data only. */
@RunWith(AndroidJUnit4::class)
class ChannelUploadProgressFixtureDeviceTest {
    @get:Rule val compose = createComposeRule()
    private val dark get() = InstrumentationRegistry.getArguments().getString("darkTheme") == "true"
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val held = CompletableDeferred<Unit>()

    /** True when the store takes every byte at once and only the post itself is held. */
    private var filesUp = false

    private inner class Transport : ChannelSession.Transport {
        override suspend fun detail(tail: Int): AgentConversationDetail = error("Not read in this fixture")
        override suspend fun agents() = emptyList<ChannelAgent>()
        override suspend fun attachment(groupId: String): TransferDownloadGroup = error("Not read in this fixture")
        override suspend fun upload(attachments: List<ComposerAttachment>): String = upload(attachments) {}
        override suspend fun upload(attachments: List<ComposerAttachment>, onProgress: (AttachmentTransfers.Progress) -> Unit): String {
            if (filesUp) return "64b5f1c2e4b0a1d2c3e4f5a9"
            onProgress(AttachmentTransfers.Progress(AttachmentTransfers.Stage.Uploading, "photo", 1_234_567, 5_000_000))
            held.await()
            error("The store never answers in this fixture")
        }
        override suspend fun post(text: String, id: String, upload: String?, replyTo: String?) {
            held.await()
            error("The chat never answers in this fixture")
        }
    }

    @After fun end() { held.cancel(); scope.cancel() }

    @Test fun aSendingPostSaysHowFarItsFilesHaveUploaded() {
        sendThePoster("channel-upload-progress")
        compose.onNodeWithText("Uploading 1.2 MB of 5 MB", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithTag("channel-upload-progress", useUnmergedTree = true).assertIsDisplayed()
    }

    @Test fun aPostWhoseFilesAreUpSaysItIsSending() {
        filesUp = true
        sendThePoster("channel-upload-sending")
        compose.onNodeWithText("Sending…", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithTag("channel-upload-progress", useUnmergedTree = true).assertIsDisplayed()
    }

    private fun sendThePoster(shot: String) {
        val session = ChannelSession("team", "chat-upload", "Release ops", Transport())
        val photo = ComposerAttachment(name = "launch-poster.png", kind = ComposerAttachment.Kind.Image(ByteArray(16)))
        val agents = ai.nuphos.android.session.AgentStore("synthetic-no-credentials", InstrumentationRegistry.getInstrumentation().targetContext)
        compose.setContent {
            NuphosTheme(darkTheme = dark) {
                androidx.compose.material3.Surface {
                    androidx.compose.runtime.CompositionLocalProvider(ai.nuphos.android.ui.LocalAgentStore provides agents) {
                        ChannelTranscript(session, ChannelPost.items(session.posts, emptyList(), emptyList()), viewerId = "me", onLink = {})
                    }
                }
            }
        }
        compose.runOnUiThread { assertTrue(session.send(ComposerSubmission("Here is the launch poster", listOf(photo)), "me", "Me", null, scope)) }
        compose.waitUntil(5_000) { session.posts.any { it.sending } }
        // Give the line under the post a moment, then require it.
        runCatching { compose.waitUntil(3_000) { compose.onAllNodesWithTag("channel-upload-progress", useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty() } }
        compose.waitForIdle()
        val inst = InstrumentationRegistry.getInstrumentation()
        java.io.File(inst.targetContext.getExternalFilesDir(null), "$shot-${if (dark) "dark" else "light"}.png").outputStream().use {
            inst.uiAutomation.takeScreenshot().compress(Bitmap.CompressFormat.PNG, 100, it)
        }
        compose.onNodeWithText("Here is the launch poster", useUnmergedTree = true).assertIsDisplayed()
    }
}

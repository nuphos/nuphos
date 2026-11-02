package ai.nuphos.android

import android.content.ClipData
import android.net.Uri
import android.os.SystemClock
import android.view.InputDevice
import android.view.MotionEvent
import android.view.View
import android.widget.TextView
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry
import androidx.test.runner.lifecycle.Stage
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
class ContentDropFixtureDeviceTest {
    @get:Rule val compose = createComposeRule()
    @Test fun nativeDragDropsSyntheticDocumentIntoComposer() {
        val instrument = InstrumentationRegistry.getInstrumentation()
        assumeTrue(instrument.targetContext.packageName == "ai.nuphos.android.contentinput1337")
        lateinit var source: TextView
        var submitted: ComposerSubmission? = null
        var dragStarted = false
        compose.setContent {
            val context = LocalContext.current
            val store = remember { AgentStore("synthetic-no-credentials", context) }
            NuphosTheme { CompositionLocalProvider(LocalAgentStore provides store, ai.nuphos.android.ui.LocalAuthSession provides (androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as ai.nuphos.android.NuphosApplication).authSession) {
                Column(Modifier.systemBarsPadding()) {
                    AndroidView(modifier = Modifier.fillMaxWidth().height(80.dp), factory = { app ->
                        TextView(app).apply {
                            text = "Drag synthetic document"
                            setOnLongClickListener { view ->
                                val clip = ClipData.newUri(context.contentResolver, "Synthetic", Uri.parse("content://ai.nuphos.content-input-fixture/fixture.txt"))
                                dragStarted = view.startDragAndDrop(clip, View.DragShadowBuilder(view), null, View.DRAG_FLAG_GLOBAL or View.DRAG_FLAG_GLOBAL_URI_READ)
                                true
                            }
                            source = this
                        }
                    })
                    ChatComposer(isStreaming = false, onSend = { submitted = it; true })
                }
            } }
        }
        compose.onNodeWithContentDescription("Ask Nuphos anything").performClick()
        val field = compose.onNodeWithContentDescription("Ask Nuphos anything").fetchSemanticsNode().boundsInRoot
        val start = IntArray(2)
        val root = IntArray(2)
        var width = 0
        var height = 0
        compose.runOnIdle {
            source.getLocationOnScreen(start)
            width = source.width; height = source.height
            val activity = ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED).single()
            activity.window.decorView.findFocus().getLocationOnScreen(root)
        }
        assertTrue("Native source must have layout", width > 0 && height > 0)
        val x = start[0] + width / 2f
        val y = start[1] + height / 2f
        val targetX = root[0] + field.center.x
        val targetY = root[1] + field.center.y
        val down = SystemClock.uptimeMillis()
        fun touch(action: Int, px: Float, py: Float) {
            val event = MotionEvent.obtain(down, SystemClock.uptimeMillis(), action, px, py, 0)
            event.source = InputDevice.SOURCE_TOUCHSCREEN
            try { assertTrue(instrument.uiAutomation.injectInputEvent(event, true)) } finally { event.recycle() }
        }
        touch(MotionEvent.ACTION_DOWN, x, y)
        SystemClock.sleep(800)
        for (step in 1..20) {
            touch(MotionEvent.ACTION_MOVE, x + (targetX - x) * step / 20, y + (targetY - y) * step / 20)
            SystemClock.sleep(20)
        }
        touch(MotionEvent.ACTION_UP, targetX, targetY)
        compose.waitForIdle()
        assertTrue("Native drag must start", dragStarted)
        compose.waitUntil(10_000) { compose.onAllNodesWithContentDescription("Remove").fetchSemanticsNodes().size == 1 }
        compose.onNodeWithContentDescription("Send").performClick()
        try { assertEquals("fixture.txt", submitted!!.attachments.single().name) }
        finally { submitted?.attachments?.forEach { it.releaseOwnedCopy() } }
    }
}

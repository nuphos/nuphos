package ai.nuphos.android

import android.Manifest
import android.app.NotificationManager
import android.graphics.Bitmap
import android.graphics.Color
import android.os.Build
import android.os.SystemClock
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.notifications.LocalNotificationTarget
import ai.nuphos.android.notifications.LocalNotifications
import ai.nuphos.android.notifications.NotificationAvatars
import ai.nuphos.android.notifications.NotificationFace
import ai.nuphos.android.notifications.NotificationSender
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/**
 * Posts a Bot push with a background and a Task push with a runtime, from fictional FCM data,
 * through the same parser, renderer and builder a delivered push uses. Opt-in, disposable
 * emulator only; the notifications stay up so the host can screenshot the shade.
 */
@RunWith(AndroidJUnit4::class)
class PushIdentityFixtureDeviceTest {
    @Test fun botBackgroundAndTaskRuntimeAppearOnPushes() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        assumeTrue(InstrumentationRegistry.getArguments().getString("pushIdentityFixture") == "true")
        assertTrue("Requires a disposable emulator", Build.HARDWARE in setOf("ranchu", "goldfish"))
        val context = instrumentation.targetContext.applicationContext
        instrumentation.uiAutomation.grantRuntimePermission(context.packageName, Manifest.permission.POST_NOTIFICATIONS)
        val account = "fixture-account"
        val local = LocalNotifications(context, { account }, { true })
        val manager = context.getSystemService(NotificationManager::class.java)
        val out = File(context.getExternalFilesDir(null), "push-identity").apply { mkdirs() }

        fun push(session: String, data: Map<String, String>): Bitmap {
            val sender = requireNotNull(NotificationSender.from(data))
            val image = requireNotNull(NotificationAvatars.bitmap(context, sender))
            File(out, "$session.png").outputStream().use { image.compress(Bitmap.CompressFormat.PNG, 100, it) }
            val target = LocalNotificationTarget(account, "fixture-team", session)
            assertTrue(local.post(target, "Nuphos", data["body"], null, NotificationFace(sender.name, image)))
            val deadline = SystemClock.elapsedRealtime() + 3_000
            while (manager.activeNotifications.none { it.id == target.hashCode() } && SystemClock.elapsedRealtime() < deadline) SystemClock.sleep(50)
            assertTrue(manager.activeNotifications.any { it.tag == LocalNotifications.TAG && it.id == target.hashCode() })
            return image
        }

        val task = push("task-codex", mapOf("title" to "Fix the login redirect", "taskProvider" to "codex",
            "body" to "Opened a PR that keeps the return URL after sign-in."))
        val bot = push("bot-ada-mint-claude-code", mapOf("title" to "Ada", "botAvatar" to "07-ada", "botBackground" to "mint",
            "botProvider" to "claude-code", "body" to "The nightly report is ready: 3 builds passed, 1 is flaky."))

        // Task: the plain light disc with the Codex mark in black at its center.
        assertEquals(Color.WHITE, task.getPixel(96, 6))
        assertTrue((60..132).any { x -> (60..132).any { y -> task.getPixel(x, y) == Color.BLACK } })
        // Bot: the mint tint shows behind the face, and the badge disc sits at the lower right.
        assertTrue((0 until 192).any { x -> (0 until 192).any { y -> bot.getPixel(x, y) == 0xFFD3EEDF.toInt() } })
        assertEquals(Color.WHITE, bot.getPixel(122, 144))
    }
}

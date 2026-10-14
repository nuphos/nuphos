package ai.nuphos.android

import android.app.Activity
import android.app.NotificationManager
import android.os.SystemClock
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.notifications.LocalNotificationTarget
import ai.nuphos.android.notifications.LocalNotifications
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test

/** Opt-in acceptance against the local fixture login; never changes identity or permissions. */
class PushParityDeviceTest {
    @Test fun foregroundRoutingAndBadgeOnlyUpdates() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("localPushParity") == "true")
        assertTrue(BuildConfig.DEBUG && BuildConfig.API_BASE_URL.startsWith("http://127.0.0.1:"))
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as NuphosApplication
        val prefs = app.getSharedPreferences("push_binding", 0)
        val account = requireNotNull(prefs.getString("account", null))
        val target = LocalNotificationTarget(account, "parity-team", "parity-session")
        val other = target.copy(sessionId = "parity-other")
        val manager = app.getSystemService(NotificationManager::class.java)
        val push = app.pushNotifications
        lateinit var activity: Activity
        InstrumentationRegistry.getInstrumentation().runOnMainSync { activity = Activity() }
        fun message(t: LocalNotificationTarget) = mapOf("accountId" to t.accountId, "teamId" to t.teamId, "sessionId" to t.sessionId, "body" to "Parity fixture", "badge" to "2")
        fun row(t: LocalNotificationTarget) = manager.activeNotifications.find { it.tag == LocalNotifications.TAG && it.id == t.hashCode() }
        fun awaitState(condition: () -> Boolean) {
            val deadline = SystemClock.elapsedRealtime() + 3000
            while (!condition() && SystemClock.elapsedRealtime() < deadline) SystemClock.sleep(50)
            assertTrue(condition())
        }
        push.onActivityStarted(activity)
        push.reading(target)
        try {
            push.receive(message(target))
            SystemClock.sleep(200)
            assertNull(row(target))
            push.receive(message(other))
            awaitState { row(other) != null }
            assertEquals(2, row(other)!!.notification.number)
            push.receive(mapOf("kind" to "badge", "accountId" to "wrong-account", "badge" to "0"))
            SystemClock.sleep(200)
            assertNotNull(row(other))
            push.receive(mapOf("kind" to "badge", "accountId" to account, "badge" to "1"))
            awaitState { row(other)?.notification?.number == 1 }
            push.receive(mapOf("kind" to "badge", "accountId" to account, "badge" to "0"))
            awaitState { row(other) == null }
        } finally {
            push.hidden(target)
            push.onActivityStopped(activity)
            app.localNotifications.dismiss(target)
            app.localNotifications.dismiss(other)
        }
    }
}

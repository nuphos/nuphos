package ai.nuphos.android

import android.Manifest
import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.nuphos.android.notifications.LocalNotificationTarget
import ai.nuphos.android.notifications.LocalNotifications
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

/** OS acceptance on an explicitly opted-in disposable emulator only. Never launches login. */
@RunWith(AndroidJUnit4::class)
class LocalNotificationFixtureDeviceTest {
    @Test fun deniedPermissionThenGrantedDisplayHasPrivateImmutableTargetAndIdentityClear() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val optedIn = InstrumentationRegistry.getArguments().getString("isolatedLocalNotifications") == "true"
        assumeTrue("Isolated notification acceptance is disabled by default", optedIn)
        val emulator = Build.HARDWARE in setOf("ranchu", "goldfish") &&
            (Build.MODEL.startsWith("sdk_") || Build.FINGERPRINT.startsWith("generic"))
        assertTrue("Requires isolatedLocalNotifications=true and a disposable emulator; no permission change ran", optedIn && emulator)
        assertEquals("This acceptance fixture requires API 33", 33, Build.VERSION.SDK_INT)
        val context = instrumentation.targetContext.applicationContext
        val manager = context.getSystemService(NotificationManager::class.java)
        assertTrue("Existing local notifications must be absent on this isolated emulator", manager.activeNotifications.none { it.tag == LocalNotifications.TAG })
        assertNull("Existing channel must be absent; fixture will not replace a user's channel", manager.getNotificationChannel(LocalNotifications.CHANNEL))
        assertEquals("Host must start this isolated fixture with POST_NOTIFICATIONS denied", PackageManager.PERMISSION_DENIED,
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS))
        var account: String? = "notification-fixture-account"
        var consent = true
        val local = LocalNotifications(context, { account }, { consent })
        val target = LocalNotificationTarget(requireNotNull(account), "notification-fixture-team", "notification-fixture-chat")
        local.onIdentity(account, false)
        assertFalse("Denied runtime permission posted a notification", local.post(target))
        assertNull(manager.getNotificationChannel(LocalNotifications.CHANNEL))
        instrumentation.uiAutomation.grantRuntimePermission(context.packageName, Manifest.permission.POST_NOTIFICATIONS)
        assertEquals(PackageManager.PERMISSION_GRANTED, context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS))
        val intent = Intent(context, MainActivity::class.java).setAction(LocalNotifications.ACTION)
            .setData(Uri.Builder().scheme("nuphos-local").authority("conversation")
                .appendPath(target.accountId).appendPath(target.teamId).appendPath(target.sessionId).build())
            .putExtra(LocalNotifications.ACCOUNT, target.accountId)
            .putExtra(LocalNotifications.TEAM, target.teamId)
            .putExtra(LocalNotifications.SESSION, target.sessionId)
        try {
            assertTrue("Granted permission did not post", local.post(target))
            val deadline = android.os.SystemClock.elapsedRealtime() + 3_000
            while (manager.activeNotifications.none { it.tag == LocalNotifications.TAG } && android.os.SystemClock.elapsedRealtime() < deadline) {
                android.os.SystemClock.sleep(50)
            }
            val row = manager.activeNotifications.single { it.tag == LocalNotifications.TAG }
            assertEquals(target.hashCode(), row.id)
            assertEquals("Nuphos", row.notification.extras.getCharSequence(Notification.EXTRA_TITLE)?.toString())
            assertEquals("Open conversation history", row.notification.extras.getCharSequence(Notification.EXTRA_TEXT)?.toString())
            assertEquals(Notification.VISIBILITY_PRIVATE, row.notification.visibility)
            assertEquals(LocalNotifications.CHANNEL, row.notification.channelId)
            val tap = requireNotNull(row.notification.contentIntent)
            assertTrue("Tap target allows caller mutation", tap.isImmutable)
            // FLAG_NO_CREATE reads the OS PendingIntent identity without launching MainActivity.
            val expected = PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE)
            assertEquals("Posted tap does not target the exact scoped conversation", expected, tap)
            val wrongIntent = Intent(intent).setData(Uri.parse("nuphos-local://conversation/other/team/chat"))
            assertNull(PendingIntent.getActivity(context, 0, wrongIntent, PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE))
            account = "different-account"
            assertFalse("Wrong account posted", local.post(target))
            account = target.accountId
            consent = false
            assertFalse("Denied consent posted", local.post(target))
            assertTrue(local.accept(intent))
            assertNull(local.pending.take("different-account", target.teamId, true))
            assertTrue(local.accept(intent))
            assertNull(local.pending.take(target.accountId, target.teamId, false))
            consent = true
            assertTrue(local.accept(intent))
            assertEquals(target, local.pending.take(target.accountId, target.teamId, true))
            assertTrue(local.accept(intent))
            account = null
            local.onIdentity(null, true)
            assertNull(local.pending.value.value)
            // The system notification service applies cancellation asynchronously.
            val clearDeadline = android.os.SystemClock.elapsedRealtime() + 3_000
            while (manager.activeNotifications.any { it.tag == LocalNotifications.TAG } && android.os.SystemClock.elapsedRealtime() < clearDeadline) {
                android.os.SystemClock.sleep(50)
            }
            assertTrue("Signout left a local notification visible", manager.activeNotifications.none { it.tag == LocalNotifications.TAG })
            tap.cancel()
        } finally {
            local.clear()
            manager.deleteNotificationChannel(LocalNotifications.CHANNEL)
            // Revoking this same-UID runtime permission can kill instrumentation. The host
            // restores the initial denied permission after the isolated test process exits.
        }
    }
}
